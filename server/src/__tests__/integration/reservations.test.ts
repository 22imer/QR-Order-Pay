import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { buildApp } from '../../app.js';
import { ReservationModel } from '../../models/Reservation.js';
import { TableModel } from '../../models/Table.js';
import { TableSessionModel } from '../../models/TableSession.js';
import { UserModel } from '../../models/User.js';
import { MemberModel } from '../../models/Member.js';
import { OutboxEventModel } from '../../models/OutboxEvent.js';
import { AuditLogModel } from '../../models/AuditLog.js';
import { registerMember } from '../../services/memberService.js';
import { hashPassword, signAccessToken } from '../../utils/crypto.js';
import { createAdmissionTicket } from '../../services/tableQrService.js';
import {
  createReservation,
  reservationAvailability,
  actOnReservation,
  listReservations,
  expireReservations,
  type ReservationActor,
} from '../../services/reservationService.js';
import {
  joinAsGuest,
  openSession,
  transition,
  transferSession,
} from '../../services/tableSessionService.js';
import { tableRepository } from '../../repositories/tableRepository.js';
import { auditRepository } from '../../repositories/auditRepository.js';
import type { ReservationCreate } from '@may-cafe/contracts';

let repl: MongoMemoryReplSet,
  app: ReturnType<typeof buildApp>,
  a: ReservationActor,
  b: ReservationActor,
  staff: ReservationActor,
  tableId: string,
  otherTableId: string,
  cookie: string,
  auth: Record<string, string>;
const at = (minutes = 120) => new Date(Date.now() + minutes * 60000).toISOString();
const input = (extra: Partial<ReservationCreate> = {}): ReservationCreate => ({
  requestId: randomUUID(),
  tableId,
  startsAt: at(),
  partySize: 2,
  name: 'Khách đặt',
  phone: '0901234567',
  note: 'Ghế cho bé',
  ...extra,
});
const create = (extra: Partial<ReservationCreate> = {}, actor = a) =>
  createReservation(actor, input(extra));
