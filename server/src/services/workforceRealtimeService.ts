import type { ClientSession } from 'mongoose';
import { outboxRepository } from '../repositories/outboxRepository.js';

/** Invalidation only; every client reloads its own authorised workforce snapshot. */
export async function queueWorkforceChanged(session: ClientSession): Promise<void> {
  await outboxRepository.createRealtimeEvents(
    [
      {
        eventType: 'workforce.changed',
        aggregateType: 'Workforce',
        aggregateId: 'workforce',
        target: { scope: 'staff' },
        payload: { refresh: true },
      },
    ],
    session,
  );
}
