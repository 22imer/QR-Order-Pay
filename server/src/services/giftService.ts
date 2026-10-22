import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { z } from 'zod';
import { giftCreateSchema, giftActionSchema, type GiftView } from '@may-cafe/contracts';
import { GiftModel, type GiftDoc } from '../models/Gift.js';
import { TableSessionModel } from '../models/TableSession.js';
import { TableModel } from '../models/Table.js';
import { GuestSessionModel } from '../models/GuestSession.js';
import { OrderModel } from '../models/Order.js';
import { unitOfWork } from '../infrastructure/unitOfWork.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../errors/AppError.js';
import { priceOrderItems } from './orderPricingService.js';
import { giftChanged, lockGiftSessions } from './giftGuards.js';
import { logger } from '../infrastructure/logger.js';

export interface GiftActor {
  tableSessionId: string;
  participantId: string;
}
const WINDOW_MS = 5 * 60000;
const active = () => ({ status: { $in: ['PENDING', 'ACCEPTED'] }, expiresAt: { $gt: new Date() } });

export async function giftTables(actor: GiftActor) {
  const source = await TableSessionModel.findOne({ _id: actor.tableSessionId, status: 'OPEN' });
  if (!source) throw new ForbiddenError('Vui lòng vào bàn đang mở để gửi quà.');
  const sessions = await TableSessionModel.find({ status: 'OPEN', _id: { $ne: source._id } });
  const tables = await TableModel.find({ isActive: true, _id: { $ne: source.tableId } }).sort({
    code: 1,
  });
  const byTable = new Map(sessions.map((s) => [String(s.tableId), s]));
  const guests = await GuestSessionModel.distinct('tableSessionId', {
    tableSessionId: { $in: sessions.map((s) => s._id) },
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  });
  const occupied = new Set(guests.map(String));
  return {
    items: tables.map((t) => {
      const s = byTable.get(t.id);
      return {
        tableId: t.id,
        name: t.name,
        code: t.code,
        sessionId: s?.id ?? '',
        available: !!s && occupied.has(s.id),
      };
    }),
  };
}

export async function createGift(actor: GiftActor, raw: unknown) {
  const input = giftCreateSchema.parse(raw);
  // Missing/false keeps the hash of anonymous requests made before this option existed.
  const { showSenderTable, ...legacyInput } = input;
  const requestHash = crypto
    .createHash('sha256')
    .update(
      JSON.stringify({ ...legacyInput, ...(showSenderTable ? { showSenderTable: true } : {}) }),
    )
    .digest('hex');
  const owner = { senderSessionId: actor.tableSessionId, senderParticipantId: actor.participantId };
  const replay = async () => {
    const old = await GiftModel.findOne({ ...owner, requestId: input.requestId });
    if (old && old.requestHash !== requestHash)
      throw new ConflictError('IDEMPOTENCY_CONFLICT', 'Yêu cầu đã dùng cho quà khác.');
    return old ? viewGift(old, actor) : null;
  };
  const old = await replay();
  if (old) return old;
  try {
    return await unitOfWork.withTransaction(async (session) => {
      if (input.recipientSessionId === actor.tableSessionId)
        throw new ForbiddenError('Chọn một bàn khác.');
      await lockGiftSessions([actor.tableSessionId, input.recipientSessionId], session);
      const source = await TableSessionModel.findById(actor.tableSessionId).session(session);
      const senderTable = showSenderTable
        ? await TableModel.findById(source!.tableId).session(session)
        : null;
      if (showSenderTable && !senderTable) throw new NotFoundError('Bàn gửi không tồn tại.');
      const target = await TableSessionModel.findOne({
        _id: input.recipientSessionId,
        tableId: input.recipientTableId,
        status: 'OPEN',
      }).session(session);
      const table = await TableModel.findOne({
        _id: input.recipientTableId,
        isActive: true,
      }).session(session);
      const guest = await GuestSessionModel.exists({
        tableSessionId: input.recipientSessionId,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      }).session(session);
      if (!target || !table || !guest)
        throw new ConflictError(
          'GIFT_SESSION_UNAVAILABLE',
          'Bàn nhận chưa có khách hoặc vừa thay đổi.',
        );
      const recent = await GiftModel.countDocuments({
        ...owner,
        createdAt: { $gt: new Date(Date.now() - 10 * 60000) },
      }).session(session);
      if (
        recent >= 5 ||
        (await GiftModel.countDocuments({ ...owner, ...active() }).session(session)) >= 3 ||
        (await GiftModel.countDocuments({ recipientSessionId: target._id, ...active() }).session(
          session,
        )) >= 5
      )
        throw new ConflictError('GIFT_LIMIT', 'Đã đủ lời mời đang chờ. Vui lòng thử lại sau.');
      const priced = await priceOrderItems(input.items, session);
      const [gift] = await GiftModel.create(
        [
          {
            ...owner,
            ...input,
            requestHash,
            senderTableName: senderTable?.name ?? null,
            senderTableCode: senderTable?.code ?? null,
            recipientTableName: table.name,
            recipientTableCode: table.code,
            expiresAt: new Date(Date.now() + WINDOW_MS),
            items: input.items.map((i, index) => ({
              ...i,
              name: priced.items[index]!.nameSnapshot,
              variantName: priced.items[index]!.variantNameSnapshot,
              toppingNames: priced.items[index]!.toppingNamesSnapshot,
            })),
          },
        ],
        { session },
      );
      await giftChanged(gift!, session);
      return viewGift(gift!, actor);
    });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      const raced = await replay();
      if (raced) return raced;
    }
    throw error;
  }
}

