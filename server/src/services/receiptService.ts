import { ForbiddenError, NotFoundError } from '../errors/AppError.js';
import { OrderModel } from '../models/Order.js';
import { ReviewModel } from '../models/Review.js';
import { billRepository } from '../repositories/billRepository.js';
import { tableRepository } from '../repositories/tableRepository.js';
import { tableSessionRepository } from '../repositories/tableSessionRepository.js';

export async function buildParticipantReceipt(tableSessionId: string, participantId: string) {
  const tableSession = await tableSessionRepository.findById(tableSessionId);
  if (!tableSession) throw new NotFoundError('Phiên bàn không tồn tại.');
  if (tableSession.status !== 'CLOSED')
    throw new ForbiddenError('Hóa đơn chỉ khả dụng sau khi phiên đã đóng.');

  const [bill, reviews] = await Promise.all([
    billRepository.findBySession(tableSessionId),
    ReviewModel.find({ tableSessionId, participantId }).lean(),
  ]);
  const reviewByOrder = new Map(
    reviews.map((review) => [
      review.orderId.toString(),
      {
        rating: review.rating,
        comment: review.comment,
        createdAt: review.createdAt.toISOString(),
      },
    ]),
  );

  if (bill) {
    const orders = bill.orders
      .filter((order) => order.participantId === participantId)
      .map((order) => serializeOrder(order.orderId.toString(), order, reviewByOrder));
    return {
      source: 'BILL_SNAPSHOT' as const,
      tableName: bill.tableName || bill.tableCode,
      closedAt: bill.closedAt.toISOString(),
      total: orders.reduce((sum, order) => sum + order.total, 0),
      orders,
    };
  }

  const [table, orders] = await Promise.all([
    tableRepository.findById(tableSession.tableId.toString()),
    OrderModel.find({ tableSessionId, participantId, paymentStatus: 'PAID', status: 'SERVED' })
      .sort({ createdAt: 1 })
      .lean(),
  ]);
  const serialized = orders.map((order) =>
    serializeOrder(order._id.toString(), order, reviewByOrder),
  );
  return {
    source: 'LEGACY_ORDER_FALLBACK' as const,
    tableName: table?.name ?? 'Bàn',
    closedAt: tableSession.closedAt?.toISOString() ?? null,
    total: serialized.reduce((sum, order) => sum + order.total, 0),
    orders: serialized,
  };
}

function serializeOrder(
  id: string,
  order: {
    code: string;
    total: number;
    subtotal?: number | null;
    voucherCode?: string;
    voucherDiscount?: number;
    pointsDiscount?: number;
    redeemedPoints?: number;
    earnedPoints?: number;
    status: string;
    paymentStatus: string;
    items: unknown;
    participantId?: string | null;
    createdAt: Date;
  },
  reviews: Map<string, { rating: number; comment?: string | null; createdAt: string }>,
) {
  return {
    _id: id,
    code: order.code,
    total: order.total,
    subtotal: order.subtotal ?? order.total,
    voucherCode: order.voucherCode ?? '',
    voucherDiscount: order.voucherDiscount ?? 0,
    pointsDiscount: order.pointsDiscount ?? 0,
    redeemedPoints: order.redeemedPoints ?? 0,
    earnedPoints: order.earnedPoints ?? 0,
    status: order.status,
    paymentStatus: order.paymentStatus,
    items: serializeItems(order.items),
    participantId: order.participantId ?? null,
    createdAt: order.createdAt.toISOString(),
    review: reviews.get(id) ?? null,
  };
}

function serializeItems(items: unknown) {
  if (!Array.isArray(items)) return [];
  return items.map((value) => {
    const item = value as Record<string, unknown>;
    return {
      nameSnapshot: String(item.nameSnapshot ?? ''),
      variantNameSnapshot: String(item.variantNameSnapshot ?? ''),
      sizeName: typeof item.sizeName === 'string' ? item.sizeName : null,
      sugarLevel: String(item.sugarLevel ?? ''),
      iceLevel: String(item.iceLevel ?? ''),
      toppingNamesSnapshot: Array.isArray(item.toppingNamesSnapshot)
        ? item.toppingNamesSnapshot.map(String)
        : [],
      note: String(item.note ?? ''),
      quantity: Number(item.quantity ?? 0),
      unitPrice: Number(item.unitPrice ?? 0),
      lineTotal: Number(item.lineTotal ?? 0),
    };
  });
}
