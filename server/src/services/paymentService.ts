import { paymentRepository } from '../repositories/paymentRepository.js';
import { billRepository } from '../repositories/billRepository.js';
import { orderRepository } from '../repositories/orderRepository.js';
import { tableSessionRepository } from '../repositories/tableSessionRepository.js';
import { guestSessionRepository } from '../repositories/guestSessionRepository.js';
import { tableRepository } from '../repositories/tableRepository.js';
import { unitOfWork } from '../infrastructure/unitOfWork.js';
import { auditRepository } from '../repositories/auditRepository.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../errors/AppError.js';
import type { OrderDoc } from '../models/Order.js';
import type { TableSessionDoc } from '../models/TableSession.js';
import { OrderModel } from '../models/Order.js';
import { ServiceRequestModel } from '../models/ServiceRequest.js';
import { outboxRepository } from '../repositories/outboxRepository.js';
import { UserModel } from '../models/User.js';
import { ensureOpenShift } from './cashShiftService.js';
import { CancelRequestModel } from '../models/CancelRequest.js';
import type { ClientSession } from 'mongoose';
import mongoose from 'mongoose';
import { orderRealtimeEvents } from './orderService.js';
import { guardPaymentClaim, clearCommittedPaymentClaim } from './paymentClaimService.js';
import { assertNoPaymentCorrection } from './paymentCorrectionService.js';
import { settleOrderBenefits } from './promotionService.js';

export interface ConfirmOrderPaymentInput {
  claimToken?: string;
  orderId: string;
  expectedVersion: number;
  staffId: string;
  amount: number;
  method: 'CASH' | 'BANK_TRANSFER' | 'OTHER';
  note?: string;
  idempotencyKey: string;
}

export async function confirmOrderPayment(input: ConfirmOrderPaymentInput) {
  if (!Number.isInteger(input.amount) || input.amount < 0)
    throw new ValidationError('Số tiền không hợp lệ.');
  const replay = async () => {
    const payment = await paymentRepository.findByIdempotency(input.idempotencyKey);
    if (!payment) return null;
    if (
      payment.orderIds.length !== 1 ||
      payment.orderIds[0]?.toString() !== input.orderId ||
      payment.amount !== input.amount ||
      payment.method !== input.method ||
      payment.confirmedBy.toString() !== input.staffId ||
      payment.note !== (input.note ?? '')
    )
      throw new ConflictError('IDEMPOTENCY_CONFLICT', 'Mã thanh toán đã dùng cho yêu cầu khác.');
    return { payment, replayed: true };
  };
  const existing = await replay();
  if (existing) return existing;
  try {
    return await unitOfWork.withTransaction(async (session) => {
      const order = await orderRepository.findById(input.orderId, session);
      if (!order) throw new NotFoundError('Đơn không tồn tại.');
      await assertNoPaymentCorrection(order.id, session);
      if (
        await CancelRequestModel.exists({ orderId: order._id, status: 'REQUESTED' }).session(
          session,
        )
      )
        throw new ConflictError(
          'CANCEL_REQUEST_PENDING',
          'Cần xử lý yêu cầu hủy trước khi thu thêm tiền.',
        );
      if (
        order.version !== input.expectedVersion ||
        order.paymentStatus !== 'UNPAID' ||
        order.status === 'CANCELLED'
      )
        throw new ConflictError('CONFLICT', 'Đơn đã thay đổi hoặc đã thu tiền. Vui lòng tải lại.');
      const collected = order.paidAmount ?? 0;
      const remaining = order.total - collected;
      if (input.amount > remaining || (input.amount <= 0 && remaining !== 0))
        throw new ValidationError(
          `Số tiền thực nhận phải lớn hơn 0 và không quá ${remaining} VND còn thiếu.`,
        );
      await guardPaymentClaim(
        order.tableSessionId.toString(),
        input.staffId,
        input.claimToken,
        session,
      );
      const shift = await ensureOpenShift(input.staffId, session);
      const payment = await paymentRepository.create(
        {
          tableSessionId: order.tableSessionId,
          shiftId: shift._id,
          orderIds: [order._id],
          amount: input.amount,
          method: input.method,
          status: 'SUCCESS',
          confirmedBy: new mongoose.Types.ObjectId(input.staffId),
          paidAt: new Date(),
          idempotencyKey: input.idempotencyKey,
          note: input.note ?? '',
        },
        session,
      );
      const paidAmount = collected + input.amount;
      const paid = paidAmount === order.total;
      const nextStatus = paid && order.status === 'AWAITING_PAYMENT' ? 'PENDING' : order.status;
      const updated = await OrderModel.findOneAndUpdate(
        { _id: order._id, version: order.version, paymentStatus: 'UNPAID' },
        {
          $set: { paidAmount, paymentStatus: paid ? 'PAID' : 'UNPAID', status: nextStatus },
          $inc: { version: 1 },
          ...(nextStatus !== order.status
            ? {
                $push: {
                  statusHistory: {
                    from: order.status,
                    to: nextStatus,
                    at: new Date(),
                    by: input.staffId,
                    reason: 'Đã nhận đủ tiền',
                  },
                },
              }
            : {}),
        },
        { new: true, session },
      );
      if (!updated) throw new ConflictError('CONFLICT', 'Đơn vừa được cập nhật.');
      if (updated.status === 'SERVED') await settleOrderBenefits(updated, 'SERVED', session);
      await clearCommittedPaymentClaim(order.tableSessionId.toString(), session);
      await auditRepository.log(
        {
          actorType: 'USER',
          actorId: input.staffId,
          action: 'payment.orderConfirmed',
          entityType: 'Payment',
          entityId: payment.id,
          metadata: { orderId: order.id, amount: payment.amount },
        },
        session,
      );
      await outboxRepository.createRealtimeEvents(
        orderRealtimeEvents(updated, 'order.statusChanged'),
        session,
      );
      return { payment, replayed: false };
    });
  } catch (error) {
    const raced = await replay();
    if (raced) return raced;
    throw error;
  }
}

