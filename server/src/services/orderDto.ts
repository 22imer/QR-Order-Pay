import {
  guestOrderSchema,
  staffOrderSchema,
  type GuestOrder,
  type StaffOrder,
} from '@may-cafe/contracts';
import type { OrderDoc } from '../models/Order.js';

type OrderSource = Pick<
  OrderDoc,
  | '_id'
  | 'code'
  | 'tableSessionId'
  | 'participantId'
  | 'tableId'
  | 'items'
  | 'total'
  | 'paidAmount'
  | 'status'
  | 'paymentStatus'
  | 'cancelReason'
  | 'statusHistory'
  | 'version'
  | 'createdAt'
  | 'updatedAt'
> &
  Partial<
    Pick<
      OrderDoc,
      | 'fulfillmentType'
      | 'pickup'
      | 'subtotal'
      | 'voucherCode'
      | 'voucherDiscount'
      | 'pointsDiscount'
      | 'redeemedPoints'
      | 'earnedPoints'
    >
  >;

const iso = (value: Date | string | null | undefined): string =>
  value instanceof Date ? value.toISOString() : String(value ?? '');
const idOrNull = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

function baseOrder(order: OrderSource) {
  return {
    _id: order._id.toString(),
    code: order.code,
    tableSessionId: order.tableSessionId?.toString() ?? null,
    fulfillmentType: order.fulfillmentType ?? 'DINE_IN',
    scheduledAt: order.pickup?.scheduledAt?.toISOString() ?? null,
    participantId: order.participantId,
    items: order.items.map((item) => ({
      productId: item.productId.toString(),
      variantId: idOrNull(item.variantId),
      sizeName: item.sizeName ?? null,
      sugarLevel: item.sugarLevel,
      iceLevel: item.iceLevel,
      toppingIds: item.toppingIds.map((id) => id.toString()),
      toppingNamesSnapshot: [...item.toppingNamesSnapshot],
      note: item.note ?? '',
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
      nameSnapshot: item.nameSnapshot,
      variantNameSnapshot: item.variantNameSnapshot ?? '',
    })),
    total: order.total,
    subtotal: order.subtotal ?? order.total,
    voucherCode: order.voucherCode ?? '',
    voucherDiscount: order.voucherDiscount ?? 0,
    pointsDiscount: order.pointsDiscount ?? 0,
    redeemedPoints: order.redeemedPoints ?? 0,
    earnedPoints: order.earnedPoints ?? 0,
    paidAmount: order.paidAmount ?? (order.paymentStatus === 'PAID' ? order.total : 0),
    balanceDue:
      order.paymentStatus === 'REFUNDED'
        ? 0
        : Math.max(
            0,
            order.total - (order.paidAmount ?? (order.paymentStatus === 'PAID' ? order.total : 0)),
          ),
    status: order.status,
    paymentStatus: order.paymentStatus ?? 'UNPAID',
    cancelReason: order.cancelReason ?? '',
    createdAt: iso(order.createdAt),
    updatedAt: iso(order.updatedAt),
  };
}

/** Đơn trả cho khách: không có khóa idempotency, hash request hay ID nhân viên đã thao tác. */
export function toGuestOrder(
  order: OrderSource,
  review?: { rating: number; comment?: string | null; createdAt: Date | string } | null,
): GuestOrder {
  return guestOrderSchema.parse({
    ...baseOrder(order),
    review: review
      ? { rating: review.rating, comment: review.comment ?? '', createdAt: iso(review.createdAt) }
      : null,
    statusHistory: order.statusHistory.map((entry) => ({
      from: entry.from ?? null,
      to: entry.to,
      at: iso(entry.at),
      reason: entry.reason ?? '',
    })),
  });
}

export function toStaffOrder(
  order: OrderSource,
  table?: { name: string; code: string } | null,
): StaffOrder {
  return staffOrderSchema.parse({
    ...baseOrder(order),
    tableId: order.tableId?.toString() ?? null,
    version: order.version ?? 0,
    ...(table ? { tableName: table.name, tableCode: table.code } : {}),
    statusHistory: order.statusHistory.map((entry) => ({
      from: entry.from ?? null,
      to: entry.to,
      at: iso(entry.at),
      by: idOrNull(entry.by),
      byParticipantId: entry.byParticipantId ?? null,
      reason: entry.reason ?? '',
    })),
  });
}
