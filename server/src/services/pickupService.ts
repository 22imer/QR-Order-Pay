import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {
  pickupCreateSchema,
  pickupDetailsSchema,
  pickupActionSchema,
  pickupDtoSchema,
  type PickupCreate,
} from '@may-cafe/contracts';
import { OrderModel, type OrderDoc } from '../models/Order.js';
import { BillModel } from '../models/Bill.js';
import { MemberModel } from '../models/Member.js';
import { UserModel } from '../models/User.js';
import { unitOfWork } from '../infrastructure/unitOfWork.js';
import { auditRepository } from '../repositories/auditRepository.js';
import { outboxRepository } from '../repositories/outboxRepository.js';
import { orderRepository } from '../repositories/orderRepository.js';
import { createOrderQuote, priceOrderWithBenefits, validateQuote } from './orderPricingService.js';
import { reserveOrderInventory } from './orderInventoryService.js';
import { reserveBenefits } from './promotionService.js';
import { orderRealtimeEvents } from './orderService.js';
import { toGuestOrder } from './orderDto.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../errors/AppError.js';
import { randomShortCode } from '../utils/crypto.js';
import { assertNoPaymentCorrection } from './paymentCorrectionService.js';
import { finalizePickupBill } from './pickupBillService.js';
import { assertCupPhotos } from './cupPhotoService.js';
import { assertFreestyleScope } from './freestyleService.js';

export interface PickupActor {
  id: string;
  staff: boolean;
}
const digest = (v: unknown) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const participant = (a: PickupActor) => `${a.staff ? 'counter' : 'member'}:${a.id}`;
const pickupFilter = { fulfillmentType: { $in: ['TAKEAWAY', 'PICKUP'] } };
export async function assertPickupId(id: string) {
  if (!(await OrderModel.exists({ _id: id, ...pickupFilter }))) throw new NotFoundError();
  return id;
}
function checkTime(details: PickupCreate['pickup']) {
  if (!details.scheduledAt) return;
  const delta = new Date(details.scheduledAt).getTime() - Date.now();
  if (delta < 15 * 60000 || delta > 7 * 86400000)
    throw new ValidationError('Giờ nhận cần cách hiện tại ít nhất 15 phút và tối đa 7 ngày.');
}
const scope = (a: PickupActor, pickup: PickupCreate['pickup']) =>
  `pickup:${participant(a)}:${digest(pickup)}`;
