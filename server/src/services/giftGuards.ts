import { Types, type ClientSession } from 'mongoose';
import { GiftModel, type GiftDoc } from '../models/Gift.js';
import { OrderModel } from '../models/Order.js';
import { TableSessionModel } from '../models/TableSession.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../errors/AppError.js';
import { outboxRepository } from '../repositories/outboxRepository.js';
import { auditRepository } from '../repositories/auditRepository.js';
import { giftItemInputSchema } from '@may-cafe/contracts';
import type { PlaceOrderItemInput } from './orderService.js';

export async function giftChanged(gift: GiftDoc, session: ClientSession) {
  const base = {
    eventType: 'gift.changed' as const,
    aggregateType: 'Gift',
    aggregateId: gift.id,
    aggregateVersion: gift.version,
    payload: { refresh: true },
  };
  await auditRepository.log(
    {
      actorType: gift.status === 'EXPIRED' ? 'SYSTEM' : 'GUEST',
      participantId: ['PENDING', 'ORDERED'].includes(gift.status)
        ? gift.senderParticipantId
        : gift.decidedByParticipantId,
      action: `gift.${gift.status.toLowerCase()}`,
      entityType: 'Gift',
      entityId: gift.id,
    },
    session,
  );
  await outboxRepository.createRealtimeEvents(
    [
      {
        ...base,
        target: {
          scope: 'guest',
          tableSessionId: String(gift.senderSessionId),
          participantId: gift.senderParticipantId,
        },
      },
      { ...base, target: { scope: 'session', tableSessionId: String(gift.recipientSessionId) } },
    ],
    session,
  );
}

export async function lockGiftSessions(ids: string[], session: ClientSession) {
  for (const id of [...new Set(ids)].sort()) {
    const locked = await TableSessionModel.findOneAndUpdate(
      { _id: id, status: 'OPEN' },
      { $inc: { version: 1 } },
      { session, new: true },
    );
    if (!locked)
      throw new ConflictError(
        'GIFT_SESSION_UNAVAILABLE',
        'Bàn gửi hoặc bàn nhận đã kết thúc nhận món.',
      );
  }
}

export async function claimGiftForOrder(
  id: string,
  senderSessionId: string,
  participantId: string,
  items: PlaceOrderItemInput[],
  orderId: string,
  session: ClientSession,
) {
  const gift = await GiftModel.findById(id).session(session);
  if (!gift) throw new NotFoundError('Quà không tồn tại.');
  if (
    String(gift.senderSessionId) !== senderSessionId ||
    gift.senderParticipantId !== participantId
  )
    throw new ForbiddenError('Chỉ người gửi được tạo đơn quà.');
  if (gift.status !== 'ACCEPTED' || gift.expiresAt.getTime() <= Date.now())
    throw new ConflictError('GIFT_NOT_ACCEPTED', 'Quà chưa được nhận hoặc đã hết hạn xác nhận.');
  const normalize = (values: PlaceOrderItemInput[]) =>
    values.map((i) => giftItemInputSchema.parse(i));
  if (
    JSON.stringify(normalize(items)) !==
    JSON.stringify(
      normalize(
        gift.items.map((i) => ({
          productId: i.productId,
          variantId: i.variantId ?? null,
          sugarLevel: i.sugarLevel,
          iceLevel: i.iceLevel,
          toppingIds: [...i.toppingIds],
          note: i.note,
          quantity: i.quantity,
          ...(i.freestyleToken ? { freestyleToken: i.freestyleToken } : {}),
          ...(i.cupPhotoId ? { cupPhotoId: i.cupPhotoId } : {}),
        })),
      ),
    )
  )
    throw new ConflictError('GIFT_ITEMS_CHANGED', 'Món phải đúng với quà bàn nhận đã đồng ý.');
  await lockGiftSessions([senderSessionId, String(gift.recipientSessionId)], session);
  const recipient = await TableSessionModel.findById(gift.recipientSessionId).session(session);
  if (String(recipient?.tableId) !== String(gift.recipientTableId))
    throw new ConflictError('GIFT_SESSION_UNAVAILABLE', 'Bàn nhận đã thay đổi.');
  gift.status = 'ORDERED';
  gift.orderId = new Types.ObjectId(orderId);
  gift.version++;
  await gift.save({ session });
  await giftChanged(gift, session);
  return {
    giftId: gift._id,
    recipientSessionId: gift.recipientSessionId,
    recipientTableId: gift.recipientTableId,
    recipientTableName: gift.recipientTableName,
    recipientTableCode: gift.recipientTableCode,
    message: gift.message,
  };
}

export async function assertNoIncomingGiftOrders(id: string, session: ClientSession) {
  if (
    await OrderModel.exists({
      'gift.recipientSessionId': id,
      status: { $nin: ['SERVED', 'CANCELLED'] },
    }).session(session)
  )
    throw new ConflictError(
      'GIFT_IN_PROGRESS',
      'Còn quà đang giao tới bàn. Hãy phục vụ hoặc hủy/hoàn hợp lệ trước khi đóng phiên.',
    );
}
export async function assertGiftTransferAllowed(id: string, session: ClientSession) {
  await assertNoIncomingGiftOrders(id, session);
  if (
    (await OrderModel.exists({
      tableSessionId: id,
      gift: { $ne: null },
      status: { $nin: ['SERVED', 'CANCELLED'] },
    }).session(session)) ||
    (await GiftModel.exists({
      $or: [{ senderSessionId: id }, { recipientSessionId: id }],
      status: { $in: ['PENDING', 'ACCEPTED'] },
      expiresAt: { $gt: new Date() },
    }).session(session))
  )
    throw new ConflictError(
      'GIFT_IN_PROGRESS',
      'Hãy kết thúc hoặc hủy lời mời/quà đang gửi trước khi chuyển bàn.',
    );
}
