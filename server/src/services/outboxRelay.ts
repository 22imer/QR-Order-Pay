import { config } from '../config/index.js';
import {
  enqueueRealtimeJob,
  type RealtimeEnvelope,
  type RealtimeEvent,
  type RealtimeTarget,
} from '../infrastructure/backgroundQueue.js';
import { logger } from '../infrastructure/logger.js';
import { outboxRepository } from '../repositories/outboxRepository.js';
import {
  closeSessionSockets,
  getIO,
  publishGuest,
  publishAll,
  publishSession,
  publishStaff,
} from '../realtime/socket.js';

export interface OutboxRelay {
  stop: () => Promise<void>;
  drainOnce: () => Promise<number>;
}

export function startOutboxRelay(): OutboxRelay {
  const owner = `${config.instanceId}:${process.pid}`;
  let stopped = false;
  let running: Promise<number> | null = null;

  const drainOnce = async (): Promise<number> => {
    if (stopped) return 0;
    if (running) return running;
    running = drainBatch(owner)
      .catch((error) => {
        logger.error({ err: error }, 'outbox relay drain failed');
        return 0;
      })
      .finally(() => {
        running = null;
      });
    return running;
  };

  const timer = setInterval(() => void drainOnce(), config.outbox.pollIntervalMs);
  timer.unref();
  void drainOnce();

  return {
    drainOnce,
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      if (running) await running;
    },
  };
}

async function drainBatch(owner: string): Promise<number> {
  let processed = 0;
  for (let index = 0; index < config.outbox.batchSize; index += 1) {
    const event = await outboxRepository.claimNext(owner, config.outbox.leaseMs);
    if (!event) break;
    try {
      const queued = await enqueueRealtimeJob(
        event.target as RealtimeTarget,
        event.eventType as RealtimeEvent,
        event.payload,
        {
          id: event.eventId,
          createdAt: event.createdAt.toISOString(),
          schemaVersion: event.schemaVersion,
          entityId: event.aggregateId,
          entityVersion: event.aggregateVersion ?? 0,
        },
      );
      if (!queued) {
        if (!getIO()) throw new Error('REALTIME_QUEUE_UNAVAILABLE');
        publishDirect(event.target as RealtimeTarget, {
          eventId: event.eventId,
          eventType: event.eventType as RealtimeEvent,
          schemaVersion: event.schemaVersion,
          entityId: event.aggregateId,
          entityVersion: event.aggregateVersion ?? 0,
          occurredAt: event.createdAt.toISOString(),
          data: event.payload,
        });
      }
      const marked = await outboxRepository.markPublished(event.id, owner);
      if (!marked) throw new Error('OUTBOX_LEASE_LOST');
      processed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'UNKNOWN_OUTBOX_ERROR';
      const retryDelayMs = Math.min(
        config.outbox.retryMaxMs,
        config.outbox.retryBaseMs * 2 ** Math.max(0, event.attempts - 1),
      );
      const status = await outboxRepository.retryOrFail(
        event.id,
        owner,
        event.attempts,
        config.outbox.maxAttempts,
        message,
        retryDelayMs,
      );
      logger.error(
        { err: error, eventId: event.eventId, eventType: event.eventType, outboxStatus: status },
        'outbox event delivery failed',
      );
    }
  }
  return processed;
}

function publishDirect(target: RealtimeTarget, envelope: RealtimeEnvelope): void {
  const event = envelope.eventType;
  if (target.scope === 'all') publishAll(event, envelope);
  else if (target.scope === 'staff') publishStaff(event, envelope);
  else if (target.scope === 'session') publishSession(target.tableSessionId, event, envelope);
  else publishGuest(target.tableSessionId, target.participantId, event, envelope);
  if (target.scope === 'session' && closesSession(event, envelope.data))
    closeSessionSockets(target.tableSessionId);
}

function closesSession(event: RealtimeEvent, data: unknown): boolean {
  if (event === 'payment.confirmed') return true;
  if (event !== 'tableSession.statusChanged' || !data || typeof data !== 'object') return false;
  return 'status' in data && data.status === 'CLOSED';
}
