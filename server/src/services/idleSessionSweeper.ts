import { config } from '../config/index.js';
import { logger } from '../infrastructure/logger.js';
import { auditRepository } from '../repositories/auditRepository.js';
import { guestSessionRepository } from '../repositories/guestSessionRepository.js';
import { tableSessionRepository } from '../repositories/tableSessionRepository.js';
import { OrderModel } from '../models/Order.js';
import { unitOfWork } from '../infrastructure/unitOfWork.js';
import { outboxRepository } from '../repositories/outboxRepository.js';
import { tableRepository } from '../repositories/tableRepository.js';

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Đóng các phiên khách tự mở đã quá hạn mà không có đơn nào còn hiệu lực.
 * Trả về số phiên đã đóng trong lượt này.
 */
export async function sweepIdleSessions(now: Date = new Date()): Promise<number> {
  const timeoutMin = config.sessionIdleTimeoutMin;
  if (timeoutMin <= 0) return 0;

  const cutoff = new Date(now.getTime() - timeoutMin * 60_000);
  const candidates = await tableSessionRepository.listIdleCandidates(cutoff);
  let closedCount = 0;

  for (const candidate of candidates) {
    const id = candidate._id.toString();
    try {
      const didClose = await unitOfWork.withTransaction(async (mongoSession) => {
        const hasOrder = await OrderModel.exists({
          tableSessionId: candidate._id,
          status: { $ne: 'CANCELLED' },
        }).session(mongoSession);
        if (hasOrder) return false;

        const closed = await tableSessionRepository.updateStatus(
          id,
          candidate.version,
          {
            status: 'CLOSED',
            closedBy: null,
            closedReason: 'IDLE',
          },
          mongoSession,
        );
        if (!closed) return false;

        await guestSessionRepository.revokeByTableSession(id, mongoSession);
        await tableRepository.invalidateQr(candidate.tableId.toString(), mongoSession);
        await auditRepository.log(
          {
            actorType: 'SYSTEM',
            actorId: null,
            action: 'tableSession.idleClosed',
            entityType: 'TableSession',
            entityId: id,
            metadata: { tableId: candidate.tableId.toString() },
          },
          mongoSession,
        );
        const event = {
          eventType: 'tableSession.statusChanged' as const,
          aggregateType: 'TableSession',
          aggregateId: id,
          aggregateVersion: closed.version,
          payload: { tableSessionId: id, status: 'CLOSED', version: closed.version },
        };
        await outboxRepository.createRealtimeEvents(
          [
            { ...event, target: { scope: 'staff' } },
            { ...event, target: { scope: 'session', tableSessionId: id } },
          ],
          mongoSession,
        );
        return true;
      });
      if (didClose) closedCount += 1;
    } catch (e) {
      logger.error({ err: e, tableSessionId: id }, 'failed to close idle table session');
    }
  }

  return closedCount;
}

/** Bật sweeper định kỳ (5 phút). Trả về hàm dừng; no-op khi tắt idle timeout. */
export function startIdleSessionSweeper(): () => void {
  if (config.sessionIdleTimeoutMin <= 0) return () => {};

  const timer = setInterval(() => {
    void sweepIdleSessions().catch((e) =>
      logger.error({ err: e }, 'idle table session sweep failed'),
    );
  }, SWEEP_INTERVAL_MS);
  timer.unref();

  return () => clearInterval(timer);
}