function viewGift(gift: GiftDoc, actor: GiftActor, orderStatus: string | null = null): GiftView {
  const sent =
    String(gift.senderSessionId) === actor.tableSessionId &&
    gift.senderParticipantId === actor.participantId;
  return {
    id: gift.id,
    direction: sent ? 'SENT' : 'RECEIVED',
    status: gift.status,
    recipientTableName: gift.recipientTableName,
    showSenderTable: gift.showSenderTable === true,
    ...(gift.showSenderTable === true && gift.senderTableName && gift.senderTableCode
      ? { senderTable: { name: gift.senderTableName, code: gift.senderTableCode } }
      : {}),
    message: gift.message,
    items: gift.items.map((i) => ({
      productId: i.productId,
      variantId: i.variantId ?? null,
      sugarLevel: i.sugarLevel,
      iceLevel: i.iceLevel,
      toppingIds: [...i.toppingIds],
      note: i.note,
      quantity: i.quantity,
      name: i.name,
      variantName: i.variantName,
      toppingNames: [...i.toppingNames],
    })),
    expiresAt: gift.expiresAt.toISOString(),
    createdAt: gift.createdAt.toISOString(),
    version: gift.version,
    orderStatus,
    ...(sent ? { orderId: gift.orderId?.toString() ?? null } : {}),
  };
}

export async function listGifts(actor: GiftActor, raw: unknown) {
  const { page } = z
    .object({ page: z.coerce.number().int().min(1).max(10000).default(1) })
    .parse(raw);
  await expireGifts();
  const filter = {
    $or: [
      { senderSessionId: actor.tableSessionId, senderParticipantId: actor.participantId },
      { recipientSessionId: actor.tableSessionId },
    ],
  };
  const gifts = await GiftModel.find(filter)
    .sort({ createdAt: -1 })
    .skip((page - 1) * 30)
    .limit(30);
  const orders = await OrderModel.find({
    _id: { $in: gifts.flatMap((g) => (g.orderId ? [g.orderId] : [])) },
  }).select('status');
  const statuses = new Map(orders.map((o) => [o.id, o.status]));
  const incomingCount = await GiftModel.countDocuments({
    recipientSessionId: actor.tableSessionId,
    status: 'PENDING',
    expiresAt: { $gt: new Date() },
  });
  return {
    items: gifts.map((g) => viewGift(g, actor, statuses.get(String(g.orderId)) ?? null)),
    page,
    total: await GiftModel.countDocuments(filter),
    incomingCount,
  };
}

export async function decideGift(actor: GiftActor, id: string, raw: unknown) {
  const input = giftActionSchema.parse(raw);
  await expireGifts();
  return unitOfWork.withTransaction(async (session) => {
    const gift = await GiftModel.findById(id).session(session);
    if (!gift) throw new NotFoundError('Quà không tồn tại.');
    const sender =
      String(gift.senderSessionId) === actor.tableSessionId &&
      gift.senderParticipantId === actor.participantId;
    const recipient = String(gift.recipientSessionId) === actor.tableSessionId;
    if (input.decision === 'CANCEL' ? !sender : !recipient)
      throw new ForbiddenError('Bạn không có quyền xử lý quà này.');
    const next =
      input.decision === 'ACCEPT'
        ? 'ACCEPTED'
        : input.decision === 'DECLINE'
          ? 'DECLINED'
          : 'CANCELLED';
    // Retry by the same actor after a lost response is safe; another participant must refetch.
    if (
      gift.status === next &&
      gift.version === input.expectedVersion + 1 &&
      gift.decidedByParticipantId === actor.participantId
    )
      return viewGift(gift, actor);
    if (
      gift.version !== input.expectedVersion ||
      gift.expiresAt.getTime() <= Date.now() ||
      !(gift.status === 'PENDING' || (sender && gift.status === 'ACCEPTED'))
    )
      throw new ConflictError('GIFT_CHANGED', 'Quà đã được xử lý hoặc hết hạn. Vui lòng tải lại.');
    await lockGiftSessions(
      [String(gift.senderSessionId), String(gift.recipientSessionId)],
      session,
    );
    gift.status = next;
    gift.version++;
    gift.decidedByParticipantId = actor.participantId;
    if (next === 'ACCEPTED') gift.expiresAt = new Date(Date.now() + WINDOW_MS);
    await gift.save({ session });
    await giftChanged(gift, session);
    return viewGift(gift, actor);
  });
}

export async function expireGifts() {
  const candidates = await GiftModel.find({ status: { $in: ['PENDING', 'ACCEPTED'] } })
    .sort({ expiresAt: 1 })
    .limit(200);
  let count = 0;
  for (const candidate of candidates)
    await unitOfWork.withTransaction(async (session) => {
      const gift = await GiftModel.findOne({
        _id: candidate._id,
        status: { $in: ['PENDING', 'ACCEPTED'] },
      }).session(session);
      if (!gift) return;
      const open = await TableSessionModel.countDocuments({
        _id: { $in: [gift.senderSessionId, gift.recipientSessionId] },
        status: 'OPEN',
      }).session(session);
      if (gift.expiresAt.getTime() > Date.now() && open === 2) return;
      gift.status = 'EXPIRED';
      gift.version++;
      await gift.save({ session });
      await giftChanged(gift, session);
      count++;
    });
  return count;
}
export function startGiftSweeper() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await expireGifts();
    } catch (err) {
      logger.error({ err }, 'gift expiry failed');
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), 30000);
  timer.unref();
  return () => clearInterval(timer);
}

export const giftIdSchema = z
  .string()
  .refine((id) => mongoose.isValidObjectId(id), 'ID quà không hợp lệ.');