async function arriving(id: string) {
  await ReservationModel.updateOne(
    { _id: id },
    {
      $set: {
        startsAt: new Date(Date.now() + 5 * 60000),
        endsAt: new Date(Date.now() + 65 * 60000),
        arrivalDeadline: new Date(Date.now() + 20 * 60000),
      },
    },
  );
}
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(repl.getUri());
  app = buildApp();
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
}, 120000);
beforeEach(async () => {
  vi.restoreAllMocks();
  for (const c of Object.values(mongoose.connection.collections)) await c.deleteMany({});
  const member = await registerMember({
    name: 'Khách đặt',
    phone: '0901234567',
    password: 'Password@123',
  });
  a = { id: member.member.id, staff: false };
  cookie = `mc_member=${member.token}`;
  b = {
    id: (await registerMember({ name: 'Khác', phone: '0901234568', password: 'Password@123' }))
      .member.id,
    staff: false,
  };
  const user = await UserModel.create({
    name: 'Nhân viên',
    email: 'staff@booking.test',
    role: 'STAFF',
    passwordHash: await hashPassword('Password@123'),
  });
  staff = { id: user.id, staff: true };
  auth = {
    Authorization: `Bearer ${signAccessToken({ sub: user.id, role: 'STAFF', name: user.name })}`,
  };
  tableId = (
    await TableModel.create({
      code: 'B01',
      name: 'Bàn 01',
      capacity: 4,
      publicTokenHash: 'booking-table',
    })
  ).id;
  otherTableId = (
    await TableModel.create({
      code: 'B02',
      name: 'Bàn 02',
      capacity: 6,
      publicTokenHash: 'booking-table-2',
    })
  ).id;
});
afterAll(async () => {
  await mongoose.disconnect();
  await repl.stop();
});
describe('60-minute table reservations', () => {
  it('requires member/internal auth, owner scoping, valid IDs and CSRF', async () => {
    expect((await request(app).get('/api/v1/reservations')).status).toBe(401);
    expect((await request(app).get('/api/v1/staff/reservations')).status).toBe(401);
    expect((await request(app).get('/api/v1/admin/reservations').set(auth)).status).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/v1/reservations')
          .set('Cookie', cookie)
          .set('Origin', 'https://foreign.test')
          .send(input())
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/v1/reservations')
          .set('Cookie', cookie)
          .send({ ...input(), memberId: b.id })
      ).status,
    ).toBe(422);
    expect(
      (
        await request(app)
          .post('/api/v1/reservations/not-id/cancel')
          .set('Cookie', cookie)
          .send({ expectedVersion: 0, reason: 'Đổi kế hoạch' })
      ).status,
    ).toBe(422);
    const r = (await create()).reservation;
    await expect(
      actOnReservation(b, r.id, 'cancel', { expectedVersion: 0, reason: 'Đổi kế hoạch' }),
    ).rejects.toMatchObject({ status: 404 });
    expect((await listReservations(b, {})).items).toHaveLength(0);
    await MemberModel.updateOne({ _id: a.id }, { $inc: { authVersion: 1 } });
    expect((await request(app).get('/api/v1/reservations').set('Cookie', cookie)).status).toBe(401);
  });
  it('shows only active tables with enough seats and never exposes QR or contact fields', async () => {
    await TableModel.create({
      code: 'B03',
      name: 'Ẩn',
      capacity: 20,
      isActive: false,
      publicTokenHash: 'hidden',
    });
    const result = await request(app)
      .get('/api/v1/reservations/availability')
      .set('Cookie', cookie)
      .query({ startsAt: at(), partySize: 5 });
    expect(result.status).toBe(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body.data.tables).toEqual([
      { id: otherTableId, name: 'Bàn 02', code: 'B02', capacity: 6 },
    ]);
    expect(JSON.stringify(result.body)).not.toMatch(/publicToken|phone|displayToken/);
  });
  it('fixes duration to one hour and creates no table session before check-in', async () => {
    const { reservation: r } = await create();
    expect(new Date(r.endsAt).getTime() - new Date(r.startsAt).getTime()).toBe(3600000);
    expect(new Date(r.arrivalDeadline).getTime() - new Date(r.startsAt).getTime()).toBe(900000);
    expect(await TableSessionModel.countDocuments()).toBe(0);
    expect(r.status).toBe('CONFIRMED');
    const event = await OutboxEventModel.findOne({ aggregateType: 'Reservation' }).orFail();
    expect(JSON.stringify(event.payload)).not.toMatch(/Khách|0901234567|note/);
  });
  it('rejects past/too-near/too-far time, custom duration and excessive party size', async () => {
    for (const startsAt of [at(-1), at(14), at(8 * 24 * 60)])
      await expect(create({ startsAt })).rejects.toMatchObject({ status: 422 });
    expect(
      (
        await request(app)
          .post('/api/v1/reservations')
          .set('Cookie', cookie)
          .send({ ...input(), durationMinutes: 120 })
      ).status,
    ).toBe(422);
    await expect(create({ partySize: 5 })).rejects.toMatchObject({ code: 'TABLE_TOO_SMALL' });
    await expect(create({ partySize: 31 })).rejects.toThrow();
  });
  it('rejects every overlap and permits an adjacent interval at the exact end', async () => {
    const { reservation: r } = await create();
    for (const offset of [-30, 0, 30])
      await expect(
        create(
          { startsAt: new Date(new Date(r.startsAt).getTime() + offset * 60000).toISOString() },
          b,
        ),
      ).rejects.toMatchObject({ code: 'TABLE_RESERVED' });
    const next = await create({ startsAt: r.endsAt }, b);
    expect(next.created).toBe(true);
    const free = await reservationAvailability({ startsAt: r.startsAt, partySize: 2 });
    expect(free.tables.map((t) => t.id)).not.toContain(tableId);
  });
  it('serializes simultaneous bookings for the same table', async () => {
    const startsAt = at();
    const results = await Promise.allSettled([create({ startsAt }), create({ startsAt }, b)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await ReservationModel.countDocuments()).toBe(1);
  });
  it('replays concurrent retries once, and rejects a changed payload for the same key', async () => {
    const body = input();
    const results = await Promise.all([createReservation(a, body), createReservation(a, body)]);
    expect(new Set(results.map((r) => r.reservation.id)).size).toBe(1);
    expect(await ReservationModel.countDocuments()).toBe(1);
    expect(await AuditLogModel.countDocuments({ action: 'reservation.created' })).toBe(1);
    await expect(createReservation(a, { ...body, note: 'Khác' })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
  });
  it('prevents member overlap and caps concurrent active bookings at three', async () => {
    const startsAt = at();
    await create({ startsAt });
    await expect(create({ startsAt, tableId: otherTableId })).rejects.toMatchObject({
      code: 'RESERVATION_OVERLAP',
    });
    const results = await Promise.allSettled(
      [240, 360, 480].map((minutes) => create({ startsAt: at(minutes), tableId: otherTableId })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(await ReservationModel.countDocuments({ memberId: a.id })).toBe(3);
  });
  it('keeps counter bookings separate from members and shares the interval constraint', async () => {
    const body = input();
    const response = await request(app).post('/api/v1/staff/reservations').set(auth).send(body);
    expect(response.status).toBe(200);
    expect((await listReservations(a, {})).items).toHaveLength(0);
    expect(
      (await ReservationModel.findById(response.body.data.reservation.id).orFail()).memberId,
    ).toBeNull();
    await expect(create({ startsAt: body.startsAt })).rejects.toMatchObject({
      code: 'TABLE_RESERVED',
    });
  });
  it('replays concurrent counter creates and validates the calendar date filter', async () => {
    const body = input();
    const responses = await Promise.all([createReservation(staff, body), createReservation(staff, body)]);
    expect(responses[0]!.reservation.id).toBe(responses[1]!.reservation.id);
    expect(await ReservationModel.countDocuments()).toBe(1);
    await expect(listReservations(staff, { date: '2026-02-30' })).rejects.toMatchObject({ status: 422 });
    await expect(listReservations(staff, { date: '2026-99-01' })).rejects.toMatchObject({ status: 422 });
  });
  it('blocks current occupied tables for near arrivals, preserves future planning and rejects check-in overrun', async () => {
    const { session } = await openSession(tableId, staff.id);
    await expect(create({ startsAt: at(30) })).rejects.toMatchObject({ code: 'TABLE_OCCUPIED' });
    expect(
      (await reservationAvailability({ startsAt: at(30), partySize: 2 })).tables.map((t) => t.id),
    ).not.toContain(tableId);
    const r = (await create()).reservation;
    await arriving(r.id);
    await expect(
      actOnReservation(staff, r.id, 'check-in', { expectedVersion: 0 }),
    ).rejects.toMatchObject({ code: 'TABLE_OCCUPIED' });
    expect((await TableSessionModel.findById(session.id).orFail()).status).toBe('OPEN');
  });
  it('blocks QR, manual opening and transfers into a reserved table', async () => {
    const r = (await create({ startsAt: at(30) })).reservation;
    const table = await TableModel.findById(tableId).orFail(),
      ticket = createAdmissionTicket(tableId, table.qrEpoch);
    await expect(joinAsGuest(ticket.token)).rejects.toMatchObject({ code: 'TABLE_RESERVED' });
    await expect(openSession(tableId, staff.id)).rejects.toMatchObject({ code: 'TABLE_RESERVED' });
    const source = await openSession(otherTableId, staff.id);
    await expect(transferSession(source.session.id, tableId, 0, staff.id)).rejects.toMatchObject({
      code: 'TABLE_RESERVED',
    });
    expect(await TableSessionModel.countDocuments()).toBe(1);
    expect((await ReservationModel.findById(r.id).orFail()).status).toBe('CONFIRMED');
  });
  it('allows check-in only by staff in the arrival window, opens one session and lets QR join that session', async () => {
    const r = (await create()).reservation;
    await expect(
      actOnReservation(a, r.id, 'check-in', { expectedVersion: 0 }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      actOnReservation(staff, r.id, 'check-in', { expectedVersion: 0 }),
    ).rejects.toMatchObject({ code: 'CHECK_IN_TOO_EARLY' });
    await arriving(r.id);
    const [first, retry] = await Promise.all([
      actOnReservation(staff, r.id, 'check-in', { expectedVersion: 0 }),
      actOnReservation(staff, r.id, 'check-in', { expectedVersion: 0 }),
    ]);
    expect(first.tableSessionId).toBe(retry.tableSessionId);
    expect(await TableSessionModel.countDocuments()).toBe(1);
    const table = await TableModel.findById(tableId).orFail();
    const joined = await joinAsGuest(createAdmissionTicket(tableId, table.qrEpoch).token);
    expect(joined.created).toBe(false);
    expect(joined.tableSession.id).toBe(first.tableSessionId);
    await expect(
      actOnReservation(a, r.id, 'cancel', { expectedVersion: 1, reason: 'Đổi kế hoạch' }),
    ).rejects.toMatchObject({ code: 'STATE_TRANSITION_INVALID' });
  });
  it('completes the reservation when its serving session is closed without forcing closure at 60 minutes', async () => {
    const r = (await create()).reservation;
    await arriving(r.id);
    const checked = await actOnReservation(staff, r.id, 'check-in', { expectedVersion: 0 });
    await ReservationModel.updateOne(
      { _id: r.id },
      { $set: { endsAt: new Date(Date.now() - 60000) } },
    );
    await expireReservations(new Date(Date.now() + 120 * 60000));
    expect((await TableSessionModel.findById(checked.tableSessionId).orFail()).status).toBe('OPEN');
    await transition(checked.tableSessionId!, 0, 'CLOSED', staff.id);
    expect((await ReservationModel.findById(r.id).orFail()).status).toBe('COMPLETED');
    expect(await AuditLogModel.countDocuments({ action: 'reservation.completed' })).toBe(1);
  });
  it('moves the checked-in reservation with a transferred session and enforces capacity', async () => {
    const r = (await create()).reservation;
    await arriving(r.id);
    const checked = await actOnReservation(staff, r.id, 'check-in', { expectedVersion: 0 });
    await transferSession(checked.tableSessionId!, otherTableId, 0, staff.id);
    const moved = await ReservationModel.findById(r.id).orFail();
    expect(moved.tableId.toString()).toBe(otherTableId);
    expect(moved.tableName).toBe('Bàn 02');
  });
  it('requires a cancel reason, prevents stale changes and releases the slot on cancellation', async () => {
    const r = (await create()).reservation;
    await expect(
      actOnReservation(a, r.id, 'cancel', { expectedVersion: 1, reason: 'Không đến' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(actOnReservation(a, r.id, 'cancel', { expectedVersion: 0 })).rejects.toMatchObject(
      { status: 422 },
    );
    const cancelled = await actOnReservation(a, r.id, 'cancel', {
      expectedVersion: 0,
      reason: 'Đổi kế hoạch',
    });
    expect(cancelled.status).toBe('CANCELLED');
    expect(
      (await actOnReservation(a, r.id, 'cancel', { expectedVersion: 0, reason: 'Đổi kế hoạch' }))
        .version,
    ).toBe(1);
    expect((await create({ startsAt: r.startsAt }, b)).created).toBe(true);
  });
  it('expires at the 15-minute deadline exactly once and makes the slot available even before the sweep', async () => {
    const r = (await create()).reservation;
    const deadline = new Date(Date.now() - 1000);
    await ReservationModel.updateOne({ _id: r.id }, { $set: { arrivalDeadline: deadline } });
    expect(
      (await reservationAvailability({ startsAt: r.startsAt, partySize: 2 })).tables.map(
        (t) => t.id,
      ),
    ).toContain(tableId);
    await expect(
      actOnReservation(staff, r.id, 'check-in', { expectedVersion: 0 }),
    ).rejects.toMatchObject({ code: 'RESERVATION_EXPIRED' });
    const counts = await Promise.all([expireReservations(), expireReservations()]);
    expect(counts.reduce((s, n) => s + n, 0)).toBe(1);
    expect((await ReservationModel.findById(r.id).orFail()).status).toBe('NO_SHOW');
    expect(await AuditLogModel.countDocuments({ action: 'reservation.noShow' })).toBe(1);
  });
  it('guards admin table deactivation and capacity reductions while preserving harmless edits', async () => {
    await create();
    await expect(tableRepository.update(tableId, { isActive: false })).rejects.toMatchObject({
      code: 'TABLE_HAS_RESERVATIONS',
    });
    await expect(tableRepository.update(tableId, { capacity: 1 })).rejects.toMatchObject({
      code: 'TABLE_HAS_RESERVATIONS',
    });
    expect(
      (await tableRepository.update(tableId, { name: 'Bàn cửa sổ', capacity: 3 }))?.capacity,
    ).toBe(3);
  });
  it('rolls back the booking and table/member writes if audit persistence fails', async () => {
    const table = await TableModel.findById(tableId).orFail(),
      member = await MemberModel.findById(a.id).orFail();
    vi.spyOn(auditRepository, 'log').mockRejectedValueOnce(new Error('audit failed'));
    await expect(create()).rejects.toThrow('audit failed');
    expect(await ReservationModel.countDocuments()).toBe(0);
    expect((await TableModel.findById(tableId).orFail()).admissionCount).toBe(table.admissionCount);
    expect((await MemberModel.findById(a.id).orFail()).version).toBe(member.version);
  });
});