export async function quotePickup(actor: PickupActor, raw: unknown) {
  const parsed = pickupCreateSchema.omit({ quoteToken: true }).parse(raw);
  const pickup = pickupDetailsSchema.parse(parsed.pickup);
  checkTime(pickup);
  return createOrderQuote(
    {
      ...parsed,
      tableSessionId: scope(actor, pickup),
      participantId: participant(actor),
      memberId: actor.staff ? null : actor.id,
    },
    true,
  );
}
export async function createPickup(actor: PickupActor, raw: unknown) {
  const input = pickupCreateSchema.parse(raw);
  const owner = participant(actor);
  const requestHash = digest({ ...input, quoteToken: undefined });
  const replay = async () => {
    const order = await OrderModel.findOne({
      ...pickupFilter,
      participantId: owner,
      idempotencyKey: input.requestId,
    });
    if (!order) return null;
    if (order.requestHash !== requestHash)
      throw new ConflictError('IDEMPOTENCY_CONFLICT', 'Mã yêu cầu đã dùng cho nội dung khác.');
    return { order, created: false };
  };
  const existing = await replay();
  if (existing) return existing;
  checkTime(input.pickup);
  for (let attempt = 0; ; attempt++) {
    try {
      return await unitOfWork.withTransaction(async (session) => {
        // Serialize the active limit and account disable with placement.
        const account = actor.staff
          ? await UserModel.findOneAndUpdate(
              { _id: actor.id, isActive: true, isDeleted: { $ne: true } },
              { $inc: { __v: 1 } },
              { session },
            )
          : await MemberModel.findOneAndUpdate(
              { _id: actor.id, isActive: true },
              { $inc: { version: 1 } },
              { session },
            );
        if (!account) throw new ForbiddenError('Tài khoản không còn hoạt động.');
        if (
          !actor.staff &&
          (await OrderModel.countDocuments({
            ...pickupFilter,
            participantId: owner,
            'pickup.outcome': 'ACTIVE',
            status: { $ne: 'CANCELLED' },
          }).session(session)) >= 3
        )
          throw new ForbiddenError(
            'Bạn có 3 đơn mang đi chưa kết thúc. Vui lòng nhận hoặc hủy trước khi đặt thêm.',
          );
        await assertFreestyleScope(input.items, owner, session);
        const priced = await priceOrderWithBenefits(
          input.items,
          { ...input, memberId: actor.staff ? null : actor.id },
          session,
        );
        validateQuote(
          { ...input, tableSessionId: scope(actor, input.pickup), participantId: owner },
          priced,
        );
        const orderId = new mongoose.Types.ObjectId(),
          code = `MD${randomShortCode(6)}`;
        if (priced.benefits) await reserveBenefits(String(orderId), code, priced.benefits, session);
        const inventorySnapshot = await reserveOrderInventory(
          priced.items,
          String(orderId),
          session,
        );
        const b = priced.benefits;
        await assertCupPhotos(input.items, owner, session, true);
        const order = await orderRepository.createWithSession(
          {
            _id: orderId,
            code,
            tableSessionId: null,
            tableId: null,
            participantId: owner,
            fulfillmentType: input.pickup.fulfillmentType,
            pickup: { ...input.pickup, createdBy: actor.staff ? actor.id : null },
            items: priced.items,
            total: priced.total,
            subtotal: b?.subtotal ?? priced.total,
            memberId: b?.memberId ?? null,
            voucherId: b?.voucherId ?? null,
            voucherCode: b?.voucherCode ?? '',
            voucherDiscount: b?.voucherDiscount ?? 0,
            pointsDiscount: b?.pointsDiscount ?? 0,
            redeemedPoints: b?.redeemedPoints ?? 0,
            inventorySnapshot,
            inventoryState: inventorySnapshot.length ? 'RESERVED' : 'NONE',
            status: 'AWAITING_PAYMENT',
            paymentStatus: 'UNPAID',
            paidAmount: 0,
            idempotencyKey: input.requestId,
            requestHash,
            statusHistory: [
              {
                from: null,
                to: 'AWAITING_PAYMENT',
                at: new Date(),
                by: actor.staff ? actor.id : null,
                byParticipantId: actor.staff ? null : owner,
              },
            ],
          },
          session,
        );
        await auditRepository.log(
          {
            actorType: actor.staff ? 'USER' : 'GUEST',
            actorId: actor.staff ? actor.id : null,
            participantId: owner,
            action: 'pickup.created',
            entityType: 'Order',
            entityId: order.id,
            metadata: { code, fulfillmentType: order.fulfillmentType },
          },
          session,
        );
        await outboxRepository.createRealtimeEvents(
          orderRealtimeEvents(order, 'order.created'),
          session,
        );
        return { order, created: true };
      });
    } catch (e) {
      const raced = await replay();
      if (raced) return raced;
      if (
        (e as { code?: number; keyPattern?: { code?: number } }).code === 11000 &&
        (e as { keyPattern?: { code?: number } }).keyPattern?.code &&
        attempt < 3
      )
        continue;
      throw e;
    }
  }
}
export async function pickupDto(order: OrderDoc) {
  if (!order.pickup) throw new NotFoundError('Đơn mang đi không tồn tại.');
  const bill = await BillModel.findOne({ pickupOrderId: order._id }).select('_id');
  return pickupDtoSchema.parse({
    ...toGuestOrder(order),
    version: order.version,
    pickup: {
      name: order.pickup.name,
      phone: order.pickup.phone,
      scheduledAt: order.pickup.scheduledAt?.toISOString() ?? null,
      outcome: order.pickup.outcome,
      closedAt: order.pickup.closedAt?.toISOString() ?? null,
      reason: order.pickup.reason,
    },
    billId: bill?.id ?? null,
  });
}
export async function listPickups(actor: PickupActor, page: number, history: boolean) {
  const filter = {
    ...pickupFilter,
    ...(actor.staff ? {} : { participantId: participant(actor) }),
    ...(history ? {} : { 'pickup.outcome': 'ACTIVE', status: { $ne: 'CANCELLED' } }),
  };
  const [orders, total] = await Promise.all([
    OrderModel.find(filter)
      .sort(history ? { createdAt: -1 } : { 'pickup.scheduledAt': 1, createdAt: 1 })
      .skip((page - 1) * 30)
      .limit(30),
    OrderModel.countDocuments(filter),
  ]);
  return { items: await Promise.all(orders.map(pickupDto)), total, page, limit: 30 };
}
export async function closePickup(actor: PickupActor, id: string, raw: unknown, noShow = false) {
  const input = pickupActionSchema.parse(raw);
  return unitOfWork.withTransaction(async (session) => {
    const order = await OrderModel.findOne({ _id: id, ...pickupFilter }).session(session);
    if (!order?.pickup) throw new NotFoundError('Đơn mang đi không tồn tại.');
    if (!actor.staff && order.participantId !== participant(actor))
      throw new ForbiddenError('Đơn không thuộc tài khoản này.');
    if (noShow && !actor.staff) throw new ForbiddenError();
    if (order.pickup.outcome === 'NO_SHOW' && noShow) return order;
    if (!noShow && order.status === 'CANCELLED') return order;
    if (order.pickup.outcome !== 'ACTIVE' || order.version !== input.expectedVersion)
      throw new ConflictError('CONFLICT', 'Đơn đã thay đổi, vui lòng tải lại.');
    await assertNoPaymentCorrection(order.id, session);
    if (noShow) {
      const due = order.pickup.scheduledAt?.getTime() ?? order.createdAt.getTime() + 30 * 60000;
      if (Date.now() < due + 30 * 60000)
        throw new ValidationError('Chỉ ghi không đến khi quá giờ nhận ít nhất 30 phút.');
    }
    const collected = order.paidAmount ?? (order.paymentStatus === 'PAID' ? order.total : 0);
    let updated: OrderDoc = order;
    if (['AWAITING_PAYMENT', 'PENDING', 'CONFIRMED'].includes(order.status)) {
      if (collected > 0 || order.paymentStatus === 'PAID')
        throw new ForbiddenError('Cần xác nhận hoàn tiền trước khi hủy đơn đã thu.');
      updated = (await orderRepository.transitionStatus(
        order.id,
        order.version,
        'CANCELLED',
        {
          from: order.status,
          by: actor.staff ? actor.id : null,
          byParticipantId: actor.staff ? null : participant(actor),
          reason: input.reason,
        },
        session,
      ))!;
    } else if (!(
      noShow &&
      actor.staff &&
      ['PREPARING', 'READY', 'CANCELLED'].includes(order.status)
    )) {
      throw new ForbiddenError('Đơn đang pha hoặc đã giao, không thể hủy.');
    }
    if (!updated) throw new ConflictError('CONFLICT', 'Đơn vừa được cập nhật.');
    if (noShow) {
      updated.pickup!.outcome = 'NO_SHOW';
      updated.pickup!.closedAt = new Date();
      updated.pickup!.reason = input.reason;
      updated.version += 1;
      await updated.save({ session });
      if (updated.paymentStatus === 'PAID') await finalizePickupBill(updated, actor.id, session);
    }
    await auditRepository.log(
      {
        actorType: actor.staff ? 'USER' : 'GUEST',
        actorId: actor.staff ? actor.id : null,
        participantId: participant(actor),
        action: noShow ? 'pickup.noShow' : 'pickup.cancelled',
        entityType: 'Order',
        entityId: id,
        metadata: { reason: input.reason },
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
export async function getPickupBill(actor: PickupActor, orderId: string) {
  const order = await OrderModel.findOne({ _id: orderId, ...pickupFilter });
  if (!order || (!actor.staff && order.participantId !== participant(actor)))
    throw new NotFoundError();
  const bill = await BillModel.findOne({ pickupOrderId: order._id });
  if (!bill) throw new NotFoundError('Đơn chưa có hóa đơn đã chốt.');
  // No contact details, employee IDs, original payment IDs or other customers' orders.
  return {
    invoiceCode: bill.invoiceCode,
    title: bill.tableName,
    closedAt: bill.closedAt,
    total: bill.total,
    order: bill.orders.map((o) => ({
      code: o.code,
      subtotal: o.subtotal,
      voucherCode: o.voucherCode,
      voucherDiscount: o.voucherDiscount,
      pointsDiscount: o.pointsDiscount,
      redeemedPoints: o.redeemedPoints,
      total: o.total,
      items: o.items.map((i) => ({
        name: i.nameSnapshot,
        size: i.sizeName,
        sugarLevel: i.sugarLevel,
        iceLevel: i.iceLevel,
        toppings: [...i.toppingNamesSnapshot],
        note: i.note,
        quantity: i.quantity,
        lineTotal: i.lineTotal,
      })),
    }))[0],
  };
}