export async function listAwaitingPayments() {
  const sessions = await tableSessionRepository.listOpen();
  return OrderModel.find({
    tableSessionId: { $in: sessions.map((s) => s._id) },
    status: { $ne: 'CANCELLED' },
    paymentStatus: 'UNPAID',
  }).sort({ createdAt: 1 });
}

export async function finalizeSessionBill(
  tableSession: TableSessionDoc,
  staffId: string | null,
  session: ClientSession,
) {
  if (
    await CancelRequestModel.exists({
      tableSessionId: tableSession._id,
      status: 'REQUESTED',
    }).session(session)
  )
    throw new ConflictError(
      'CANCEL_REQUEST_PENDING',
      'Cần xử lý yêu cầu hủy trước khi đóng phiên.',
    );
  const table = await tableRepository.findById(tableSession.tableId.toString(), session);
  if (!table) throw new NotFoundError('Bàn không tồn tại.');
  const cashier = staffId ? await UserModel.findById(staffId).session(session) : null;
  const orders = await OrderModel.find({ tableSessionId: tableSession._id })
    .sort({ createdAt: 1 })
    .session(session);
  for (const order of orders) await assertNoPaymentCorrection(order.id, session);
  const payments = await paymentRepository.listBySession(tableSession.id, session);
  const { bill } = await billRepository.finalize(
    {
      tableSession,
      tableCode: table.code,
      tableName: table.name,
      cashierName: cashier?.name ?? 'Nhân viên',
      orders,
      payments,
      closedAt: tableSession.closedAt ?? new Date(),
    },
    session,
  );
  return bill;
}

export interface ConfirmPaymentInput {
  claimToken?: string;
  tableSessionId: string;
  expectedVersion: number;
  staffId: string;
  amount: number;
  method: 'CASH' | 'BANK_TRANSFER' | 'OTHER';
  note?: string;
  idempotencyKey: string;
}

