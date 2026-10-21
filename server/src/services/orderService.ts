import crypto from 'node:crypto';
import { recordWorkActivity } from './workforceService.js';
import { orderRepository } from '../repositories/orderRepository.js';
import { unitOfWork } from '../infrastructure/unitOfWork.js';
import { auditRepository } from '../repositories/auditRepository.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../errors/AppError.js';
import type { OrderStatus } from '@may-cafe/contracts';
import { randomShortCode } from '../utils/crypto.js';
import type { OrderDoc } from '../models/Order.js';
import { OrderModel } from '../models/Order.js';
import { TableSessionModel } from '../models/TableSession.js';
import { tableSessionRepository } from '../repositories/tableSessionRepository.js';
import { outboxRepository, type RealtimeOutboxInput } from '../repositories/outboxRepository.js';
import { priceOrderWithBenefits, validateQuote } from './orderPricingService.js';
import { reserveBenefits } from './promotionService.js';
import { assertNoPaymentCorrection } from './paymentCorrectionService.js';
import { guardUnpaidCancellation } from './paymentClaimService.js';
import mongoose from 'mongoose';
import { reserveOrderInventory } from './orderInventoryService.js';
import { finalizePickupBill } from './pickupBillService.js';

export interface PlaceOrderItemInput {
  productId: string;
  variantId: string | null;
  sugarLevel: string;
  iceLevel: string;
  toppingIds: string[];
  note?: string;
  quantity: number;
}

export interface PlaceOrderInput {
  voucherCode?: string;
  redeemPoints?: number;
  memberId?: string | null;
  tableSessionId: string;
  participantId: string;
  idempotencyKey: string;
  items: PlaceOrderItemInput[];
  note?: string;
  quoteToken?: string;
}

const MAX_QUANTITY = 50;

export async function placeOrder(
  input: PlaceOrderInput,
): Promise<{ order: OrderDoc; created: boolean }> {
  const idempotencyKey = input.idempotencyKey?.slice(0, 64);
  if (!idempotencyKey) throw new ValidationError('Thiếu idempotency key.');
  if (!Array.isArray(input.items) || input.items.length === 0)
    throw new ValidationError('Đơn hàng cần ít nhất một món.');
  for (const it of input.items) {
    if (!Number.isInteger(it.quantity) || it.quantity < 1 || it.quantity > MAX_QUANTITY) {
      throw new ValidationError('Số lượng mỗi món phải là số nguyên từ 1 đến 50.');
    }
  }
  const requestHash = hashRequest({
    items: input.items,
    note: input.note,
    participantId: input.participantId,
    ...(input.voucherCode ? { voucherCode: input.voucherCode } : {}),
    ...(input.redeemPoints ? { redeemPoints: input.redeemPoints } : {}),
  });
  const replay = async () => {
    const existing = await orderRepository.findByIdempotency(input.tableSessionId, idempotencyKey);
    if (!existing) return null;
    if (existing.requestHash !== requestHash) {
      throw new ConflictError(
        'IDEMPOTENCY_CONFLICT',
        'Idempotency key đã được dùng với nội dung khác, vui lòng tạo yêu cầu mới.',
      );
    }
    if (existing.participantId !== input.participantId) {
      throw new ConflictError('IDEMPOTENCY_CONFLICT', 'Idempotency key không thuộc về phiên này.');
    }
    return { order: existing, created: false };
  };
  const replayed = await replay();
  if (replayed) return replayed;

  for (let attempt = 0; ; attempt++) {
    try {
      return { order: await createOrder(input, idempotencyKey, requestHash), created: true };
    } catch (error) {
      // Request cùng key có thể đã commit sau bước kiểm tra phía trên: trả lại đơn đó thay vì lỗi.
      if (isDuplicateKey(error, 'idempotencyKey')) {
        const raced = await replay();
        if (raced) return raced;
      }
      if (isDuplicateKey(error, 'code') && attempt < 3) continue;
      throw error;
    }
  }
}

function isDuplicateKey(error: unknown, field: string): boolean {
  const e = error as { code?: number; keyPattern?: Record<string, unknown> };
  return e?.code === 11000 && !!e.keyPattern && field in e.keyPattern;
}

