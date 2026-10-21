import { OrderModel } from '../models/Order.js';
import { ServiceRequestModel } from '../models/ServiceRequest.js';
import { TableSessionModel } from '../models/TableSession.js';
import { checkMongoReadiness } from '../infrastructure/mongo.js';
import { getInstanceMetricsSnapshot, setDependencyReadiness } from '../infrastructure/metrics.js';
import { isRedisReady } from '../infrastructure/redis.js';
import { queueSnapshot } from '../infrastructure/backgroundQueue.js';
import { outboxRepository } from '../repositories/outboxRepository.js';

const ACTIVE_ORDER_STATUSES = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY'] as const;

export async function operationsSummary() {
  const [mongoReady, activeSessions, openServiceRequests, groupedOrders, queues, outbox] =
    await Promise.all([
      checkMongoReadiness(),
      TableSessionModel.countDocuments({ status: { $in: ['OPEN', 'CHECKOUT'] } }),
      ServiceRequestModel.countDocuments({ status: 'OPEN' }),
      OrderModel.aggregate<{ _id: string; count: number; oldestCreatedAt: Date }>([
        { $match: { status: { $in: ACTIVE_ORDER_STATUSES }, 'pickup.outcome': { $ne: 'NO_SHOW' },
          $or: [{ 'pickup.scheduledAt': null }, { 'pickup.scheduledAt': { $lte: new Date(Date.now() + 15 * 60000) } }] } },
        { $group: { _id: '$status', count: { $sum: 1 }, oldestCreatedAt: { $min: '$createdAt' } } },
      ]),
      queueSnapshot(),
      outboxRepository.statusCounts(),
    ]);

  setDependencyReadiness('mongodb', mongoReady);
  const redisReady = isRedisReady();
  setDependencyReadiness('redis', redisReady);
  const ordersByStatus: Record<(typeof ACTIVE_ORDER_STATUSES)[number], number> = {
    PENDING: 0,
    CONFIRMED: 0,
    PREPARING: 0,
    READY: 0,
  };
  let oldestQueuedAt: Date | null = null;
  for (const row of groupedOrders) {
    if (row._id in ordersByStatus)
      ordersByStatus[row._id as keyof typeof ordersByStatus] = row.count;
    if (!oldestQueuedAt || row.oldestCreatedAt < oldestQueuedAt)
      oldestQueuedAt = row.oldestCreatedAt;
  }

  return {
    observedAt: new Date().toISOString(),
    instance: getInstanceMetricsSnapshot(),
    database: {
      scope: 'database' as const,
      mongodbReady: mongoReady,
      redisReady,
      activeSessions,
      openServiceRequests,
      activeOrders: Object.values(ordersByStatus).reduce((sum, count) => sum + count, 0),
      ordersByStatus,
      oldestQueuedAt: oldestQueuedAt?.toISOString() ?? null,
      oldestQueueAgeSeconds: oldestQueuedAt
        ? Math.max(0, Math.floor((Date.now() - oldestQueuedAt.getTime()) / 1_000))
        : 0,
      queues,
      outbox: {
        pending: outbox.PENDING ?? 0,
        processing: outbox.PROCESSING ?? 0,
        published: outbox.PUBLISHED ?? 0,
        failed: outbox.FAILED ?? 0,
      },
    },
  };
}
