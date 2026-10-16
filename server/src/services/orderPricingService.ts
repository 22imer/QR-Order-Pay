import crypto from 'node:crypto';
import mongoose, { type ClientSession } from 'mongoose';
import { config } from '../config/index.js';
import { ConflictError, ValidationError } from '../errors/AppError.js';
import { productRepository } from '../repositories/productRepository.js';
import { toppingRepository } from '../repositories/toppingRepository.js';
import { categoryRepository } from '../repositories/categoryRepository.js';
import type { PlaceOrderItemInput } from './orderService.js';
import { guestCanOrder } from './tableSessionService.js';

export interface PricedCart {
  items: Array<{
    productId: mongoose.Types.ObjectId;
    variantId: mongoose.Types.ObjectId | null;
    sizeName: string | null;
    sugarLevel: string;
    iceLevel: string;
    toppingIds: mongoose.Types.ObjectId[];
    toppingNamesSnapshot: string[];
    note: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    nameSnapshot: string;
    variantNameSnapshot: string;
  }>;
  total: number;
  catalogFingerprint: string;
}

export interface OrderQuote {
  quoteId: string;
  quoteToken: string;
  expiresAt: string;
  total: number;
  items: Array<{
    productId: string;
    variantId: string | null;
    name: string;
    variantName: string;
    toppingNames: string[];
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }>;
}

interface QuotePayload {
  quoteId: string;
  tableSessionId: string;
  participantId: string;
  requestFingerprint: string;
  catalogFingerprint: string;
  total: number;
  expiresAt: number;
}

export async function priceOrderItems(
  items: PlaceOrderItemInput[],
  session?: ClientSession | null,
): Promise<PricedCart> {
  const productIds = [...new Set(items.map((item) => item.productId))];
  const toppingIds = [...new Set(items.flatMap((item) => item.toppingIds))];
  const [products, toppings, categories] = await Promise.all([
    productRepository.findManyByIds(productIds, session),
    toppingIds.length > 0
      ? toppingRepository.findManyByIds(toppingIds, session)
      : Promise.resolve([]),
    categoryRepository.listActive(session),
  ]);
  const activeCategories = new Set(categories.map((category) => category.id));
  const productMap = new Map(products.map((product) => [product._id.toString(), product]));
  const toppingMap = new Map(toppings.map((topping) => [topping._id.toString(), topping]));
  const unavailable: Array<{ index: number; productId: string }> = [];
  const invalidOptions: Array<{ index: number; field: string; value?: string }> = [];

  const priced = items.map((item, index) => {
    const product = productMap.get(item.productId);
    if (
      !product ||
      product.isArchived ||
      !product.isAvailable ||
      !activeCategories.has(String(product.categoryId))
    ) {
      unavailable.push({ index, productId: item.productId });
      return null;
    }
    const variant = item.variantId
      ? product.variants.find((value) => value._id?.toString() === item.variantId)
      : null;
    if ((product.variants.length > 0 && !variant) || variant?.isAvailable === false)
      invalidOptions.push({ index, field: 'variant', value: item.variantId ?? undefined });
    if (item.variantId && !product.allowedOptions.sizes?.includes(variant?.name ?? ''))
      invalidOptions.push({ index, field: 'size', value: variant?.name });
    if (!product.allowedOptions.sugarLevels?.includes(item.sugarLevel))
      invalidOptions.push({ index, field: 'sugarLevel', value: item.sugarLevel });
    if (!product.allowedOptions.iceLevels?.includes(item.iceLevel))
      invalidOptions.push({ index, field: 'iceLevel', value: item.iceLevel });
    if (new Set(item.toppingIds).size !== item.toppingIds.length)
      invalidOptions.push({ index, field: 'duplicateTopping' });
    let unitPrice = variant?.price ?? product.basePrice ?? 0;
    const toppingNames: string[] = [];
    for (const toppingId of item.toppingIds) {
      const topping = toppingMap.get(toppingId);
      if (
        !topping ||
        topping.isArchived ||
        !topping.isAvailable ||
        !product.allowedOptions.toppingIds.map(String).includes(toppingId)
      ) {
        invalidOptions.push({ index, field: 'topping', value: toppingId });
        continue;
      }
      unitPrice += topping.price;
      toppingNames.push(topping.name);
    }
    return {
      productId: product._id,
      variantId: variant?._id ?? null,
      sizeName: variant?.name ?? null,
      sugarLevel: item.sugarLevel,
      iceLevel: item.iceLevel,
      toppingIds: item.toppingIds.map((id) => new mongoose.Types.ObjectId(id)),
      toppingNamesSnapshot: toppingNames,
      note: (item.note ?? '').slice(0, 280),
      quantity: item.quantity,
      unitPrice,
      lineTotal: unitPrice * item.quantity,
      nameSnapshot: product.name,
      variantNameSnapshot: variant?.name ?? '',
    };
  });
  if (unavailable.length > 0)
    throw new ConflictError(
      'PRODUCT_UNAVAILABLE',
      'Một món vừa hết hoặc không khả dụng. Vui lòng cập nhật giỏ hàng.',
      { unavailable },
    );
  if (invalidOptions.length > 0)
    throw new ValidationError('Tùy chọn món không hợp lệ.', { invalidOptions });
  const normalized = priced.filter((item): item is NonNullable<typeof item> => item !== null);
  const total = normalized.reduce((sum, item) => sum + item.lineTotal, 0);
  return { items: normalized, total, catalogFingerprint: digest(normalized.map(serializableItem)) };
}

