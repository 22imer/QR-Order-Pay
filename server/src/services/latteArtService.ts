import crypto from 'node:crypto';
import sharp from 'sharp';
import {
  LATTE_STYLES,
  cupPhotoIdSchema,
  latteArtGenerateSchema,
  type LatteStyle,
} from '@may-cafe/contracts';
import { CupPhotoModel } from '../models/CupPhoto.js';
import { TableSessionModel } from '../models/TableSession.js';
import { unitOfWork } from '../infrastructure/unitOfWork.js';
import { auditRepository } from '../repositories/auditRepository.js';
import { AppError, ForbiddenError, NotFoundError, ValidationError } from '../errors/AppError.js';
import { cupPhotoView, lockPhotoOwner, type PhotoActor } from './cupPhotoService.js';

const SIZE = 1024,
  CONTENT = 660,
  DAY = 86400000;
let processing = 0;

/** Deterministic effects on the original pixels. No generative model or external upload. */
export async function renderLatteArtVariants(source: Buffer) {
  if (processing >= 2)
    throw new AppError('LATTE_BUSY', 'Đang xử lý ảnh khác. Thử lại sau ít giây.', 429);
  processing++;
  try {
    const original = await sharp(source, { limitInputPixels: 16000000, failOn: 'warning' })
      .rotate()
      .flatten({ background: '#fff' })
      .greyscale()
      .normalise({ lower: 1, upper: 99 })
      .resize({ width: CONTENT, height: CONTENT, fit: 'inside' })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height, channels } = original.info;
    const left = Math.floor((SIZE - width) / 2),
      top = Math.floor((SIZE - height) / 2);
    const results: { style: LatteStyle; data: Buffer; width: number; height: number }[] = [];
    for (const style of LATTE_STYLES) {
      const output = Buffer.alloc(SIZE * SIZE * 3, 255);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          let tone = original.data[(y * width + x) * channels]! / 255;
          if (style.id === 'SOFT') tone = Math.pow(tone, 0.85);
          if (style.id === 'BOLD') tone = tone < 0.48 ? 0 : tone < 0.72 ? 0.62 : 1;
          if (style.id === 'DOTS') {
            const cellX = Math.min(width - 1, Math.floor(x / 8) * 8 + 4);
            const cellY = Math.min(height - 1, Math.floor(y / 8) * 8 + 4);
            const brightness = original.data[(cellY * width + cellX) * channels]! / 255;
            const distance = Math.hypot((x % 8) - 3.5, (y % 8) - 3.5);
            tone = distance < Math.sqrt(1 - brightness) * 5.1 ? 0.08 : 1;
          }
          const index = ((top + y) * SIZE + left + x) * 3;
          // White means no ink; the coffee tint remains confined to the source image.
          output[index] = Math.round(87 + tone * 168);
          output[index + 1] = Math.round(43 + Math.pow(tone, 1.3) * 212);
          output[index + 2] = Math.round(21 + Math.pow(tone, 1.8) * 234);
        }
      const data = await sharp(output, { raw: { width: SIZE, height: SIZE, channels: 3 } })
        .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
        .toBuffer();
      if (data.length > 1024 * 1024) throw new Error('output too large');
      results.push({ style: style.id, data, width: SIZE, height: SIZE });
    }
    return results;
  } catch {
    throw new ValidationError('Chưa chuyển được ảnh sang latte art. Hãy thử ảnh rõ hơn.');
  } finally {
    processing--;
  }
}

export async function generateLatteArt(actor: PhotoActor, rawId: unknown, body: unknown) {
  const id = cupPhotoIdSchema.parse(rawId);
  latteArtGenerateSchema.parse(body);
  if (
    actor.tableSessionId &&
    !(await TableSessionModel.exists({ _id: actor.tableSessionId, status: 'OPEN' }))
  )
    throw new ForbiddenError('Chỉ tạo latte art khi phiên bàn đang mở.');
  const source = await CupPhotoModel.findOne({
    _id: id,
    owner: actor.owner,
    expiresAt: { $gt: new Date() },
  }).select('+data');
  if (!source) throw new NotFoundError('Ảnh gốc không còn hoặc không thuộc bạn.');
  if (source.kind === 'LATTE_ART')
    throw new ValidationError('Chọn ảnh gốc để tạo ba kiểu latte art.');
  const requests = LATTE_STYLES.map((style) => `latte-art:v1:${id}:${style.id}`);
  const existing = async (session?: import('mongoose').ClientSession) =>
    CupPhotoModel.find({
      owner: actor.owner,
      sourcePhotoId: id,
      kind: 'LATTE_ART',
      requestId: { $in: requests },
      expiresAt: { $gt: new Date() },
    }).session(session ?? null);
  const response = (photos: Awaited<ReturnType<typeof existing>>) => ({
    sourceId: id,
    variants: LATTE_STYLES.map((style) =>
      cupPhotoView(photos.find((photo) => photo.latteStyle === style.id)!),
    ),
  });
  const old = await existing();
  if (old.length === 3) return response(old);
  const rendered = await renderLatteArtVariants(source.data);
  return unitOfWork.withTransaction(async (session) => {
    await lockPhotoOwner(actor, session);
    if (
      !(await CupPhotoModel.exists({
        _id: id,
        owner: actor.owner,
        expiresAt: { $gt: new Date() },
      }).session(session))
    )
      throw new NotFoundError('Ảnh gốc đã hết hạn. Hãy tải lại.');
    const raced = await existing(session);
    if (raced.length === 3) return response(raced);
    for (const result of rendered) {
      if (raced.some((photo) => photo.latteStyle === result.style)) continue;
      await CupPhotoModel.create(
        [
          {
            owner: actor.owner,
            requestId: `latte-art:v1:${id}:${result.style}`,
            sourceHash: crypto
              .createHash('sha256')
              .update(source.data)
              .update(`latte-art:v1:${result.style}`)
              .digest('hex'),
            sourcePhotoId: id,
            kind: 'LATTE_ART',
            latteStyle: result.style,
            data: result.data,
            width: result.width,
            height: result.height,
            expiresAt: new Date(Date.now() + DAY),
          },
        ],
        { session },
      );
    }
    await auditRepository.log(
      {
        actorType: actor.userId ? 'USER' : 'GUEST',
        actorId: actor.userId,
        action: 'latteArt.generated',
        entityType: 'CupPhoto',
        entityId: id,
        metadata: { count: 3, recipeVersion: 1 },
      },
      session,
    );
    return response(await existing(session));
  });
}
