import { PaymentModel } from '../models/Payment.js';

export async function paymentAnalytics(from: Date, to: Date) {
  const [result] = await PaymentModel.aggregate<{
    summary: Array<{
      grossCollected: number;
      totalRefunded: number;
      adjustmentAmount: number;
      totalRevenue: number;
    }>;
    revenueByDay: Array<{ date: string; revenue: number; orders: number }>;
    revenueByHour: Array<{ hour: number; revenue: number }>;
    count: Array<{ value: number }>;
  }>([
    {
      $project: {
        orderIds: 1,
        events: {
          $concatArrays: [
            [
              {
                at: '$paidAt',
                amount: '$amount',
                kind: {
                  $cond: [{ $ifNull: ['$replacesPaymentId', false] }, 'ADJUSTMENT', 'COLLECTION'],
                },
              },
            ],
            {
              $cond: [
                { $eq: ['$status', 'REFUNDED'] },
                [
                  {
                    at: '$refundedAt',
                    amount: { $multiply: ['$amount', -1] },
                    kind: {
                      $cond: [{ $ifNull: ['$reversalKind', false] }, 'ADJUSTMENT', 'REFUND'],
                    },
                  },
                ],
                [],
              ],
            },
          ],
        },
      },
    },
    { $unwind: '$events' },
    { $match: { 'events.at': { $gte: from, $lt: to } } },
    {
      $facet: {
        summary: [
          {
            $group: {
              _id: null,
              grossCollected: {
                $sum: { $cond: [{ $eq: ['$events.kind', 'COLLECTION'] }, '$events.amount', 0] },
              },
              totalRefunded: {
                $sum: {
                  $cond: [
                    { $eq: ['$events.kind', 'REFUND'] },
                    { $multiply: ['$events.amount', -1] },
                    0,
                  ],
                },
              },
              adjustmentAmount: {
                $sum: { $cond: [{ $eq: ['$events.kind', 'ADJUSTMENT'] }, '$events.amount', 0] },
              },
              totalRevenue: { $sum: '$events.amount' },
            },
          },
        ],
        revenueByDay: [
          {
            $group: {
              _id: {
                $dateToString: {
                  date: '$events.at',
                  format: '%Y-%m-%d',
                  timezone: 'Asia/Ho_Chi_Minh',
                },
              },
              revenue: { $sum: '$events.amount' },
              orders: {
                $addToSet: {
                  $cond: [{ $eq: ['$events.kind', 'COLLECTION'] }, '$orderIds', '$$REMOVE'],
                },
              },
            },
          },
          {
            $project: {
              _id: 0,
              date: '$_id',
              revenue: 1,
              orders: {
                $size: {
                  $reduce: {
                    input: '$orders',
                    initialValue: [],
                    in: { $setUnion: ['$$value', '$$this'] },
                  },
                },
              },
            },
          },
          { $sort: { date: 1 } },
        ],
        revenueByHour: [
          {
            $group: {
              _id: { $hour: { date: '$events.at', timezone: 'Asia/Ho_Chi_Minh' } },
              revenue: { $sum: '$events.amount' },
            },
          },
          { $project: { _id: 0, hour: '$_id', revenue: 1 } },
          { $sort: { hour: 1 } },
        ],
        count: [
          { $match: { 'events.kind': 'COLLECTION' } },
          { $unwind: '$orderIds' },
          { $group: { _id: '$orderIds' } },
          { $count: 'value' },
        ],
      },
    },
  ]);
  const summary = result?.summary[0] ?? {
    grossCollected: 0,
    totalRefunded: 0,
    adjustmentAmount: 0,
    totalRevenue: 0,
  };
  const orderCount = result?.count[0]?.value ?? 0;
  return {
    ...summary,
    orderCount,
    averageOrderValue: orderCount ? Math.round(summary.grossCollected / orderCount) : 0,
    revenueByDay: result?.revenueByDay ?? [],
    revenueByHour: result?.revenueByHour ?? [],
  };
}