export async function createOrderQuote(input: {
  tableSessionId: string;
  participantId: string;
  items: PlaceOrderItemInput[];
}): Promise<OrderQuote> {
  await guestCanOrder(input.tableSessionId);
  const priced = await priceOrderItems(input.items);
  const expiresAt = Date.now() + config.orderQuoteTtlMs;
  const payload: QuotePayload = {
    quoteId: crypto.randomUUID(),
    tableSessionId: input.tableSessionId,
    participantId: input.participantId,
    requestFingerprint: requestFingerprint(input.items),
    catalogFingerprint: priced.catalogFingerprint,
    total: priced.total,
    expiresAt,
  };
  return {
    quoteId: payload.quoteId,
    quoteToken: sign(payload),
    expiresAt: new Date(expiresAt).toISOString(),
    total: priced.total,
    items: priced.items.map((item) => ({
      productId: item.productId.toString(),
      variantId: item.variantId?.toString() ?? null,
      name: item.nameSnapshot,
      variantName: item.variantNameSnapshot,
      toppingNames: item.toppingNamesSnapshot,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
    })),
  };
}

export function validateQuote(
  input: {
    quoteToken?: string;
    tableSessionId: string;
    participantId: string;
    items: PlaceOrderItemInput[];
  },
  priced: PricedCart,
): void {
  if (!input.quoteToken)
    throw new ConflictError('QUOTE_CHANGED', 'Giỏ hàng cần được báo giá lại trước khi đặt.', {
      reason: 'QUOTE_REQUIRED',
    });
  const payload = verify(input.quoteToken);
  if (!payload || payload.expiresAt < Date.now())
    throw new ConflictError('QUOTE_CHANGED', 'Báo giá đã hết hạn. Vui lòng xác nhận lại.', {
      reason: 'QUOTE_EXPIRED',
    });
  if (
    payload.tableSessionId !== input.tableSessionId ||
    payload.participantId !== input.participantId
  )
    throw new ConflictError('QUOTE_CHANGED', 'Báo giá không thuộc phiên khách hiện tại.', {
      reason: 'QUOTE_OWNERSHIP',
    });
  if (payload.requestFingerprint !== requestFingerprint(input.items))
    throw new ConflictError('QUOTE_CHANGED', 'Giỏ hàng đã thay đổi sau khi báo giá.', {
      reason: 'CART_CHANGED',
    });
  if (payload.catalogFingerprint !== priced.catalogFingerprint || payload.total !== priced.total) {
    throw new ConflictError(
      'QUOTE_CHANGED',
      'Giá hoặc tình trạng món đã thay đổi. Vui lòng xác nhận báo giá mới.',
      {
        reason: 'CATALOG_CHANGED',
        quotedTotal: payload.total,
        currentTotal: priced.total,
      },
    );
  }
}

function requestFingerprint(items: PlaceOrderItemInput[]): string {
  return digest(
    items.map((item) => ({
      ...item,
      toppingIds: [...item.toppingIds].sort(),
      note: item.note ?? '',
    })),
  );
}
function serializableItem(item: PricedCart['items'][number]) {
  return {
    ...item,
    productId: item.productId.toString(),
    variantId: item.variantId?.toString() ?? null,
    toppingIds: item.toppingIds.map(String),
  };
}
function digest(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function sign(payload: QuotePayload): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${crypto.createHmac('sha256', `quote:${config.jwtAccessSecret}`).update(encoded).digest('base64url')}`;
}
function verify(token: string): QuotePayload | null {
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;
  const expected = crypto
    .createHmac('sha256', `quote:${config.jwtAccessSecret}`)
    .update(encoded)
    .digest('base64url');
  if (
    signature.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  )
    return null;
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as QuotePayload;
  } catch {
    return null;
  }
}