export async function confirmPayment(input: ConfirmPaymentInput) {
  if (!Number.isInteger(input.amount) || input.amount < 0) {
    throw new ValidationError('Số tiền thanh toán không hợp lệ.');
  }
  const replayed = await replayPayment(input);
  if (replayed) return replayed;
  try {
    return await settleSession(input);
  } catch (error) {
    // Request cùng key có thể đã commit sau bước kiểm tra phía trên (khi đó phiên đã CLOSED
    // nên transaction này báo lỗi): trả lại khoản thu đã ghi thay vì lỗi gây hiểu nhầm.
    const raced = await replayPayment(input);
    if (raced) return raced;
    throw error;
  }
}

async function replayPayment(input: ConfirmPaymentInput) {
  const existing = await paymentRepository.findByIdempotency(input.idempotencyKey);
  if (!existing) return null;
  if (
    existing.tableSessionId.toString() !== input.tableSessionId ||
    existing.amount !== input.amount ||
    existing.method !== input.method ||
    existing.confirmedBy?.toString() !== input.staffId ||
    existing.note !== (input.note ?? '')
  ) {
    throw new ConflictError('IDEMPOTENCY_CONFLICT', 'Mã thanh toán đã dùng cho yêu cầu khác.');
  }
  const bill = await billRepository.findBySession(input.tableSessionId);
  return {
    payment: existing,
    orderIds: existing.orderIds.map((o) => o.toString()),
    replayed: true as const,
    billId: bill?._id.toString() ?? null,
  };
}

