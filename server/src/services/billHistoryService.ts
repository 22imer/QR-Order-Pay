import mongoose from 'mongoose';
import { NotFoundError, ValidationError } from '../errors/AppError.js';
import { BillModel } from '../models/Bill.js';

export interface BillHistoryFilters {
  q?: string;
  table?: string;
  cashier?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}
interface RawPayment {
  method: string;
  amount: number;
  paidAt: Date;
}
interface RawItem extends Record<string, unknown> {
  productId: unknown;
  variantId?: unknown;
  toppingIds: unknown[];
}
interface RawOrder {
  subtotal?: number | null;
  voucherCode?: string;
  voucherDiscount?: number;
  pointsDiscount?: number;
  redeemedPoints?: number;
  earnedPoints?: number;
  orderId: unknown;
  code: string;
  status: string;
  paymentStatus: string;
  total: number;
  createdAt: Date;
  participantId?: string | null;
  items: RawItem[];
}
interface RawBill extends Record<string, unknown> {
  _id: unknown;
  invoiceCode?: string;
  tableSessionId: unknown;
  tableCode: string;
  tableName?: string;
  cashierName?: string;
  closedAt: Date;
  openedAt: Date;
  total: number;
  subtotal: number;
  paidAmount: number;
  source: string;
  payments?: RawPayment[];
  orders?: RawOrder[];
}

export async function listBillHistory(filters: BillHistoryFilters) {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.max(1, Math.min(100, filters.limit ?? 20));
  const query: Record<string, unknown> = {};
  if (filters.q) query.invoiceCode = new RegExp(escapeRegex(filters.q), 'i');
  if (filters.table)
    query.$or = [
      { tableCode: new RegExp(escapeRegex(filters.table), 'i') },
      { tableName: new RegExp(escapeRegex(filters.table), 'i') },
    ];
  if (filters.cashier) query.cashierName = new RegExp(escapeRegex(filters.cashier), 'i');
  const range: { $gte?: Date; $lt?: Date } = {};
  if (filters.from) range.$gte = localBoundary(filters.from);
  if (filters.to) range.$lt = new Date(localBoundary(filters.to).getTime() + 86_400_000);
  if (range.$gte || range.$lt) query.closedAt = range;
  const [items, total] = await Promise.all([
    BillModel.find(query)
      .sort({ closedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('-paymentIds')
      .lean(),
    BillModel.countDocuments(query),
  ]);
  return {
    items: items.map((item) => serializeBillSummary(item as unknown as RawBill)),
    page,
    limit,
    total,
  };
}

export async function getBillHistory(id: string) {
  const query = mongoose.isValidObjectId(id) ? { _id: id } : { invoiceCode: id };
  const bill = await BillModel.findOne(query).select('-paymentIds').lean();
  if (!bill) throw new NotFoundError('Không tìm thấy hóa đơn.');
  return serializeBill(bill as unknown as RawBill);
}

function serializeBillSummary(bill: RawBill) {
  return {
    id: String(bill._id),
    invoiceCode: bill.invoiceCode ?? String(bill._id).slice(-8).toUpperCase(),
    tableCode: bill.tableCode,
    tableName: bill.tableName || bill.tableCode,
    cashierName: bill.cashierName || 'Không rõ',
    closedAt: bill.closedAt.toISOString(),
    total: bill.total,
    paidAmount: bill.paidAmount,
    paymentMethods: [
      ...new Set((bill.payments ?? []).map((payment: { method: string }) => payment.method)),
    ],
  };
}

function serializeBill(bill: RawBill) {
  return {
    ...serializeBillSummary(bill),
    tableSessionId: String(bill.tableSessionId),
    source: bill.source,
    openedAt: bill.openedAt.toISOString(),
    subtotal: bill.subtotal,
    payments: (bill.payments ?? []).map((payment) => ({
      method: payment.method,
      amount: payment.amount,
      paidAt: payment.paidAt.toISOString(),
    })),
    orders: (bill.orders ?? []).map((order) => ({
      _id: String(order.orderId),
      code: order.code,
      status: order.status,
      paymentStatus: order.paymentStatus,
      total: order.total,
      subtotal: order.subtotal ?? order.total,
      voucherCode: order.voucherCode ?? '',
      voucherDiscount: order.voucherDiscount ?? 0,
      pointsDiscount: order.pointsDiscount ?? 0,
      redeemedPoints: order.redeemedPoints ?? 0,
      earnedPoints: order.earnedPoints ?? 0,
      createdAt: order.createdAt.toISOString(),
      participantId: order.participantId,
      items: order.items.map((item) => ({
        ...item,
        productId: String(item.productId),
        variantId: item.variantId ? String(item.variantId) : null,
        toppingIds: item.toppingIds.map(String),
      })),
    })),
  };
}

function localBoundary(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new ValidationError('Ngày phải có định dạng YYYY-MM-DD.');
  const result = new Date(`${value}T00:00:00+07:00`);
  if (Number.isNaN(result.getTime())) throw new ValidationError('Ngày không hợp lệ.');
  return result;
}
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