async function createOrder(
  input: PlaceOrderInput,
  idempotencyKey: string,
  requestHash: string,
): Promise<OrderDoc> {
  const code = `MC${randomShortCode(5)}`;
  return unitOfWork.withTransaction(async (mongoSession) => {
    const open = await TableSessionModel.findOneAndUpdate(
      { _id: input.tableSessionId, status: 'OPEN' },
      { $inc: { version: 1 } },
      { session: mongoSession, new: true },
    );
    if (!open)
      throw new ForbiddenError('Phiên đang thanh toán hoặc đã đóng, không thể đặt thêm món.');
    const awaiting = await OrderModel.countDocuments({
      tableSessionId: input.tableSessionId,
      participantId: input.participantId,
      status: 'AWAITING_PAYMENT',
    }).session(mongoSession);
    if (awaiting >= 3)
      throw new ForbiddenError(
        'Bạn có 3 đơn đang chờ thanh toán. Vui lòng thanh toán hoặc hủy đơn trước khi gọi thêm.',
      );
    const priced = await priceOrderWithBenefits(input.items, input, mongoSession);
    validateQuote(
      {
        quoteToken: input.quoteToken,
        tableSessionId: input.tableSessionId,
        participantId: input.participantId,
        items: input.items,
      },
      priced,
    );
    const orderId = new mongoose.Types.ObjectId();
    if (priced.benefits)
      await reserveBenefits(String(orderId), code, priced.benefits, mongoSession);
    const inventorySnapshot = await reserveOrderInventory(
      priced.items,
      String(orderId),
      mongoSession,
    );
    const order = await orderRepository.createWithSession(
      {
        _id: orderId,
        inventorySnapshot,
        inventoryState: inventorySnapshot.length ? 'RESERVED' : 'NONE',
        code,
        tableSessionId: open._id,
        participantId: input.participantId,
        tableId: open.tableId,
        items: priced.items.map((it) => ({ ...it })),
        total: priced.total,
        subtotal: priced.benefits?.subtotal ?? priced.total,
        memberId: priced.benefits?.memberId ?? null,
        voucherId: priced.benefits?.voucherId ?? null,
        voucherCode: priced.benefits?.voucherCode ?? '',
        voucherDiscount: priced.benefits?.voucherDiscount ?? 0,
        pointsDiscount: priced.benefits?.pointsDiscount ?? 0,
        redeemedPoints: priced.benefits?.redeemedPoints ?? 0,
        status: 'AWAITING_PAYMENT' as OrderStatus,
        paymentStatus: 'UNPAID' as const,
        statusHistory: [
          {
            from: null,
            to: 'AWAITING_PAYMENT',
            at: new Date(),
            byParticipantId: input.participantId,
          },
        ],
        idempotencyKey,
        requestHash,
        version: 0,
        cancelReason: '',
      },
      mongoSession,
    );
    await auditRepository.log(
      {
        actorType: 'GUEST',
        participantId: input.participantId,
        action: 'order.placed',
        entityType: 'Order',
        entityId: order._id.toString(),
        metadata: { code: order.code, total: order.total },
      },
      mongoSession,
    );
    await outboxRepository.createRealtimeEvents(
      orderRealtimeEvents(order, 'order.created'),
      mongoSession,
    );
    return order;
  });
}

