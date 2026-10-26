import { ConflictError, ForbiddenError, NotFoundError } from '../errors/AppError.js';
import { unitOfWork } from '../infrastructure/unitOfWork.js';
import { CancelRequestModel } from '../models/CancelRequest.js';
import { auditRepository } from '../repositories/auditRepository.js';
import { orderRepository } from '../repositories/orderRepository.js';
import { outboxRepository, type RealtimeOutboxInput } from '../repositories/outboxRepository.js';
import type { OrderDoc } from '../models/Order.js';
import { recordOrderRefund } from './orderRefundService.js';
import { OrderModel } from '../models/Order.js';
import { assertNoPaymentCorrection } from './paymentCorrectionService.js';
import { guardUnpaidCancellation } from './paymentClaimService.js';

export async function createCancelRequest(orderId: string, participantId: string, reason: string) {
  try {
    return await unitOfWork.withTransaction(async (session) => {
      const order = await orderRepository.findById(orderId, session);
      if (!order) throw new NotFoundError('Đơn không tồn tại.');
      if (order.participantId !== participantId)
        throw new ForbiddenError('Bạn không thể yêu cầu hủy đơn của khách khác.');
      if (
        !['PENDING', 'CONFIRMED'].includes(order.status) &&
        !(order.status === 'AWAITING_PAYMENT' && (order.paidAmount ?? 0) > 0)
      )
        throw new ConflictError(
          'STATE_TRANSITION_INVALID',
          'Chỉ có thể yêu cầu hủy khi đơn đã xác nhận và chưa pha chế.',
        );
      const existing = await CancelRequestModel.findOne({
        orderId,
        status: 'REQUESTED',
      }).session(session);
      if (existing) return existing;
      await assertNoPaymentCorrection(order.id, session);
      const guarded = await OrderModel.updateOne(
        { _id: order._id, version: order.version },
        { $inc: { version: 1 } },
        { session },
      );
      if (!guarded.modifiedCount) throw new ConflictError('CONFLICT', 'Đơn vừa được cập nhật.');
      const [created] = await CancelRequestModel.create(
        [
          {
            orderId: order._id,
            tableSessionId: order.tableSessionId,
            participantId,
            reason,
            status: 'REQUESTED',
          },
        ],
        { session },
      );
      if (!created) throw new Error('Failed to create cancel request');
      await auditRepository.log(
        {
          actorType: 'GUEST',
          participantId,
          action: 'cancelRequest.created',
          entityType: 'CancelRequest',
          entityId: created.id,
          metadata: { orderId },
        },
        session,
      );
      await outboxRepository.createRealtimeEvents(
        cancelEvents(
          created.id,
          order.id,
          order.tableSessionId?.toString() ?? '',
          participantId,
          'cancelRequest.created',
          created.version,
          { status: created.status, reason, orderCode: order.code },
        ),
        session,
      );
      return created;
    });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      const raced = await CancelRequestModel.findOne({
        orderId,
        participantId,
        status: 'REQUESTED',
      });
      if (raced) return raced;
    }
    throw error;
  }
}

export async function listOpenCancelRequests() {
  return CancelRequestModel.find({ status: 'REQUESTED' })
    .sort({ createdAt: 1 })
    .populate('orderId', 'code tableId status items total paidAmount version paymentStatus');
}

