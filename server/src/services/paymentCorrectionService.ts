import type { ClientSession } from 'mongoose';
import { PaymentCorrectionModel } from '../models/PaymentCorrection.js';
import { PaymentModel, type PaymentDoc } from '../models/Payment.js';
import { OrderModel, type OrderDoc } from '../models/Order.js';
import { TableSessionModel } from '../models/TableSession.js';
import { UserModel } from '../models/User.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../errors/AppError.js';
import { unitOfWork } from '../infrastructure/unitOfWork.js';
import { ensureOpenShift } from './cashShiftService.js';
import { auditRepository } from '../repositories/auditRepository.js';
import { outboxRepository } from '../repositories/outboxRepository.js';
import { orderRealtimeEvents } from './orderService.js';

export async function assertNoPaymentCorrection(orderId: string, session: ClientSession) {
  const payments = await PaymentModel.find({ orderIds: orderId }).select('_id').session(session);
  if (
    await PaymentCorrectionModel.exists({
      status: 'REQUESTED',
      $or: [{ paymentId: { $in: payments.map((p) => p._id) } }, { targetOrderId: orderId }],
    }).session(session)
  )
    throw new ConflictError(
      'PAYMENT_CORRECTION_PENDING',
      'Khoản thu đang chờ quản lý duyệt điều chỉnh.',
    );
}

async function guardSession(order: OrderDoc, session: ClientSession, allowClosed = false) {
  if (!order.tableSessionId) {
    if (order.pickup?.outcome !== 'ACTIVE' && !allowClosed) throw new ForbiddenError('Đơn mang đi đã kết thúc.');
    await OrderModel.updateOne({ _id: order._id }, { $inc: { version: 1 } }, { session });
    return;
  }
  const tableSession = await TableSessionModel.findOneAndUpdate(
    {
      _id: order.tableSessionId,
      ...(allowClosed ? {} : { status: { $in: ['OPEN', 'CHECKOUT'] } }),
      $or: [{ collectionExpiresAt: null }, { collectionExpiresAt: { $lte: new Date() } }],
    },
    { $inc: { version: 1 } },
    { new: true, session },
  );
  if (!tableSession)
    throw new ConflictError(
      'PAYMENT_CLAIMED',
      'Bàn đã đóng hoặc đang được thu tiền. Hãy kết thúc thao tác thu tiền trước.',
    );
}

function assertReversible(order: OrderDoc) {
  if (!['AWAITING_PAYMENT', 'PENDING', 'CONFIRMED'].includes(order.status))
    throw new ForbiddenError(
      'Chỉ hủy/đổi đơn nhận khoản thu khi đơn nguồn chưa pha chế. Đơn đã pha chế cần đối soát riêng.',
    );
}

export async function requestPaymentCorrection(
  paymentId: string,
  actorId: string,
  input: {
    kind: 'VOID' | 'METHOD' | 'TRANSFER';
    reason: string;
    method?: 'CASH' | 'BANK_TRANSFER' | 'OTHER';
    targetOrderId?: string;
  },
) {
  try {
    return await unitOfWork.withTransaction(async (session) => {
      const payment = await PaymentModel.findById(paymentId).session(session);
      if (!payment) throw new NotFoundError('Khoản thu không tồn tại.');
      if (payment.status !== 'SUCCESS')
        throw new ConflictError('CONFLICT', 'Khoản thu đã hoàn hoặc đảo.');
      if (payment.orderIds.length !== 1)
        throw new ForbiddenError('Khoản thu cũ gộp nhiều đơn cần đối soát riêng.');
      const order = await OrderModel.findById(payment.orderIds[0]).session(session);
      if (!order) throw new NotFoundError('Đơn không tồn tại.');
      await assertNoPaymentCorrection(order.id, session);
      if (input.kind !== 'METHOD') assertReversible(order);
      if (input.kind === 'METHOD' && input.method === payment.method)
        throw new ValidationError('Phương thức mới phải khác phương thức đã ghi.');
      await guardSession(order, session, input.kind === 'METHOD');
      await OrderModel.updateOne({ _id: order._id }, { $inc: { version: 1 } }, { session });
      if (input.kind === 'TRANSFER') {
        const target = await OrderModel.findById(input.targetOrderId).session(session);
        if (
          !target ||
          target.id === order.id ||
          target.status !== 'AWAITING_PAYMENT' ||
          target.paymentStatus !== 'UNPAID'
        )
          throw new ValidationError('Đơn nhận phải là đơn khác đang chờ thanh toán.');
        if (payment.amount > target.total - (target.paidAmount ?? 0))
          throw new ValidationError('Khoản thu vượt số tiền còn thiếu của đơn nhận.');
        await assertNoPaymentCorrection(target.id, session);
        await guardSession(target, session);
        await OrderModel.updateOne({ _id: target._id }, { $inc: { version: 1 } }, { session });
      }
      const actor = await UserModel.findById(actorId).session(session);
      const [correction] = await PaymentCorrectionModel.create(
        [
          {
            ...input,
            paymentId,
            paymentVersion: payment.version,
            requestedBy: actorId,
            requestedByName: actor?.name ?? 'Nhân viên',
          },
        ],
        { session },
      );
      if (!correction) throw new Error('Failed to create payment correction');
      await auditRepository.log(
        {
          actorType: 'USER',
          actorId,
          action: 'payment.correctionRequested',
          entityType: 'PaymentCorrection',
          entityId: correction.id,
          metadata: { paymentId, ...input },
        },
        session,
      );
      return correction;
    });
  } catch (error) {
    if ((error as { code?: number }).code === 11000)
      throw new ConflictError('CONFLICT', 'Khoản thu đã có yêu cầu điều chỉnh.');
    throw error;
  }
}

