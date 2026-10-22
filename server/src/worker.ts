import { connectMongo, disconnectMongo } from './infrastructure/mongo.js';
import { connectRedis, disconnectRedis } from './infrastructure/redis.js';
import { logger } from './infrastructure/logger.js';
import { startIdleSessionSweeper } from './services/idleSessionSweeper.js';
import { startAnomalyScheduler } from './services/anomalyService.js';
import { startReservationSweeper } from './services/reservationService.js';
import { startGiftSweeper } from './services/giftService.js';
import {
  startRealtimeJobWorker,
  startReportJobWorker,
  type QueueWorker,
} from './services/backgroundJobWorker.js';
import { startOutboxRelay } from './services/outboxRelay.js';
import { config } from './config/index.js';
import {
  acquireSchedulerLeadership,
  releaseSchedulerLeadership,
  renewSchedulerLeadership,
  writeWorkerHeartbeat,
} from './infrastructure/backgroundQueue.js';

type WorkerRole = 'all' | 'scheduler' | 'realtime' | 'report';

async function main(): Promise<void> {
  await connectMongo();
  await connectRedis();
  const role = parseRole(process.env['WORKER_ROLE']);
  const schedulerEnabled = role === 'all' || role === 'scheduler';
  const schedulerOwner = `${config.instanceId}:${process.pid}`;
  if (schedulerEnabled && !(await acquireSchedulerLeadership(schedulerOwner)))
    throw new Error('SCHEDULER_LEASE_UNAVAILABLE');
  const stopIdle = schedulerEnabled ? startIdleSessionSweeper() : null;
  const stopAnomaly = schedulerEnabled ? startAnomalyScheduler() : null;
  const stopReservations = schedulerEnabled ? startReservationSweeper() : null;
  const stopGifts = schedulerEnabled ? startGiftSweeper() : null;
  const outboxRelay = schedulerEnabled ? startOutboxRelay() : null;
  const queueWorkers: QueueWorker[] = [];
  if (role === 'all' || role === 'realtime') queueWorkers.push(startRealtimeJobWorker());
  if (role === 'all' || role === 'report') queueWorkers.push(startReportJobWorker());

  const heartbeat = () => {
    const consumerHealth = queueWorkers[0]?.health();
    return writeWorkerHeartbeat(
      config.instanceId,
      role,
      consumerHealth
        ? {
            lastProgressAt: consumerHealth.lastProgressAt,
            activeJobId: consumerHealth.activeJobId,
            activeJobStartedAt: consumerHealth.activeJobStartedAt,
          }
        : {},
    )
      .then(async () => {
        if (schedulerEnabled && !(await renewSchedulerLeadership(schedulerOwner)))
          throw new Error('SCHEDULER_LEASE_LOST');
      })
      .catch((error) => {
        logger.error({ err: error, role }, 'worker heartbeat failed');
        if ((error as Error).message === 'SCHEDULER_LEASE_LOST')
          process.kill(process.pid, 'SIGTERM');
      });
  };
  await heartbeat();
  const heartbeatTimer = setInterval(
    () => void heartbeat(),
    config.backgroundJobs.heartbeatIntervalMs,
  );
  heartbeatTimer.unref();
  logger.info({ role }, 'background worker started');
  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'background worker shutting down');
    clearInterval(heartbeatTimer);
    stopIdle?.();
    stopAnomaly?.();
    stopReservations?.();
    stopGifts?.();
    const drains = queueWorkers.map((worker) => worker.stop());
    if (outboxRelay) drains.push(outboxRelay.stop());
    const drained = await waitForDrain(drains, config.shutdownTimeoutMs);
    if (!drained)
      logger.warn(
        { timeoutMs: config.shutdownTimeoutMs, role },
        'worker drain deadline reached; leased jobs will be reclaimed after expiry',
      );
    if (schedulerEnabled) await releaseSchedulerLeadership(schedulerOwner);
    await disconnectRedis();
    await disconnectMongo();
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

async function waitForDrain(tasks: Promise<void>[], timeoutMs: number): Promise<boolean> {
  if (tasks.length === 0) return true;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
    timer.unref();
  });
  try {
    return await Promise.race([Promise.all(tasks).then(() => true), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function parseRole(value: string | undefined): WorkerRole {
  if (!value || value === 'all') return 'all';
  if (value === 'scheduler' || value === 'realtime' || value === 'report') return value;
  throw new Error(`Invalid WORKER_ROLE=${value}`);
}

void main().catch((error) => {
  logger.error({ err: error }, 'background worker failed to start');
  process.exit(1);
});