export async function decideCancelRequest(
  id: string,
  decision: 'APPROVED' | 'REJECTED',
  actorId: string,
  expectedVersion: number,
  note?: string,
  refundConfirmed?: boolean,
  refundMethod?: 'CASH' | 'BANK_TRANSFER' | 'OTHER',
) {
  return unitOfWork.withTransaction(async (session) => {
    const request = await CancelRequestModel.findById(id).session(session);
    if (!request) throw new NotFoundError('Không tìm thấy yêu cầu hủy.');
    if (request.status !== 'REQUESTED' || request.version !== expectedVersion)
      throw new ConflictError('CONFLICT', 'Yêu cầu đã được nhân viên khác xử lý.');
    const order = await orderRepository.findById(request.orderId.toString(), session);
    if (!order) throw new NotFoundError('Đơn không tồn tại.');
    if (
      decision === 'APPROVED' &&
      !['AWAITING_PAYMENT', 'PENDING', 'CONFIRMED'].includes(order.status)
    )
      throw new ConflictError(
        'STATE_TRANSITION_INVALID',
        'Đơn đã chuyển sang pha chế nên không thể duyệt hủy.',
      );
    if (
      decision === 'APPROVED' &&
      (order.paymentStatus === 'PAID' || (order.paidAmount ?? 0) > 0)
    ) {
      if (!refundConfirmed || !refundMethod)
        throw new ForbiddenError('Cần xác nhận đã hoàn đủ tiền trước khi duyệt hủy.');
      await recordOrderRefund(order, actorId, request.reason, refundMethod, session);
    }
    const updatedRequest = await CancelRequestModel.findOneAndUpdate(
      { _id: id, status: 'REQUESTED', version: expectedVersion },
      {
        $set: {
          status: decision,
          decidedBy: actorId,
          decidedAt: new Date(),
          decisionNote: note ?? '',
        },
        $inc: { version: 1 },
      },
      { new: true, session },
    );
    if (!updatedRequest) throw new ConflictError('CONFLICT', 'Yêu cầu đã được xử lý.');
    let updatedOrder = order;
    if (decision === 'APPROVED') {
      if (order.paymentStatus !== 'PAID' && (order.paidAmount ?? 0) === 0)
        await guardUnpaidCancellation(order.tableSessionId?.toString() ?? '', session);
      const cancelled = await orderRepository.transitionStatus(
        order.id,
        order.version,
        'CANCELLED',
        { from: order.status, by: actorId, reason: `Duyệt yêu cầu hủy: ${request.reason}` },
        session,
      );
      if (!cancelled) throw new ConflictError('CONFLICT', 'Đơn vừa được cập nhật.');
      updatedOrder = cancelled;
    }
    await auditRepository.log(
      {
        actorType: 'USER',
        actorId,
        action: `cancelRequest.${decision.toLowerCase()}`,
        entityType: 'CancelRequest',
        entityId: id,
        metadata: { orderId: order.id, note },
      },
      session,
    );
    const events = cancelEvents(
      id,
      order.id,
      order.tableSessionId?.toString() ?? '',
      request.participantId,
      'cancelRequest.resolved',
      updatedRequest.version,
      { status: decision, decisionNote: note ?? '' },
    );
    if (decision === 'APPROVED') events.push(...orderEvents(updatedOrder));
    await outboxRepository.createRealtimeEvents(events, session);
    return { request: updatedRequest, order: updatedOrder };
  });
}

function cancelEvents(
  requestId: string,
  orderId: string,
  tableSessionId: string,
  participantId: string,
  eventType: 'cancelRequest.created' | 'cancelRequest.resolved',
  version: number,
  extra: Record<string, unknown>,
): RealtimeOutboxInput[] {
  const base = {
    eventType,
    aggregateType: 'CancelRequest',
    aggregateId: requestId,
    aggregateVersion: version,
    payload: { requestId, orderId, tableSessionId, version, ...extra },
  } as const;
  return [
    { ...base, target: { scope: 'staff' } },
    { ...base, target: { scope: 'guest', tableSessionId, participantId } },
  ];
}
function orderEvents(order: OrderDoc): RealtimeOutboxInput[] {
  const tableSessionId = order.tableSessionId?.toString() ?? '';
  const base = {
    eventType: 'order.statusChanged' as const,
    aggregateType: 'Order',
    aggregateId: order.id,
    aggregateVersion: order.version,
    payload: { orderId: order.id, tableSessionId, status: order.status, version: order.version },
  };
  return [
    { ...base, target: { scope: 'staff' } },
    { ...base, target: { scope: 'guest', tableSessionId, participantId: order.participantId } },
  ];
}