async function publish(order: OrderDoc, session: ClientSession) {
  await outboxRepository.createRealtimeEvents(
    orderRealtimeEvents(order, 'order.statusChanged'),
    session,
  );
}

export async function decidePaymentCorrection(
  id: string,
  actorId: string,
  input: {
    expectedVersion: number;
    approve: boolean;
    note: string;
  },
) {
  return unitOfWork.withTransaction(async (session) => {
    const correction = await PaymentCorrectionModel.findById(id).session(session);
    if (!correction) throw new NotFoundError('Yêu cầu không tồn tại.');
    if (correction.status !== 'REQUESTED' || correction.version !== input.expectedVersion)
      throw new ConflictError('CONFLICT', 'Yêu cầu đã được xử lý.');
    if (correction.requestedBy.toString() === actorId)
      throw new ForbiddenError('Người lập yêu cầu không được tự duyệt; cần quản lý khác kiểm tra.');
    const payment = await PaymentModel.findById(correction.paymentId).session(session);
    if (!payment) throw new NotFoundError('Khoản thu không tồn tại.');
    if (input.approve) {
      if (payment.status !== 'SUCCESS' || payment.version !== correction.paymentVersion)
        throw new ConflictError(
          'CONFLICT',
          'Khoản thu đã thay đổi. Hãy từ chối yêu cầu cũ và lập lại.',
        );
      const order = await OrderModel.findById(payment.orderIds[0]).session(session);
      if (!order) throw new NotFoundError('Đơn không tồn tại.');
      if (correction.kind !== 'METHOD') assertReversible(order);
      await guardSession(order, session, correction.kind === 'METHOD');
      const shift = await ensureOpenShift(actorId, session);
      const now = new Date();
      // Preserve amount, method, paidAt and collector of the original receipt.
      payment.status = 'REFUNDED';
      payment.refundShiftId = shift._id;
      payment.refundMethod = payment.method;
      payment.refundedAt = now;
      payment.refundedBy = (await UserModel.findById(actorId).session(session))!._id;
      payment.refundReason = correction.reason;
      payment.reversalKind = correction.kind;
      payment.version += 1;
      await payment.save({ session });
      if (correction.kind !== 'METHOD') {
        const paidAmount =
          (order.paidAmount ?? (order.paymentStatus === 'PAID' ? order.total : 0)) - payment.amount;
        if (paidAmount < 0)
          throw new ConflictError('CONFLICT', 'Số tiền đã thu không khớp; cần đối soát.');
        order.paidAmount = paidAmount;
        order.paymentStatus = 'UNPAID';
        if (order.status !== 'AWAITING_PAYMENT') {
          order.statusHistory.push({
            from: order.status,
            to: 'AWAITING_PAYMENT',
            at: now,
            by: actorId,
            reason: correction.reason,
          });
          order.status = 'AWAITING_PAYMENT';
        }
      }
      order.version += 1;
      await order.save({ session });
      await publish(order, session);
      if (correction.kind === 'METHOD' || correction.kind === 'TRANSFER') {
        const target =
          correction.kind === 'METHOD'
            ? order
            : await OrderModel.findById(correction.targetOrderId).session(session);
        if (!target) throw new NotFoundError('Đơn nhận không tồn tại.');
        if (correction.kind === 'TRANSFER') {
          if (
            target.status !== 'AWAITING_PAYMENT' ||
            target.paymentStatus !== 'UNPAID' ||
            payment.amount > target.total - (target.paidAmount ?? 0)
          )
            throw new ConflictError('CONFLICT', 'Đơn nhận đã thay đổi hoặc không còn đủ dư nợ.');
          await guardSession(target, session);
          target.paidAmount = (target.paidAmount ?? 0) + payment.amount;
          if (target.paidAmount === target.total) {
            target.paymentStatus = 'PAID';
            target.statusHistory.push({
              from: target.status,
              to: 'PENDING',
              at: now,
              by: actorId,
              reason: correction.reason,
            });
            target.status = 'PENDING';
          }
          target.version += 1;
          await target.save({ session });
          await publish(target, session);
        }
        const [replacement] = await PaymentModel.create(
          [
            {
              tableSessionId: target.tableSessionId,
              orderIds: [target._id],
              amount: payment.amount,
              method: correction.kind === 'METHOD' ? correction.method : payment.method,
              status: 'SUCCESS',
              shiftId: shift._id,
              confirmedBy: actorId,
              paidAt: now,
              idempotencyKey: `correction:${correction.id}`,
              note: correction.reason,
              replacesPaymentId: payment._id,
            },
          ],
          { session },
        );
        correction.replacementPaymentId = replacement!._id;
      }
    }
    const actor = await UserModel.findById(actorId).session(session);
    correction.status = input.approve ? 'APPROVED' : 'REJECTED';
    correction.decidedBy = actor!._id;
    correction.decidedByName = actor?.name ?? 'Quản lý';
    correction.decidedAt = new Date();
    correction.decisionNote = input.note;
    correction.version += 1;
    await correction.save({ session });
    await auditRepository.log(
      {
        actorType: 'USER',
        actorId,
        action: `payment.correction${input.approve ? 'Approved' : 'Rejected'}`,
        entityType: 'PaymentCorrection',
        entityId: id,
        metadata: { paymentId: payment.id, kind: correction.kind, note: input.note },
      },
      session,
    );
    return correction;
  });
}

