import type { ClientSession } from 'mongoose';
import mongoose from 'mongoose';
import { PaymentModel } from '../models/Payment.js';
import type { OrderDoc } from '../models/Order.js';
import { OrderModel } from '../models/Order.js';
import { TableSessionModel } from '../models/TableSession.js';
import { orderRepository } from '../repositories/orderRepository.js';
import { auditRepository } from '../repositories/auditRepository.js';
import { outboxRepository } from '../repositories/outboxRepository.js';
import { unitOfWork } from '../infrastructure/unitOfWork.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../errors/AppError.js';
import { ensureOpenShift } from './cashShiftService.js';
import { orderRealtimeEvents } from './orderService.js';
import { CancelRequestModel } from '../models/CancelRequest.js';
import { assertNoPaymentCorrection } from './paymentCorrectionService.js';
import { clearCommittedPaymentClaim } from './paymentClaimService.js';

// Records a refund already made manually; never initiates a bank transfer.
export async function recordOrderRefund(
  order: OrderDoc,
  actorId: string,
  reason: string,
  method: 'CASH' | 'BANK_TRANSFER' | 'OTHER',
  session: ClientSession,
) {
  await assertNoPaymentCorrection(order.id, session);
  const active = !order.tableSessionId || await TableSessionModel.findOneAndUpdate(
    {
      _id: order.tableSessionId,
      status: { $ne: 'CLOSED' },
      $or: [
        { collectionExpiresAt: null },
        { collectionExpiresAt: { $lte: new Date() } },
        { collectionOwner: actorId },
      ],
    },
    { $inc: { version: 1 } },
    { new: true, session },
  );
  if (!active)
    throw new ForbiddenError('Phiên đã đóng hoặc bàn đang được nhân viên khác thu tiền.');
  const payments = await PaymentModel.find({ orderIds: order._id, status: 'SUCCESS' }).session(
    session,
  );
  const collected = order.paidAmount ?? (order.paymentStatus === 'PAID' ? order.total : 0);
  if (
    !payments.length ||
    payments.some((p) => p.orderIds.length !== 1) ||
    payments.reduce((sum, p) => sum + p.amount, 0) !== collected
  )
    throw new ForbiddenError(
      'Khoản thu cũ gộp nhiều đơn cần quản lý đối soát riêng; chưa thể hoàn từng đơn tại đây.',
    );
  const shift = await ensureOpenShift(actorId, session);
  for (const payment of payments) {
    payment.status = 'REFUNDED';
    payment.refundShiftId = shift._id;
    payment.refundMethod = method;
    payment.refundedAt = new Date();
    payment.refundedBy = new mongoose.Types.ObjectId(actorId);
    payment.refundReason = reason;
    payment.version += 1;
    await payment.save({ session });
    await auditRepository.log(
      {
        actorType: 'USER',
        actorId,
        action: 'payment.refunded',
        entityType: 'Payment',
        entityId: payment.id,
        metadata: { orderId: order.id, amount: payment.amount, method, reason, shiftId: shift.id },
      },
      session,
    );
  }
  await orderRepository.setPaymentStatus([order.id], 'REFUNDED', session);
  await OrderModel.updateOne({ _id: order._id }, { $set: { paidAmount: 0 } }, { session });
  if (order.tableSessionId) await clearCommittedPaymentClaim(order.tableSessionId.toString(), session);
}

export async function refundAndCancelOrder(
  orderId: string,
  actorId: string,
  expectedVersion: number,
  amount: number,
  method: 'CASH' | 'BANK_TRANSFER' | 'OTHER',
  reason: string,
) {
  return unitOfWork.withTransaction(async (session) => {
    const order = await orderRepository.findById(orderId, session);
    if (!order) throw new NotFoundError('Đơn không tồn tại.');
    if (order.status === 'CANCELLED' && order.paymentStatus === 'REFUNDED') return order;
    if (
      order.version !== expectedVersion ||
      ((order.paidAmount ?? (order.paymentStatus === 'PAID' ? order.total : 0)) <= 0 &&
        !(order.total === 0 && order.paymentStatus === 'PAID' && amount === 0)) ||
      !['AWAITING_PAYMENT', 'PENDING', 'CONFIRMED'].includes(order.status) ||
      (order.paidAmount ?? order.total) !== amount
    )
      throw new ConflictError(
        'CONFLICT',
        'Chỉ hoàn toàn bộ đơn đã thu tiền và chưa pha chế. Đơn vừa thay đổi, hãy tải lại.',
      );
    await recordOrderRefund(order, actorId, reason, method, session);
    const updated = await orderRepository.transitionStatus(
      order.id,
      order.version,
      'CANCELLED',
      { from: order.status, by: actorId, reason },
      session,
    );
    if (!updated) throw new ConflictError('CONFLICT', 'Đơn vừa được cập nhật.');
    const requests = await CancelRequestModel.find({
      orderId: order._id,
      status: 'REQUESTED',
    }).session(session);
    for (const request of requests) {
      request.status = 'APPROVED';
      request.decidedBy = new mongoose.Types.ObjectId(actorId);
      request.decidedAt = new Date();
      request.decisionNote = reason;
      request.version += 1;
      await request.save({ session });
      await auditRepository.log(
        {
          actorType: 'USER',
          actorId,
          action: 'cancelRequest.approved',
          entityType: 'CancelRequest',
          entityId: request.id,
          metadata: { orderId, reason, refunded: true },
        },
        session,
      );
    }
    await outboxRepository.createRealtimeEvents(
      orderRealtimeEvents(updated, 'order.statusChanged'),
      session,
    );
    return updated;
  });
}