async function settleSession(input: ConfirmPaymentInput) {
  const result = await unitOfWork.withTransaction(async (session) => {
    const tableSession = await tableSessionRepository.findById(input.tableSessionId, session);
    if (!tableSession) throw new NotFoundError('Phiên không tồn tại.');
    if (tableSession.status !== 'CHECKOUT')
      throw new ForbiddenError('Hãy chuyển bàn sang thanh toán trước khi thu tiền.');
    if (tableSession.version !== input.expectedVersion) {
      throw new ConflictError('CONFLICT', 'Phiên đã thay đổi, vui lòng tải lại.');
    }
    if (
      await CancelRequestModel.exists({
        tableSessionId: tableSession._id,
        status: 'REQUESTED',
      }).session(session)
    ) {
      throw new ConflictError(
        'CANCEL_REQUEST_PENDING',
        'Còn yêu cầu hủy đang chờ xử lý. Hãy duyệt hoặc từ chối trước khi thu tiền.',
      );
    }

    const allOrders = await OrderModel.find({ tableSessionId: tableSession._id }).session(session);
    for (const order of allOrders) await assertNoPaymentCorrection(order.id, session);
    if (allOrders.some((o) => !['SERVED', 'CANCELLED'].includes(o.status))) {
      throw new ValidationError(
        'Còn món chưa phục vụ. Hãy hoàn tất hoặc hủy đơn hợp lệ trước khi thu tiền.',
      );
    }
    const orders = allOrders.filter((o) => o.status === 'SERVED' && o.paymentStatus === 'UNPAID');
    if (orders.length === 0) {
      throw new ValidationError('Không có đơn nào đang chờ thanh toán.');
    }
    const expected = orders.reduce((s, o) => s + o.total - (o.paidAmount ?? 0), 0);
    if (input.amount !== expected) {
      throw new ValidationError(`Số tiền phải thu là ${expected} VND, không khớp với yêu cầu.`);
    }
    const claimedSession = await guardPaymentClaim(
      input.tableSessionId,
      input.staffId,
      input.claimToken,
      session,
    );

    const table = await tableRepository.findById(tableSession.tableId.toString(), session);
    if (!table) throw new NotFoundError('Bàn không tồn tại.');
    const cashier = await UserModel.findById(input.staffId).session(session);
    const shift = await ensureOpenShift(input.staffId, session);

    const payment = await paymentRepository.create(
      {
        tableSessionId: tableSession._id,
        shiftId: shift._id,
        orderIds: orders.map((o) => o._id),
        amount: input.amount,
        method: input.method,
        status: 'SUCCESS',
        confirmedBy: new (await import('mongoose')).default.Types.ObjectId(input.staffId),
        paidAt: new Date(),
        idempotencyKey: input.idempotencyKey,
        note: input.note ?? '',
      },
      session,
    );
    await orderRepository.setPaymentStatus(
      orders.map((o) => o._id.toString()),
      'PAID',
      session,
    );
    for (const order of orders)
      await OrderModel.updateOne(
        { _id: order._id },
        { $set: { paidAmount: order.total }, $inc: { version: 1 } },
        { session },
      );

    // Snapshot bất biến của phiên: chốt ngay trong cùng transaction với payment.
    // Đọc lại đơn sau khi cập nhật paymentStatus để snapshot không giữ trạng thái cũ trong bộ nhớ.
    const settledOrders = await OrderModel.find({ tableSessionId: tableSession._id })
      .sort({ createdAt: 1 })
      .session(session);
    for (const order of settledOrders)
      if (order.status === 'SERVED') await settleOrderBenefits(order, 'SERVED', session);
    const sessionPayments = await paymentRepository.listBySession(
      tableSession._id.toString(),
      session,
    );
    const { bill } = await billRepository.finalize(
      {
        tableSession,
        tableCode: table.code,
        tableName: table.name,
        cashierName: cashier?.name ?? 'Nhân viên',
        orders: settledOrders,
        payments: [
          payment,
          ...sessionPayments.filter((p) => p._id.toString() !== payment._id.toString()),
        ],
        closedAt: new Date(),
      },
      session,
    );

    const closed = await tableSessionRepository.updateStatus(
      tableSession._id.toString(),
      claimedSession.version,
      {
        status: 'CLOSED',
        closedBy: input.staffId,
        closedReason: 'PAID',
        billId: bill._id.toString(),
      },
      session,
    );
    if (!closed) throw new ConflictError('CONFLICT', 'Phiên đã thay đổi, vui lòng thử lại.');
    await clearCommittedPaymentClaim(input.tableSessionId, session);

    // revoke all guest sessions of this table session
    await guestSessionRepository.revokeByTableSession(tableSession._id.toString(), session);
    await tableRepository.invalidateQr(tableSession.tableId.toString(), session);
    await ServiceRequestModel.updateMany(
      { tableSessionId: tableSession._id, status: 'OPEN' },
      { $set: { status: 'RESOLVED', resolvedBy: input.staffId, resolvedAt: new Date() } },
      { session },
    );

    await auditRepository.log(
      {
        actorType: 'USER',
        actorId: input.staffId,
        action: 'payment.confirmed',
        entityType: 'Payment',
        entityId: payment._id.toString(),
        metadata: { amount: payment.amount, orderCount: orders.length },
      },
      session,
    );

    const payload = {
      tableSessionId: input.tableSessionId,
      status: 'CLOSED',
      version: closed.version,
    };
    const aggregate = {
      aggregateType: 'TableSession',
      aggregateId: input.tableSessionId,
      aggregateVersion: closed.version,
      payload,
    } as const;
    await outboxRepository.createRealtimeEvents(
      [
        {
          ...aggregate,
          eventType: 'payment.confirmed',
          target: { scope: 'session', tableSessionId: input.tableSessionId },
        },
        { ...aggregate, eventType: 'payment.confirmed', target: { scope: 'staff' } },
        { ...aggregate, eventType: 'tableSession.statusChanged', target: { scope: 'staff' } },
        { ...aggregate, eventType: 'serviceRequest.resolved', target: { scope: 'staff' } },
      ],
      session,
    );

    return {
      payment,
      orderIds: orders.map((o) => o._id.toString()),
      replayed: false as const,
      billId: bill._id.toString(),
      session: closed,
    };
  });

  return result;
}

