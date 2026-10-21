import type { ClientSession } from 'mongoose';
import { OrderModel, type OrderDoc } from '../models/Order.js';
import type { OrderStatus, PaymentStatus } from '@may-cafe/contracts';
import { settleOrderInventory } from '../services/orderInventoryService.js';
import { settleOrderBenefits } from '../services/promotionService.js';

export const UNFINISHED_ORDER_STATUSES: OrderStatus[] = [
  'PENDING',
  'CONFIRMED',
  'PREPARING',
  'READY',
];

export interface StaffOrderFeedFilters {
  tableSessionIds: string[];
  status?: OrderStatus;
}

export interface OrderListFilters {
  tableSessionId?: string;
  participantId?: string;
  status?: OrderStatus | { $in: OrderStatus[] };
  paymentStatus?: PaymentStatus;
  from?: Date;
  to?: Date;
  page?: number;
  limit?: number;
}

export interface PaidOrderAnalytics {
  totalRevenue: number;
  orderCount: number;
  averageOrderValue: number;
  topProducts: Array<{ productId: string; name: string; quantity: number; revenue: number }>;
  revenueByDay: Array<{ date: string; revenue: number; orders: number }>;
  revenueByHour: Array<{ hour: number; revenue: number }>;
}

export const orderRepository = {
  async createWithSession(
    data: Record<string, unknown>,
    session: ClientSession,
  ): Promise<OrderDoc> {
    const [doc] = await OrderModel.create([data], { session });
    if (!doc) throw new Error('Failed to create order');
    return doc;
  },
  async findById(id: string, session?: ClientSession | null): Promise<OrderDoc | null> {
    return OrderModel.findById(id, null, { session: session ?? undefined });
  },
  async findByCode(code: string): Promise<OrderDoc | null> {
    return OrderModel.findOne({ code });
  },
  async findByIdempotency(
    tableSessionId: string,
    idempotencyKey: string,
  ): Promise<OrderDoc | null> {
    return OrderModel.findOne({ tableSessionId, idempotencyKey });
  },
  async list(filters: OrderListFilters = {}): Promise<{ items: OrderDoc[]; total: number }> {
    const query: Record<string, unknown> = {};
    if (filters.tableSessionId) query.tableSessionId = filters.tableSessionId;
    if (filters.participantId) query.participantId = filters.participantId;
    if (filters.status) query.status = filters.status;
    if (filters.paymentStatus) query.paymentStatus = filters.paymentStatus;
    if (filters.from || filters.to) {
      const range: Record<string, Date> = {};
      if (filters.from) range.$gte = filters.from;
      if (filters.to) range.$lt = filters.to;
      query.createdAt = range;
    }
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const limit = filters.limit && filters.limit > 0 ? Math.min(filters.limit, 100) : 20;
    const [items, total] = await Promise.all([
      OrderModel.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      OrderModel.countDocuments(query),
    ]);
    return { items, total };
  },
  /** Feed KDS: chỉ đơn của các phiên đang hoạt động, nên không phình theo lịch sử. */
  async listForStaff(filters: StaffOrderFeedFilters): Promise<OrderDoc[]> {
    return OrderModel.find({
      $or: [
        { tableSessionId: { $in: filters.tableSessionIds } },
        { fulfillmentType: { $in: ['TAKEAWAY', 'PICKUP'] }, 'pickup.outcome': 'ACTIVE',
          $or: [{ 'pickup.scheduledAt': null }, { 'pickup.scheduledAt': { $lte: new Date(Date.now() + 15 * 60000) } }] },
      ],
      paymentStatus: 'PAID',
      status: filters.status ?? { $in: UNFINISHED_ORDER_STATUSES },
    }).sort({ createdAt: 1 });
  },
  async transitionStatus(
    id: string,
    expectedVersion: number,
    nextStatus: OrderStatus,
    entry: {
      from: OrderStatus;
      by?: string | null;
      byParticipantId?: string | null;
      reason?: string;
    },
    session?: ClientSession | null,
  ): Promise<OrderDoc | null> {
    const push = {
      from: entry.from,
      to: nextStatus,
      at: new Date(),
      by: entry.by ?? null,
      byParticipantId: entry.byParticipantId ?? null,
      reason: entry.reason ?? '',
    };
    const updated = await OrderModel.findOneAndUpdate(
      { _id: id, status: entry.from, version: expectedVersion },
      {
        $set: {
          status: nextStatus,
          ...(nextStatus === 'CANCELLED' ? { cancelReason: entry.reason ?? '' } : {}),
        },
        $push: { statusHistory: push },
        $inc: { version: 1 },
      },
      { new: true, session: session ?? undefined },
    );
    if (updated && session)
      await settleOrderInventory(updated, nextStatus, entry.by ?? null, session);
    if (updated && session) await settleOrderBenefits(updated, nextStatus, session);
    return updated;
  },
  async setPaymentStatus(
    orderIds: string[],
    paymentStatus: PaymentStatus,
    session?: ClientSession | null,
  ): Promise<number> {
    const r = await OrderModel.updateMany(
      { _id: { $in: orderIds } },
      { $set: { paymentStatus } },
      { session: session ?? undefined },
    );
    return r.modifiedCount ?? 0;
  },
  async sumPaidTotal(from: Date, to: Date): Promise<number> {
    const agg = await OrderModel.aggregate([
      {
        $match: {
          createdAt: { $gte: from, $lt: to },
          paymentStatus: 'PAID',
          status: { $ne: 'CANCELLED' },
        },
      },
      { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } },
    ]);
    return agg[0]?.total ?? 0;
  },
  async paidAnalytics(from: Date, to: Date): Promise<PaidOrderAnalytics> {
    const [result] = await OrderModel.aggregate<{
      summary: Array<{ totalRevenue: number; orderCount: number; averageOrderValue: number }>;
      topProducts: PaidOrderAnalytics['topProducts'];
      revenueByDay: PaidOrderAnalytics['revenueByDay'];
      revenueByHour: PaidOrderAnalytics['revenueByHour'];
    }>([
      {
        $match: {
          createdAt: { $gte: from, $lt: to },
          paymentStatus: 'PAID',
          status: { $ne: 'CANCELLED' },
        },
      },
      {
        $facet: {
          summary: [
            {
              $group: {
                _id: null,
                totalRevenue: { $sum: '$total' },
                orderCount: { $sum: 1 },
                averageOrderValue: { $avg: '$total' },
              },
            },
            {
              $project: {
                _id: 0,
                totalRevenue: 1,
                orderCount: 1,
                averageOrderValue: { $round: ['$averageOrderValue', 0] },
              },
            },
          ],
          topProducts: [
            { $unwind: '$items' },
            {
              $group: {
                _id: '$items.productId',
                name: { $last: '$items.nameSnapshot' },
                quantity: { $sum: '$items.quantity' },
                revenue: { $sum: '$items.lineTotal' },
              },
            },
            { $sort: { quantity: -1, revenue: -1 } },
            { $limit: 5 },
            {
              $project: {
                _id: 0,
                productId: { $toString: '$_id' },
                name: 1,
                quantity: 1,
                revenue: 1,
              },
            },
          ],
          revenueByDay: [
            {
              $group: {
                _id: {
                  $dateToString: {
                    date: '$createdAt',
                    format: '%Y-%m-%d',
                    timezone: 'Asia/Ho_Chi_Minh',
                  },
                },
                revenue: { $sum: '$total' },
                orders: { $sum: 1 },
              },
            },
            { $sort: { _id: 1 } },
            { $project: { _id: 0, date: '$_id', revenue: 1, orders: 1 } },
          ],
          revenueByHour: [
            {
              $group: {
                _id: {
                  $toInt: {
                    $dateToString: {
                      date: '$createdAt',
                      format: '%H',
                      timezone: 'Asia/Ho_Chi_Minh',
                    },
                  },
                },
                revenue: { $sum: '$total' },
              },
            },
            { $sort: { _id: 1 } },
            { $project: { _id: 0, hour: '$_id', revenue: 1 } },
          ],
        },
      },
    ]);
    const summary = result?.summary[0];
    return {
      totalRevenue: summary?.totalRevenue ?? 0,
      orderCount: summary?.orderCount ?? 0,
      averageOrderValue: summary?.averageOrderValue ?? 0,
      topProducts: result?.topProducts ?? [],
      revenueByDay: result?.revenueByDay ?? [],
      revenueByHour: result?.revenueByHour ?? [],
    };
  },
};