function receiptDto(payment: PaymentDoc) {
  return {
    id: payment.id,
    orderIds: payment.orderIds.map(String),
    tableSessionId: payment.tableSessionId?.toString() ?? null,
    amount: payment.amount,
    method: payment.method,
    status: payment.status,
    paidAt: payment.paidAt,
    confirmedBy: String(payment.confirmedBy),
    note: payment.note,
    refundedAt: payment.refundedAt,
    refundReason: payment.refundReason,
    reversalKind: payment.reversalKind,
    replacesPaymentId: payment.replacesPaymentId?.toString() ?? null,
  };
}

export async function listPaymentAccounting(page: number, limit: number, sessionId?: string) {
  const filter = sessionId ? { tableSessionId: sessionId } : {};
  const [payments, total, corrections, targets] = await Promise.all([
    PaymentModel.find(filter)
      .sort({ paidAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    PaymentModel.countDocuments(filter),
    PaymentCorrectionModel.find().sort({ status: -1, createdAt: -1 }).limit(200).lean(),
    OrderModel.find({ status: 'AWAITING_PAYMENT', paymentStatus: 'UNPAID' })
      .select('code tableId total paidAmount')
      .limit(200)
      .lean(),
  ]);
  const correctionPayments = await PaymentModel.find({
    _id: { $in: corrections.map((c) => c.paymentId) },
  });
  const allReceipts = [...payments, ...correctionPayments];
  const orders = await OrderModel.find({
    _id: {
      $in: [
        ...allReceipts.flatMap((p) => p.orderIds),
        ...corrections.flatMap((c) => (c.targetOrderId ? [c.targetOrderId] : [])),
      ],
    },
  })
    .select('code tableId fulfillmentType')
    .populate('tableId', 'name');
  const names = new Map(
    orders.map((o) => [
      o.id,
      { code: o.code, tableName: (o.tableId as unknown as { name?: string })?.name ?? (o.fulfillmentType !== 'DINE_IN' ? 'Mang đi' : '') },
    ]),
  );
  return {
    items: payments.map((p) => ({
      ...receiptDto(p),
      orders: p.orderIds.map((id) => names.get(String(id))),
    })),
    total,
    page,
    limit,
    corrections: corrections.map((correction) => {
      const receipt = correctionPayments.find((p) => p._id.equals(correction.paymentId));
      return {
        ...correction,
        receipt: receipt
          ? { ...receiptDto(receipt), orders: receipt.orderIds.map((id) => names.get(String(id))) }
          : null,
        targetOrder: correction.targetOrderId ? names.get(String(correction.targetOrderId)) : null,
      };
    }),
    targets,
  };
}