export interface BillSummary {
  tableSessionId: string;
  tableCode: string;
  status: string;
  openedAt: Date;
  closedAt: Date | null;
  subtotal: number;
  total: number;
  paidAmount: number;
  orders: Array<
    Pick<
      OrderDoc,
      | '_id'
      | 'code'
      | 'total'
      | 'status'
      | 'paymentStatus'
      | 'items'
      | 'createdAt'
      | 'participantId'
      | 'subtotal'
      | 'voucherCode'
      | 'voucherDiscount'
      | 'pointsDiscount'
      | 'redeemedPoints'
      | 'earnedPoints'
    >
  >;
}

export async function buildBill(tableSessionId: string): Promise<BillSummary> {
  const session: TableSessionDoc | null = await tableSessionRepository.findById(tableSessionId);
  if (!session) throw new NotFoundError('Phiên không tồn tại.');

  // Phiên đã chốt Bill: trả snapshot bất biến thay vì tính lại từ Order (Order có thể đã đổi sau đó).
  if (session.status === 'CLOSED') {
    const snapshot = await billRepository.findBySession(tableSessionId);
    if (snapshot) {
      return {
        tableSessionId,
        tableCode: snapshot.tableCode,
        status: session.status,
        openedAt: snapshot.openedAt,
        closedAt: snapshot.closedAt,
        subtotal: snapshot.subtotal,
        total: snapshot.total,
        paidAmount: snapshot.paidAmount,
        orders: snapshot.orders.map((o) => ({
          _id: o.orderId,
          code: o.code,
          total: o.total,
          subtotal: o.subtotal ?? o.total,
          voucherCode: o.voucherCode,
          voucherDiscount: o.voucherDiscount,
          pointsDiscount: o.pointsDiscount,
          redeemedPoints: o.redeemedPoints,
          earnedPoints: o.earnedPoints,
          status: o.status,
          paymentStatus: o.paymentStatus,
          items: o.items,
          createdAt: o.createdAt,
          participantId: o.participantId,
        })) as BillSummary['orders'],
      };
    }
  }

  const table = await tableRepository.findById(session.tableId.toString());
  if (!table) throw new NotFoundError('Bàn không tồn tại.');
  const orders = await OrderModel.find({ tableSessionId }).sort({ createdAt: 1 });
  const unpaid = orders.filter((o) => o.status !== 'CANCELLED' && o.paymentStatus === 'UNPAID');
  const total = unpaid.reduce((s, o) => s + o.total - (o.paidAmount ?? 0), 0);
  const paidAmount = orders
    .filter((o) => o.status !== 'CANCELLED')
    .reduce((s, o) => s + (o.paidAmount ?? (o.paymentStatus === 'PAID' ? o.total : 0)), 0);
  return {
    tableSessionId,
    tableCode: table.code,
    status: session.status,
    openedAt: session.startedAt,
    closedAt: session.closedAt ?? null,
    subtotal: orders
      .filter((o) => o.status !== 'CANCELLED')
      .reduce((s, o) => s + (o.subtotal ?? o.total), 0),
    total,
    paidAmount,
    orders: orders
      .filter((o) => o.status !== 'CANCELLED')
      .map((o) => ({
        _id: o._id,
        code: o.code,
        total: o.total,
        subtotal: o.subtotal ?? o.total,
        voucherCode: o.voucherCode,
        voucherDiscount: o.voucherDiscount,
        pointsDiscount: o.pointsDiscount,
        redeemedPoints: o.redeemedPoints,
        earnedPoints: o.earnedPoints,
        status: o.status,
        paymentStatus: o.paymentStatus,
        items: o.items,
        createdAt: o.createdAt,
        participantId: o.participantId,
      })),
  };
}