function hashRequest(payload: {
  voucherCode?: string;
  redeemPoints?: number;
  items: PlaceOrderItemInput[];
  note?: string;
  participantId: string;
}): string {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export async function cancelOrderByGuest(
  orderId: string,
  participantId: string,
): Promise<OrderDoc> {
  return unitOfWork.withTransaction(async (session) => {
    const order = await orderRepository.findById(orderId, session);
    if (!order) throw new NotFoundError('Đơn không tồn tại.');
    if (order.participantId !== participantId)
      throw new ForbiddenError('Bạn không thể hủy đơn của khách khác.');
    await assertNoPaymentCorrection(order.id, session);
    if (
      !['AWAITING_PAYMENT', 'PENDING'].includes(order.status) ||
      order.paymentStatus !== 'UNPAID' ||
      (order.paidAmount ?? 0) > 0
    )
      throw new ConflictError('STATE_TRANSITION_INVALID', 'Đơn đã được nhận, không thể hủy.');
    if (order.tableSessionId) await guardUnpaidCancellation(order.tableSessionId.toString(), session);
    const updated = await orderRepository.transitionStatus(
      orderId,
      order.version,
      'CANCELLED',
      {
        from: order.status,
        byParticipantId: participantId,
        reason: 'Khách hủy',
      },
      session,
    );
    if (!updated) throw new ConflictError('CONFLICT', 'Đơn vừa được cập nhật, vui lòng tải lại.');
    await auditRepository.log(
      {
        actorType: 'GUEST',
        participantId,
        action: 'order.cancelled',
        entityType: 'Order',
        entityId: orderId,
      },
      session,
    );
    await outboxRepository.createRealtimeEvents(
      orderRealtimeEvents(updated, 'order.statusChanged'),
      session,
    );
    return updated;
  });
}

export async function transitionByStaff(
  orderId: string,
  next: OrderStatus,
  actor: { id: string },
  reason?: string,
  expectedVersion?: number,
): Promise<OrderDoc> {
  return unitOfWork.withTransaction(async (session) => {
    const order = await orderRepository.findById(orderId, session);
    if (!order) throw new NotFoundError('Đơn không tồn tại.');
    if (expectedVersion !== undefined && order.version !== expectedVersion)
      throw new ConflictError('CONFLICT', 'Đơn vừa thay đổi. Vui lòng tải lại.');
    if (order.pickup && order.pickup.outcome !== 'ACTIVE')
      throw new ConflictError('CONFLICT', 'Đơn mang đi đã kết thúc.');
    if (next === 'PREPARING' && order.pickup?.scheduledAt &&
      Date.now() < order.pickup.scheduledAt.getTime() - 15 * 60000)
      throw new ForbiddenError('Chỉ pha đơn đặt trước từ 15 phút trước giờ nhận.');
    await assertNoPaymentCorrection(order.id, session);
    const allowed = allowedNext(order.status);
    if (next !== 'CANCELLED' && order.paymentStatus !== 'PAID')
      throw new ForbiddenError('Phải xác nhận đã nhận đủ tiền trước khi chuyển đơn sang pha chế.');
    if (next === 'CANCELLED' && (order.paymentStatus === 'PAID' || (order.paidAmount ?? 0) > 0))
      throw new ForbiddenError('Đơn đã thu tiền. Hãy dùng thao tác hủy và xác nhận hoàn tiền.');
    if (!allowed.includes(next)) {
      throw new ConflictError(
        'STATE_TRANSITION_INVALID',
        `Không thể chuyển đơn từ ${order.status} sang ${next}.`,
      );
    }
    if (next === 'CANCELLED' && order.tableSessionId)
      await guardUnpaidCancellation(order.tableSessionId.toString(), session);
    const updated = await orderRepository.transitionStatus(
      orderId,
      order.version,
      next,
      {
        from: order.status,
        by: actor.id,
        reason,
      },
      session,
    );
    if (!updated)
      throw new ConflictError(
        'CONFLICT',
        'Đơn vừa được cập nhật bởi người khác, vui lòng tải lại.',
      );
    await recordWorkActivity(orderId, next, actor.id, session);
    if (next === 'SERVED' && updated.pickup) {
      updated.pickup.outcome = 'COLLECTED';
      updated.pickup.closedAt = new Date();
      await updated.save({ session });
      await finalizePickupBill(updated, actor.id, session);
    }
    await auditRepository.log(
      {
        actorType: 'USER',
        actorId: actor.id,
        action: 'order.transition',
        entityType: 'Order',
        entityId: orderId,
        metadata: { from: order.status, to: next, reason },
      },
      session,
    );
    await outboxRepository.createRealtimeEvents(
      orderRealtimeEvents(updated, 'order.statusChanged'),
      session,
    );
    return updated;
  });
}

export function orderRealtimeEvents(
  order: OrderDoc,
  eventType: 'order.created' | 'order.statusChanged',
): RealtimeOutboxInput[] {
  if (!order.tableSessionId) return [{
    eventType, aggregateType: 'Order', aggregateId: order.id, aggregateVersion: order.version,
    payload: { orderId: order.id, status: order.status, version: order.version }, target: { scope: 'staff' },
  }];
  const tableSessionId = order.tableSessionId.toString();
  const payload = {
    orderId: order.id,
    tableSessionId,
    status: order.status,
    version: order.version,
  };
  const base = {
    eventType,
    aggregateType: 'Order',
    aggregateId: order.id,
    aggregateVersion: order.version,
    payload,
  } as const;
  return [
    { ...base, target: { scope: 'staff' } },
    { ...base, target: { scope: 'guest', tableSessionId, participantId: order.participantId } },
  ];
}

function allowedNext(from: OrderStatus): OrderStatus[] {
  if (from === 'AWAITING_PAYMENT') return ['CANCELLED'];
  if (from === 'PENDING') return ['CONFIRMED', 'CANCELLED'];
  if (from === 'CONFIRMED') return ['PREPARING', 'CANCELLED'];
  if (from === 'PREPARING') return ['READY'];
  if (from === 'READY') return ['SERVED'];
  return [];
}

export async function getOrderForGuest(orderId: string, participantId: string): Promise<OrderDoc> {
  const order = await orderRepository.findById(orderId);
  if (!order) throw new NotFoundError('Đơn không tồn tại.');
  if (order.participantId !== participantId)
    throw new ForbiddenError('Bạn không thể xem đơn của khách khác.');
  return order;
}

export async function listOrdersForStaff(status?: OrderStatus): Promise<OrderDoc[]> {
  const activeSessions = await tableSessionRepository.listOpen();
  return orderRepository.listForStaff({
    tableSessionIds: activeSessions.map((session) => session._id.toString()),
    status,
  });
}

export async function listOrdersForGuest(
  participantId: string,
  tableSessionId?: string,
): Promise<OrderDoc[]> {
  return (await orderRepository.list({ participantId, tableSessionId, limit: 50 })).items;
}
