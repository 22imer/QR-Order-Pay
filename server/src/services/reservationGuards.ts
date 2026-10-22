import type { ClientSession } from 'mongoose';
import { RESERVATION_MINUTES } from '@may-cafe/contracts';
import { ReservationModel, type ReservationDoc } from '../models/Reservation.js';
import { TableModel } from '../models/Table.js';
import { ConflictError, NotFoundError } from '../errors/AppError.js';
import { outboxRepository } from '../repositories/outboxRepository.js';
import { auditRepository } from '../repositories/auditRepository.js';

// Booking, QR admission, staff opening, transfer and table edits all write the
// same Table document inside their transaction, preventing snapshot write skew.
export async function lockReservationTable(id: string, session: ClientSession) {
  const table = await TableModel.findOneAndUpdate(
    { _id: id, isActive: true },
    { $inc: { admissionCount: 1 } },
    { new: true, session },
  );
  if (!table) throw new NotFoundError('Bàn không khả dụng.');
  return table;
}
export function liveReservationFilter(now = new Date()) {
  return {
    $or: [{ status: 'CONFIRMED', arrivalDeadline: { $gt: now } }, { status: 'CHECKED_IN' }],
  };
}
export async function assertWalkInAllowed(tableId: string, session: ClientSession) {
  const now = new Date();
  const held = await ReservationModel.exists({
    tableId,
    ...liveReservationFilter(now),
    startsAt: { $lt: new Date(now.getTime() + RESERVATION_MINUTES * 60000) },
    endsAt: { $gt: now },
  }).session(session);
  if (held)
    throw new ConflictError(
      'TABLE_RESERVED',
      'Bàn có lịch đặt trong 60 phút tới. Vui lòng chọn bàn khác hoặc check-in lịch đặt.',
    );
}
export async function reservationChanged(r: ReservationDoc, session: ClientSession) {
  await outboxRepository.createRealtimeEvents(
    [
      {
        eventType: 'reservation.changed',
        aggregateType: 'Reservation',
        aggregateId: r.id,
        aggregateVersion: r.version,
        target: { scope: 'staff' },
        // Contact details are available only from authenticated list endpoints.
        payload: { id: r.id, status: r.status, version: r.version },
      },
    ],
    session,
  );
}
export async function completeSessionReservation(tableSessionId: string, session: ClientSession) {
  const r = await ReservationModel.findOneAndUpdate(
    { tableSessionId, status: 'CHECKED_IN' },
    { $set: { status: 'COMPLETED', closedAt: new Date() }, $inc: { version: 1 } },
    { new: true, session },
  );
  if (!r) return;
  await auditRepository.log(
    {
      actorType: 'SYSTEM',
      action: 'reservation.completed',
      entityType: 'Reservation',
      entityId: r.id,
      metadata: { tableSessionId },
    },
    session,
  );
  await reservationChanged(r, session);
}
export async function moveSessionReservation(
  tableSessionId: string,
  tableId: string,
  session: ClientSession,
) {
  const r = await ReservationModel.findOne({ tableSessionId, status: 'CHECKED_IN' }).session(
    session,
  );
  if (!r) return;
  const table = await TableModel.findById(tableId).session(session);
  if (!table || table.capacity < r.partySize)
    throw new ConflictError('TABLE_TOO_SMALL', 'Bàn đích không đủ chỗ cho lịch đặt.');
  const overlap = await ReservationModel.exists({
    _id: { $ne: r._id },
    tableId,
    ...liveReservationFilter(),
    startsAt: { $lt: r.endsAt },
    endsAt: { $gt: r.startsAt },
  }).session(session);
  if (overlap) throw new ConflictError('TABLE_RESERVED', 'Bàn đích trùng lịch đặt.');
  r.tableId = table._id;
  r.tableName = table.name;
  r.version += 1;
  await r.save({ session });
  await reservationChanged(r, session);
}
