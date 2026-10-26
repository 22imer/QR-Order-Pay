import crypto from 'node:crypto';
import sharp from 'sharp';
import type { ClientSession } from 'mongoose';
import { z } from 'zod';
import {
  CUP_PHOTO_MAX_BYTES,
  CUP_PHOTO_MAX_PIXELS,
  cupPhotoIdSchema,
  cupPrintInputSchema,
  type CupPrintOrder,
} from '@may-cafe/contracts';
import { CupPhotoModel, CupPhotoOwnerModel, CupPrintAttemptModel } from '../models/CupPhoto.js';
import { OrderModel } from '../models/Order.js';
import { TableSessionModel } from '../models/TableSession.js';
import { unitOfWork } from '../infrastructure/unitOfWork.js';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../errors/AppError.js';
import { auditRepository } from '../repositories/auditRepository.js';
export interface PhotoActor {
  owner: string;
  tableSessionId?: string;
  userId?: string;
}
const DAY = 86400000;
let processing = 0;
const formats: Record<string, string> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
};
export function photoOwner(tableSessionId: string, participantId: string) {
  return tableSessionId.startsWith('pickup:')
    ? participantId
    : `guest:${tableSessionId}:${participantId}`;
}
export async function normalizeCupPhoto(input: Buffer, mime: string) {
  if (!formats[mime])
    throw new AppError('PHOTO_TYPE', 'Chỉ nhận ảnh JPEG, PNG hoặc WebP tĩnh.', 415);
  if (!input.length || input.length > CUP_PHOTO_MAX_BYTES)
    throw new AppError('PHOTO_SIZE', 'Ảnh tối đa 4 MB.', 413);
  // Reject vector/other decoders before passing bytes to libvips.
  const detected = input.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
    ? 'jpeg'
    : input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? 'png'
      : input.toString('ascii', 0, 4) === 'RIFF' && input.toString('ascii', 8, 12) === 'WEBP'
        ? 'webp'
        : '';
  if (detected !== formats[mime]) throw new ValidationError('Dữ liệu ảnh không đúng định dạng.');
  if (processing >= 2)
    throw new AppError('PHOTO_BUSY', 'Máy chủ đang xử lý ảnh. Thử lại sau ít giây.', 429);
  processing += 1;
  try {
    const image = sharp(input, { limitInputPixels: CUP_PHOTO_MAX_PIXELS, failOn: 'warning' });
    const meta = await image.metadata();
    if (
      meta.format !== detected ||
      (meta.pages ?? 1) > 1 ||
      !meta.width ||
      !meta.height ||
      meta.width < 64 ||
      meta.height < 64
    )
      throw new Error('dimensions/animation');
    const result = await image
      .rotate()
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
    if (result.data.length > 1024 * 1024) throw new Error('output too large');
    return { data: result.data, width: result.info.width, height: result.info.height };
  } catch {
    throw new ValidationError(
      'Ảnh lỗi, ảnh động hoặc kích thước không hợp lệ (64 px tối thiểu, tối đa 16 triệu điểm ảnh).',
    );
  } finally {
    processing -= 1;
  }
}
export async function uploadCupPhoto(
  actor: PhotoActor,
  rawKey: unknown,
  input: Buffer,
  mime: string,
) {
  const requestId = z.string().uuid().parse(rawKey),
    sourceHash = crypto.createHash('sha256').update(mime).update(input).digest('hex');
  const result = await normalizeCupPhoto(input, mime);
  return unitOfWork.withTransaction(async (session) => {
    if (
      actor.tableSessionId &&
      !(await TableSessionModel.findOneAndUpdate(
        { _id: actor.tableSessionId, status: 'OPEN' },
        { $inc: { version: 1 } },
        { session },
      ))
    )
      throw new ForbiddenError('Chỉ tải ảnh khi phiên bàn đang mở.');
    await CupPhotoOwnerModel.findOneAndUpdate(
      { _id: actor.owner },
      { $inc: { version: 1 }, $set: { expiresAt: new Date(Date.now() + 31 * DAY) } },
      { upsert: true, session },
    );
    const old = await CupPhotoModel.findOne({ owner: actor.owner, requestId }).session(session);
    if (old) {
      if (old.sourceHash !== sourceHash)
        throw new ConflictError('PHOTO_REPLAY', 'Yêu cầu tải ảnh đã dùng cho ảnh khác.');
      if (old.expiresAt.getTime() <= Date.now())
        throw new ConflictError('PHOTO_EXPIRED', 'Ảnh đã hết hạn. Hãy chọn ảnh lại.');
      return {
        id: old.id,
        width: old.width,
        height: old.height,
        expiresAt: old.expiresAt.toISOString(),
      };
    }
    if (
      (await CupPhotoModel.countDocuments({
        owner: actor.owner,
        createdAt: { $gt: new Date(Date.now() - DAY) },
      }).session(session)) >= 20
    )
      throw new ConflictError('PHOTO_LIMIT', 'Tối đa 20 ảnh trong 24 giờ.');
    const [photo] = await CupPhotoModel.create(
      [
        {
          owner: actor.owner,
          requestId,
          sourceHash,
          ...result,
          expiresAt: new Date(Date.now() + DAY),
        },
      ],
      { session },
    );
    await auditRepository.log(
      {
        actorType: actor.userId ? 'USER' : 'GUEST',
        actorId: actor.userId,
        action: 'cupPhoto.uploaded',
        entityType: 'CupPhoto',
        entityId: photo!.id,
      },
      session,
    );
    return {
      id: photo!.id,
      width: photo!.width,
      height: photo!.height,
      expiresAt: photo!.expiresAt.toISOString(),
    };
  });
}
export async function ownCupPhoto(actor: PhotoActor, id: unknown) {
  const photo = await CupPhotoModel.findOne({
    _id: cupPhotoIdSchema.parse(id),
    owner: actor.owner,
    expiresAt: { $gt: new Date() },
  }).select('+data');
  if (!photo) throw new NotFoundError('Ảnh không còn hoặc không thuộc bạn.');
  return photo.data;
}
export async function assertCupPhotos(
  items: { cupPhotoId?: string }[],
  owner: string,
  session?: ClientSession,
  attach = false,
) {
  const ids = [
    ...new Set(items.flatMap((i) => (i.cupPhotoId ? [cupPhotoIdSchema.parse(i.cupPhotoId)] : []))),
  ];
  for (const id of ids) {
    const filter = { _id: id, owner, expiresAt: { $gt: new Date() } };
    const photo = attach
      ? await CupPhotoModel.findOneAndUpdate(
          filter,
          { $max: { expiresAt: new Date(Date.now() + 30 * DAY) } },
          { session },
        )
      : await CupPhotoModel.findOne(filter).session(session ?? null);
    if (!photo)
      throw new ValidationError(
        'Ảnh đính kèm đã hết hạn hoặc không thuộc bạn. Chọn lại ảnh trong giỏ.',
      );
  }
}
const paid = {
  paymentStatus: 'PAID',
  status: { $in: ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED'] },
};
async function printItem(rawId: unknown, rawIndex: unknown, session?: ClientSession) {
  const id = cupPhotoIdSchema.parse(rawId),
    index = z.coerce.number().int().min(0).max(9999).parse(rawIndex);
  const order = await OrderModel.findOne({ _id: id, ...paid }).session(session ?? null);
  const item = order?.items[index];
  if (!order || !item?.cupPhotoId)
    throw new NotFoundError('Chỉ in ảnh của món trong đơn đã thanh toán, còn hiệu lực.');
  const photo = await CupPhotoModel.findOne({
    _id: item.cupPhotoId,
    expiresAt: { $gt: new Date() },
  })
    .select('+data')
    .session(session ?? null);
  if (!photo) throw new NotFoundError('Ảnh đã hết hạn lưu trữ.');
  return { order, item, photo };
}
export async function staffCupPhoto(id: unknown, index: unknown) {
  return (await printItem(id, index)).photo.data;
}
export async function cupPrintFeed(rawPage: unknown) {
  const page = z.coerce.number().int().min(1).max(10000).default(1).parse(rawPage),
    filter = { ...paid, 'items.cupPhotoId': { $type: 'objectId' } };
  const total = await OrderModel.countDocuments(filter),
    orders = await OrderModel.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * 20)
      .limit(20);
  const result: CupPrintOrder[] = [];
  for (const order of orders) {
    const ids = order.items.flatMap((i) => (i.cupPhotoId ? [i.cupPhotoId] : []));
    const available = new Set(
      (
        await CupPhotoModel.find({ _id: { $in: ids }, expiresAt: { $gt: new Date() } }).select(
          '_id',
        )
      ).map((p) => p.id),
    );
    const counts = await CupPrintAttemptModel.find({ orderId: order._id });
    result.push({
      id: order.id,
      code: order.code,
      destination: order.gift
        ? `${order.gift.recipientTableCode} · ${order.gift.recipientTableName}`
        : order.fulfillmentType !== 'DINE_IN'
          ? 'Nhận tại quầy'
          : 'Phục vụ tại bàn',
      status: order.status,
      createdAt: order.createdAt.toISOString(),
      items: order.items.flatMap((i, index) =>
        i.cupPhotoId
          ? [
              {
                index,
                name: i.nameSnapshot,
                size: i.sizeName ?? '',
                quantity: i.quantity,
                available: available.has(String(i.cupPhotoId)),
                attempts: counts.filter((p) => p.itemIndex === index).length,
              },
            ]
          : [],
      ),
    });
  }
  return { items: result, page, total, pages: Math.ceil(total / 20) };
}
export async function requestCupPrint(userId: string, input: unknown) {
  const body = cupPrintInputSchema.parse(input),
    hash = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
  // Unique journal also serializes replay; order write conflicts with cancellation/refund.
  const replay = async () => {
    const old = await CupPrintAttemptModel.findOne({ userId, requestId: body.requestId });
    if (old && old.hash !== hash)
      throw new ConflictError('PRINT_REPLAY', 'Yêu cầu in đã dùng cho nội dung khác.');
    return old;
  };
  const old = await replay();
  if (old) {
    await printItem(body.orderId, body.itemIndex);
    return { id: old.id, state: 'REQUESTED' };
  }
  try {
    return await unitOfWork.withTransaction(async (session) => {
      const { order, item } = await printItem(body.orderId, body.itemIndex, session);
      if (body.copies > item.quantity)
        throw new ValidationError('Số tem không vượt số cốc của dòng món.');
      await OrderModel.updateOne({ _id: order._id }, { $inc: { version: 1 } }, { session });
      const [attempt] = await CupPrintAttemptModel.create([{ userId, ...body, hash }], { session });
      await auditRepository.log(
        {
          actorType: 'USER',
          actorId: userId,
          action: 'cupPhoto.printRequested',
          entityType: 'Order',
          entityId: order.id,
          metadata: { itemIndex: body.itemIndex, copies: body.copies, paper: body.paper },
        },
        session,
      );
      return { id: attempt!.id, state: 'REQUESTED' };
    });
  } catch (error) {
    const raced = await replay();
    if (raced) {
      await printItem(body.orderId, body.itemIndex);
      return { id: raced.id, state: 'REQUESTED' };
    }
    throw error;
  }
}
