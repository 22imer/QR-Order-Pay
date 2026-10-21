import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { buildApp } from '../../app.js';
import { UserModel } from '../../models/User.js';
import { WorkShiftModel, WorkActivityModel, StaffingPolicyModel } from '../../models/WorkShift.js';
import { OrderModel } from '../../models/Order.js';
import { ReviewModel } from '../../models/Review.js';
import { AuditLogModel } from '../../models/AuditLog.js';
import { OutboxEventModel } from '../../models/OutboxEvent.js';
import { auditRepository } from '../../repositories/auditRepository.js';
import { outboxRepository } from '../../repositories/outboxRepository.js';
import { hashPassword, signAccessToken } from '../../utils/crypto.js';
import {
  createWorkShift,
  updateWorkShift,
  cancelWorkShift,
  clockWorkShift,
  correctWorkAttendance,
  workforceWeek,
  saveStaffingPolicy,
} from '../../services/workforceService.js';
import { transitionByStaff } from '../../services/orderService.js';
import { toGuestOrder } from '../../services/orderDto.js';
import { workWeekQuerySchema, workShiftCreateSchema } from '@may-cafe/contracts';
import { previewWorkSchedule, copyWorkSchedule } from '../../services/workforceCopyService.js';
import { workforcePeaks, workforceCash } from '../../services/workforceReportsService.js';
import { WorkScheduleCopyModel } from '../../models/WorkShift.js';
import { CashShiftModel } from '../../models/CashShift.js';

let repl: MongoMemoryReplSet, app: ReturnType<typeof buildApp>;
let adminId: string, staffId: string, otherId: string;
let admin: Record<string, string>, staff: Record<string, string>;
const iso = (offset: number) => new Date(Date.now() + offset * 60000).toISOString();
const dateInVn = (time = Date.now()) => new Date(time + 7 * 3600000).toISOString().slice(0, 10);
const input = (extra = {}) => ({
  staffId,
  label: 'Ca thử',
  startsAt: iso(-10),
  endsAt: iso(120),
  note: '',
  requestId: randomUUID(),
  ...extra,
});
const shift = (extra = {}) => createWorkShift(adminId, input(extra));
const week = (isAdmin = true, from = dateInVn()) =>
  workforceWeek(isAdmin ? adminId : staffId, isAdmin, { from });
async function historic(extra = {}) {
  return WorkShiftModel.create({
    ...input({ startsAt: iso(-180), endsAt: iso(-60) }),
    staffName: 'Nhân viên thử',
    requestHash: 'fixture',
    ...extra,
  });
}
async function paidOrder() {
  return OrderModel.create({
    code: randomUUID(),
    tableSessionId: new mongoose.Types.ObjectId(),
    tableId: new mongoose.Types.ObjectId(),
    participantId: 'guest',
    items: [],
    total: 35000,
    paidAmount: 35000,
    status: 'PENDING',
    paymentStatus: 'PAID',
    idempotencyKey: randomUUID(),
    requestHash: 'fixture',
  });
}
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(repl.getUri());
  app = buildApp();
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
}, 120000);
beforeEach(async () => {
  vi.restoreAllMocks();
  for (const collection of Object.values(mongoose.connection.collections))
    await collection.deleteMany({});
  const passwordHash = await hashPassword('Password@123');
  adminId = (
    await UserModel.create({
      name: 'Quản lý thử',
      email: 'admin@work.test',
      role: 'ADMIN',
      passwordHash,
    })
  ).id;
  staffId = (
    await UserModel.create({
      name: 'Nhân viên thử',
      email: 'staff@work.test',
      role: 'STAFF',
      passwordHash,
    })
  ).id;
  otherId = (
    await UserModel.create({
      name: 'Nhân viên khác',
      email: 'other@work.test',
      role: 'STAFF',
      passwordHash,
    })
  ).id;
  admin = {
    Authorization: `Bearer ${signAccessToken({ sub: adminId, role: 'ADMIN', name: 'Quản lý thử' })}`,
  };
  staff = {
    Authorization: `Bearer ${signAccessToken({ sub: staffId, role: 'STAFF', name: 'Nhân viên thử' })}`,
  };
});
afterAll(async () => {
  await mongoose.disconnect();
  await repl.stop();
});

describe('work schedule and attendance', () => {
  it('requires auth/admin, scopes staff reads, and rejects impersonated clocking/extra fields', async () => {
    const a = await shift(),
      b = await shift({ staffId: otherId });
    expect((await request(app).get(`/api/v1/admin/workforce?from=${dateInVn()}`)).status).toBe(401);
    expect(
      (await request(app).get(`/api/v1/admin/workforce?from=${dateInVn()}`).set(staff)).status,
    ).toBe(403);
    expect(
      (await request(app).post('/api/v1/admin/workforce/shifts').set(staff).send(input())).status,
    ).toBe(403);
    const mine = await request(app).get(`/api/v1/staff/workforce?from=${dateInVn()}`).set(staff);
    expect(mine.status).toBe(200);
    expect(mine.body.data.shifts.map((s: { id: string }) => s.id)).toEqual([a.id]);
    expect(mine.body.data.staff).toEqual([]);
    expect(mine.body.data.coverage).toEqual([]);
    expect(
      (
        await request(app)
          .post(`/api/v1/staff/workforce/${b.id}/clock-in`)
          .set(staff)
          .send({ expectedVersion: 0 })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(`/api/v1/staff/workforce/${a.id}/clock-in`)
          .set(staff)
          .send({ expectedVersion: 0, staffId: otherId })
      ).status,
    ).toBe(422);
    expect(
      (await request(app).get('/api/v1/admin/workforce?from=2026-02-30').set(admin)).status,
    ).toBe(422);
    expect(
      (
        await request(app)
          .patch('/api/v1/admin/workforce/shifts/bad-id')
          .set(admin)
          .send({ ...input(), requestId: undefined, expectedVersion: 0 })
      ).status,
    ).toBe(422);
  });
  it('validates calendar dates, duration, strict payloads and historical schedule creation', async () => {
    expect(workWeekQuerySchema.safeParse({ from: '2026-02-30' }).success).toBe(false);
    expect(workWeekQuerySchema.safeParse({ from: '2028-02-29' }).success).toBe(true);
    expect(workShiftCreateSchema.safeParse(input({ endsAt: iso(-20) })).success).toBe(false);
    expect(workShiftCreateSchema.safeParse(input({ endsAt: iso(1000) })).success).toBe(false);
    await expect(shift({ startsAt: iso(-100), endsAt: iso(-30) })).rejects.toMatchObject({
      status: 422,
    });
  });
  it('replays schedule creation exactly once and conflicts on changed request payload', async () => {
    const data = input();
    const a = await createWorkShift(adminId, data),
      b = await createWorkShift(adminId, data);
    expect(a.id).toBe(b.id);
    expect(await WorkShiftModel.countDocuments()).toBe(1);
    expect(await AuditLogModel.countDocuments({ action: 'workforce.scheduled' })).toBe(1);
    await expect(createWorkShift(adminId, { ...data, label: 'Thay đổi' })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
  });
  it('serializes concurrent overlapping schedules even when different admins schedule them', async () => {
    const second = await UserModel.create({
      name: 'Quản lý 2',
      role: 'ADMIN',
      email: 'admin2@work.test',
      passwordHash: 'fixture',
    });
    const results = await Promise.allSettled([shift(), createWorkShift(second.id, input())]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      (results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason.code,
    ).toBe('WORK_SHIFT_OVERLAP');
    expect(await WorkShiftModel.countDocuments()).toBe(1);
  });
  it('allows adjacent shifts and cancellation frees schedule space, retaining reason/history', async () => {
    const boundary = iso(120);
    const a = await shift({ endsAt: boundary });
    await shift({ startsAt: boundary, endsAt: iso(240) });
    await cancelWorkShift(a.id, adminId, { expectedVersion: 0, reason: 'Nghỉ có phép' });
    await cancelWorkShift(a.id, adminId, { expectedVersion: 0, reason: 'Nghỉ có phép' });
    await shift({ endsAt: boundary });
    expect(await WorkShiftModel.countDocuments()).toBe(3);
    expect(await AuditLogModel.countDocuments({ action: 'workforce.cancelled' })).toBe(1);
  });
  it('uses expectedVersion for rescheduling and supports safe retry after response loss', async () => {
    const a = await shift();
    const update = {
      staffId,
      label: 'Ca đổi',
      startsAt: a.startsAt,
      endsAt: a.endsAt,
      note: '',
      expectedVersion: 0,
    };
    await updateWorkShift(a.id, adminId, update);
    const replay = await updateWorkShift(a.id, adminId, update);
    expect(replay.version).toBe(1);
    await expect(
      updateWorkShift(a.id, adminId, { ...update, label: 'Ghi đè' }),
    ).rejects.toMatchObject({ code: 'WORK_SHIFT_CHANGED' });
    expect(await AuditLogModel.countDocuments({ action: 'workforce.rescheduled' })).toBe(1);
  });
  it('clocks in/out using server time; duplicate clicks cannot duplicate punches/audits', async () => {
    const a = await shift();
    const results = await Promise.all([
      clockWorkShift(a.id, staffId, 'in', { expectedVersion: 0 }),
      clockWorkShift(a.id, staffId, 'in', { expectedVersion: 0 }),
    ]);
    expect(results[0].clockInAt).toBe(results[1].clockInAt);
    expect(results[0].lateMinutes).toBeGreaterThanOrEqual(5);
    expect(await AuditLogModel.countDocuments({ action: 'workforce.clockedIn' })).toBe(1);
    const out = await clockWorkShift(a.id, staffId, 'out', { expectedVersion: 1 });
    const replay = await clockWorkShift(a.id, staffId, 'out', { expectedVersion: 1 });
    expect(out.status).toBe('COMPLETED');
    expect(out.clockOutAt).toBe(replay.clockOutAt);
    expect(await AuditLogModel.countDocuments({ action: 'workforce.clockedOut' })).toBe(1);
  });
  it('enforces the clock window, prevents cancelled/ended clock-in and locks attended schedules', async () => {
    const early = await shift({ startsAt: iso(60), endsAt: iso(180) });
    await expect(
      clockWorkShift(early.id, staffId, 'in', { expectedVersion: 0 }),
    ).rejects.toMatchObject({ code: 'CLOCK_WINDOW' });
    await cancelWorkShift(early.id, adminId, { expectedVersion: 0, reason: 'Đổi lịch mới' });
    await expect(
      clockWorkShift(early.id, staffId, 'in', { expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: 'WORK_SHIFT_LOCKED' });
    const ended = await historic();
    await expect(
      clockWorkShift(ended.id, staffId, 'in', { expectedVersion: 0 }),
    ).rejects.toMatchObject({ code: 'CLOCK_WINDOW' });
    const a = await shift();
    await clockWorkShift(a.id, staffId, 'in', { expectedVersion: 0 });
    await expect(
      cancelWorkShift(a.id, adminId, { expectedVersion: 1, reason: 'Không hợp lệ' }),
    ).rejects.toMatchObject({ code: 'WORK_SHIFT_LOCKED' });
    await expect(
      updateWorkShift(a.id, adminId, {
        staffId,
        label: 'Đổi',
        startsAt: a.startsAt,
        endsAt: a.endsAt,
        note: '',
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'WORK_SHIFT_LOCKED' });
  });
  it('prevents overlapping actual time when an older shift was never clocked out', async () => {
    const old = await historic({
      status: 'WORKING',
      clockInAt: new Date(iso(-170)),
      effectiveInAt: new Date(iso(-170)),
    });
    const a = await shift();
    await expect(clockWorkShift(a.id, staffId, 'in', { expectedVersion: 0 })).rejects.toMatchObject(
      { code: 'ATTENDANCE_OVERLAP' },
    );
    const mine = await week(false, dateInVn(Date.now() + 7 * 86400000));
    expect(mine.currentShift?.id).toBe(old.id); // The out button survives week navigation.
    await clockWorkShift(old.id, staffId, 'out', { expectedVersion: 0 });
    await clockWorkShift(a.id, staffId, 'in', { expectedVersion: 0 });
  });
  it('corrects missing punches with reason, preserves raw punches and replays safely', async () => {
    const old = await historic({
      status: 'WORKING',
      clockInAt: new Date(iso(-170)),
      effectiveInAt: new Date(iso(-170)),
    });
    const rawIn = old.clockInAt!.toISOString();
    const correction = {
      startsAt: iso(-175),
      endsAt: iso(-65),
      expectedVersion: 0,
      reason: 'Quên ra ca, đã xác minh',
    };
    const fixed = await correctWorkAttendance(old.id, adminId, correction);
    const replay = await correctWorkAttendance(old.id, adminId, correction);
    expect(fixed.clockInAt).toBe(rawIn);
    expect(fixed.clockOutAt).toBeNull();
    expect(fixed.status).toBe('COMPLETED');
    expect(replay.version).toBe(1);
    expect(await AuditLogModel.countDocuments({ action: 'workforce.attendanceCorrected' })).toBe(1);
    const audit = await AuditLogModel.findOne({ action: 'workforce.attendanceCorrected' }).orFail();
    expect(audit.metadata.before.effectiveOutAt).toBeNull();
    expect(audit.metadata.after.correctionReason).toBe(correction.reason);
  });
  it('rejects future corrections, overlapping attendance, missing reason and stale versions', async () => {
    const old = await historic();
    const correction = {
      startsAt: iso(-170),
      endsAt: iso(-70),
      expectedVersion: 0,
      reason: 'Bổ sung giờ thực tế',
    };
    await expect(
      correctWorkAttendance(old.id, adminId, { ...correction, endsAt: iso(5) }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      correctWorkAttendance(old.id, adminId, { ...correction, reason: '' }),
    ).rejects.toThrow();
    await correctWorkAttendance(old.id, adminId, correction);
    await expect(
      correctWorkAttendance(old.id, adminId, { ...correction, reason: 'Ghi đè' }),
    ).rejects.toMatchObject({ code: 'WORK_SHIFT_CHANGED' });
    const other = await historic({ startsAt: iso(-60), endsAt: iso(-5) });
    await expect(
      correctWorkAttendance(other.id, adminId, {
        ...correction,
        startsAt: iso(-80),
        endsAt: iso(-10),
      }),
    ).rejects.toMatchObject({ code: 'ATTENDANCE_OVERLAP' });
  });
  it('allows cancelling/correcting disabled users while blocking new assignments and clocks', async () => {
    const a = await shift(),
      old = await historic();
    await UserModel.updateOne({ _id: staffId }, { $set: { isActive: false } });
    await expect(shift()).rejects.toMatchObject({ status: 403 });
    await expect(clockWorkShift(a.id, staffId, 'in', { expectedVersion: 0 })).rejects.toMatchObject(
      { status: 403 },
    );
    await cancelWorkShift(a.id, adminId, { expectedVersion: 0, reason: 'Nhân viên đã nghỉ' });
    await correctWorkAttendance(old.id, adminId, {
      expectedVersion: 0,
      startsAt: iso(-170),
      endsAt: iso(-70),
      reason: 'Xác nhận ca cuối',
    });
  });
  it('rolls schedule/attendance changes back with their audit on failure', async () => {
    const before = await UserModel.findById(staffId).lean();
    const spy = vi.spyOn(auditRepository, 'log').mockRejectedValueOnce(new Error('audit failed'));
    await expect(shift()).rejects.toThrow('audit failed');
    expect(await WorkShiftModel.countDocuments()).toBe(0);
    expect((await UserModel.findById(staffId).lean())!.__v).toBe(before!.__v);
    spy.mockRestore();
    const a = await shift();
    vi.spyOn(auditRepository, 'log').mockRejectedValueOnce(new Error('clock audit failed'));
    await expect(clockWorkShift(a.id, staffId, 'in', { expectedVersion: 0 })).rejects.toThrow(
      'clock audit failed',
    );
    expect((await WorkShiftModel.findById(a.id).orFail()).status).toBe('SCHEDULED');
  });
});

describe('staffing coverage and attributed performance', () => {
  it('resolves simultaneous first policy creation without a server error', async () => {
    const second = await UserModel.create({
      name: 'Quản lý 2',
      role: 'ADMIN',
      email: 'admin2@work.test',
      passwordHash: 'fixture',
    });
    const rule = { day: 1, startMinute: 420, endMinute: 540, minStaff: 2, label: 'Sáng' };
    const results = await Promise.allSettled([
      saveStaffingPolicy(adminId, { expectedVersion: 0, rules: [rule] }),
      saveStaffingPolicy(second.id, { expectedVersion: 0, rules: [{ ...rule, minStaff: 3 }] }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      (results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason.code,
    ).toBe('POLICY_CHANGED');
    expect(await StaffingPolicyModel.countDocuments()).toBe(1);
  });
  it('blocks a forgotten clock-out older than 24 hours and permits an audited correction', async () => {
    const old = await historic({
      startsAt: iso(-1510),
      endsAt: iso(-1450),
      status: 'WORKING',
      clockInAt: iso(-1500),
      effectiveInAt: iso(-1500),
    });
    await expect(
      clockWorkShift(old.id, staffId, 'out', { expectedVersion: 0 }),
    ).rejects.toMatchObject({ code: 'ATTENDANCE_CORRECTION_REQUIRED' });
    await correctWorkAttendance(old.id, adminId, {
      startsAt: iso(-1500),
      endsAt: iso(-1450),
      expectedVersion: 0,
      reason: 'Quên chấm ra hôm trước',
    });
    expect((await WorkShiftModel.findById(old.id).orFail()).status).toBe('COMPLETED');
  });
  it('serializes the attendance snapshot with simultaneous KDS activity and clock-out', async () => {
    const a = await shift();
    await clockWorkShift(a.id, staffId, 'in', { expectedVersion: 0 });
    const order = await paidOrder();
    await Promise.all([
      transitionByStaff(order.id, 'CONFIRMED', { id: staffId }),
      clockWorkShift(a.id, staffId, 'out', { expectedVersion: 1 }),
    ]);
    const activity = await WorkActivityModel.findOne().orFail();
    const ended = await WorkShiftModel.findById(a.id).orFail();
    if (activity.workShiftId) {
      expect(String(activity.workShiftId)).toBe(a.id);
      expect(activity.at.getTime()).toBeLessThanOrEqual(ended.clockOutAt!.getTime());
    }
    expect(await WorkActivityModel.countDocuments()).toBe(1);
    expect(ended.status).toBe('COMPLETED');
  });
  it('uses minimum simultaneous coverage across a whole window, not the count of overlapping shifts', async () => {
    const tomorrow = dateInVn(Date.now() + 86400000),
      start = Date.parse(`${tomorrow}T00:00:00+07:00`);
    const day = new Date(start + 7 * 3600000).getUTCDay() || 7;
    await shift({
      startsAt: new Date(start + 7 * 3600000).toISOString(),
      endsAt: new Date(start + 8 * 3600000).toISOString(),
    });
    await shift({
      startsAt: new Date(start + 8 * 3600000).toISOString(),
      endsAt: new Date(start + 9 * 3600000).toISOString(),
    });
    await saveStaffingPolicy(adminId, {
      expectedVersion: 0,
      rules: [{ day, startMinute: 420, endMinute: 540, minStaff: 2, label: 'Cao điểm' }],
    });
    let report = await week(true, tomorrow);
    expect(report.coverage[0]).toMatchObject({ scheduled: 1, shortage: 1, required: 2 });
    await UserModel.updateOne({ _id: staffId }, { $set: { isActive: false } });
    report = await week(true, tomorrow);
    expect(report.coverage[0]?.scheduled).toBe(0);
  });
  it('reports actual clocked staff now separately from scheduled minimum and detects gaps', async () => {
    const from = dateInVn(),
      midnight = Date.parse(`${from}T00:00:00+07:00`);
    const day = new Date(midnight + 7 * 3600000).getUTCDay() || 7;
    const a = await shift();
    await clockWorkShift(a.id, staffId, 'in', { expectedVersion: 0 });
    await saveStaffingPolicy(adminId, {
      expectedVersion: 0,
      rules: [{ day, startMinute: 0, endMinute: 1440, minStaff: 2, label: 'Trong ngày' }],
    });
    const report = await week();
    expect(report.coverage[0]).toMatchObject({ scheduled: 0, shortage: 2, presentNow: 1 });
  });
  it('rejects overlapping policy windows, checks version and safely retries identical policy writes', async () => {
    const r = { day: 1, startMinute: 420, endMinute: 540, minStaff: 2, label: 'Sáng' };
    await expect(
      saveStaffingPolicy(adminId, { expectedVersion: 0, rules: [r, r] }),
    ).rejects.toMatchObject({ status: 422 });
    await saveStaffingPolicy(adminId, { expectedVersion: 0, rules: [r] });
    expect((await saveStaffingPolicy(adminId, { expectedVersion: 0, rules: [r] })).version).toBe(1);
    await expect(
      saveStaffingPolicy(adminId, { expectedVersion: 0, rules: [] }),
    ).rejects.toMatchObject({ code: 'POLICY_CHANGED' });
    await saveStaffingPolicy(adminId, { expectedVersion: 1, rules: [] });
    expect((await StaffingPolicyModel.findById('default').orFail()).rules).toHaveLength(0);
  });
  it('clips overnight attendance to Vietnam week boundaries and excludes cancelled/unfinished hours', async () => {
    const from = dateInVn(),
      midnight = Date.parse(`${from}T00:00:00+07:00`);
    await historic({
      startsAt: new Date(midnight - 2 * 3600000),
      endsAt: new Date(midnight + 2 * 3600000),
      status: 'COMPLETED',
      effectiveInAt: new Date(midnight - 2 * 3600000),
      effectiveOutAt: new Date(midnight + 2 * 3600000),
    });
    await historic({
      staffId: otherId,
      status: 'WORKING',
      effectiveInAt: new Date(midnight - 3600000),
    });
    await historic({ status: 'CANCELLED' });
    const report = await week(true, from);
    const mine = report.metrics.find((r) => r.staffId === staffId)!;
    expect(mine.scheduledMinutes).toBe(120);
    expect(mine.workedMinutes).toBe(120);
    const other = report.metrics.find((r) => r.staffId === otherId)!;
    expect(other.workedMinutes).toBe(0);
    expect(other.openAttendances).toBe(1);
  });
  it('records KDS attribution, credits preparation to its starter and reviews to served orders, with sample counts', async () => {
    const a = await shift();
    await clockWorkShift(a.id, staffId, 'in', { expectedVersion: 0 });
    const order = await paidOrder();
    await transitionByStaff(order.id, 'CONFIRMED', { id: staffId });
    await transitionByStaff(order.id, 'PREPARING', { id: staffId });
    await WorkActivityModel.updateOne(
      { orderId: order.id, stage: 'PREPARING' },
      { $set: { at: new Date(Date.now() - 6 * 60000) } },
    );
    await transitionByStaff(order.id, 'READY', { id: otherId });
    await transitionByStaff(order.id, 'SERVED', { id: otherId });
    await ReviewModel.create({
      orderId: order.id,
      tableSessionId: order.tableSessionId,
      participantId: 'guest',
      rating: 4,
    });
    const report = await week();
    expect(report.metrics.find((r) => r.staffId === staffId)).toMatchObject({
      confirmed: 1,
      preparing: 1,
      ready: 0,
      preparationSamples: 1,
      averagePreparationMinutes: 6,
      reviewedOrders: 0,
      outsideShiftActions: 0,
    });
    expect(report.metrics.find((r) => r.staffId === otherId)).toMatchObject({
      ready: 1,
      served: 1,
      reviewedOrders: 1,
      averageOrderRating: 4,
      outsideShiftActions: 2,
      averagePreparationMinutes: null,
    });
    expect(report.shiftMetrics.find((r) => r.workShiftId === a.id)).toMatchObject({
      confirmed: 1,
      preparing: 1,
      preparationSamples: 1,
      averagePreparationMinutes: 6,
    });
    const serialized = JSON.stringify(toGuestOrder(await OrderModel.findById(order.id).orFail()));
    expect(serialized).not.toContain('workShiftId');
    expect(serialized).not.toContain(staffId);
    const mine = await week(false);
    expect(mine.metrics.map((r) => r.staffId)).toEqual([staffId]);
    expect(await WorkActivityModel.countDocuments()).toBe(4);
    await expect(transitionByStaff(order.id, 'SERVED', { id: otherId })).rejects.toMatchObject({
      code: 'STATE_TRANSITION_INVALID',
    });
    expect(await WorkActivityModel.countDocuments()).toBe(4);
  });
  it('rolls order, activity, audit and outbox back together and never invents legacy activity', async () => {
    const a = await shift();
    await clockWorkShift(a.id, staffId, 'in', { expectedVersion: 0 });
    const order = await paidOrder();
    vi.spyOn(outboxRepository, 'createRealtimeEvents').mockRejectedValueOnce(
      new Error('outbox failed'),
    );
    await expect(transitionByStaff(order.id, 'CONFIRMED', { id: staffId })).rejects.toThrow(
      'outbox failed',
    );
    expect((await OrderModel.findById(order.id).orFail()).status).toBe('PENDING');
    expect(await WorkActivityModel.countDocuments()).toBe(0);
    expect(await AuditLogModel.countDocuments({ action: 'order.transition' })).toBe(0);
    expect(await OutboxEventModel.countDocuments({ eventType: { $ne: 'workforce.changed' } })).toBe(
      0,
    );
    expect((await WorkShiftModel.findById(a.id).orFail()).activityVersion).toBe(0);
    const report = await week();
    expect(report.metrics[0]?.confirmed).toBe(0);
  });
  it('retains KDS snapshot when attendance is corrected and employees are removed', async () => {
    const a = await shift();
    await clockWorkShift(a.id, staffId, 'in', { expectedVersion: 0 });
    const order = await paidOrder();
    await transitionByStaff(order.id, 'CONFIRMED', { id: staffId });
    const original = (await WorkActivityModel.findOne().orFail()).toObject();
    await correctWorkAttendance(a.id, adminId, {
      startsAt: iso(-8),
      endsAt: iso(-1),
      reason: 'Kiểm tra giờ thực tế',
      expectedVersion: 1,
    });
    await UserModel.updateOne({ _id: staffId }, { $set: { isActive: false, isDeleted: true } });
    expect((await WorkActivityModel.findOne().orFail()).toObject()).toEqual(original);
    expect((await week()).metrics.find((r) => r.staffId === staffId)?.confirmed).toBe(1);
  });
});

describe('completed workforce planning and reports', () => {
  it('publishes privacy-safe workforce invalidations once per committed mutation, never for replay', async () => {
    const body = input();
    const a = await createWorkShift(adminId, body);
    await createWorkShift(adminId, body);
    const updated = {
      staffId,
      label: 'Đổi realtime',
      startsAt: a.startsAt,
      endsAt: a.endsAt,
      note: '',
      expectedVersion: 0,
    };
    await updateWorkShift(a.id, adminId, updated);
    await updateWorkShift(a.id, adminId, updated);
    await clockWorkShift(a.id, staffId, 'in', { expectedVersion: 1 });
    await clockWorkShift(a.id, staffId, 'in', { expectedVersion: 1 });
    await clockWorkShift(a.id, staffId, 'out', { expectedVersion: 2 });
    await clockWorkShift(a.id, staffId, 'out', { expectedVersion: 2 });
    const correction = {
      startsAt: iso(-8),
      endsAt: iso(-1),
      expectedVersion: 3,
      reason: 'Đối chiếu realtime',
    };
    await correctWorkAttendance(a.id, adminId, correction);
    await correctWorkAttendance(a.id, adminId, correction);
    const other = await shift({ staffId: otherId });
    await cancelWorkShift(other.id, adminId, { expectedVersion: 0, reason: 'Đổi lịch realtime' });
    await saveStaffingPolicy(adminId, { expectedVersion: 0, rules: [] });
    await saveStaffingPolicy(adminId, { expectedVersion: 0, rules: [] });
    const events = await OutboxEventModel.find({ eventType: 'workforce.changed' }).lean();
    expect(events).toHaveLength(8);
    expect(
      events.every(
        (e) =>
          e.target.scope === 'staff' &&
          e.aggregateId === 'workforce' &&
          e.aggregateVersion === null,
      ),
    ).toBe(true);
    expect(events.map((e) => e.payload)).toEqual(
      Array.from({ length: 8 }, () => ({ refresh: true })),
    );
  });
  it('rolls schedule and audit back if its workforce notification cannot be recorded', async () => {
    vi.spyOn(outboxRepository, 'createRealtimeEvents').mockRejectedValueOnce(
      new Error('workforce outbox failed'),
    );
    await expect(shift()).rejects.toThrow('workforce outbox failed');
    expect(await WorkShiftModel.countDocuments()).toBe(0);
    expect(await AuditLogModel.countDocuments({ action: 'workforce.scheduled' })).toBe(0);
    expect(await OutboxEventModel.countDocuments()).toBe(0);
  });
  it('emits a single copy-batch notification and rolls the entire copy back when notification fails', async () => {
    await shift();
    await shift({ staffId: otherId });
    const p = await preview();
    const body = copyBody(p);
    await OutboxEventModel.deleteMany({});
    vi.spyOn(outboxRepository, 'createRealtimeEvents').mockRejectedValueOnce(
      new Error('copy notification failed'),
    );
    await expect(copyWorkSchedule(adminId, body)).rejects.toThrow('copy notification failed');
    expect(await WorkShiftModel.countDocuments()).toBe(2);
    expect(await WorkScheduleCopyModel.countDocuments()).toBe(0);
    vi.restoreAllMocks();
    await copyWorkSchedule(adminId, body);
    await copyWorkSchedule(adminId, body);
    expect(await OutboxEventModel.countDocuments({ eventType: 'workforce.changed' })).toBe(1);
  });
  const targetDay = () => dateInVn(Date.now() + 7 * 86400000);
  async function preview() {
    return previewWorkSchedule(adminId, { from: dateInVn(), targetFrom: targetDay() });
  }
  const copyBody = (p: Awaited<ReturnType<typeof preview>>) => ({
    from: p.from,
    targetFrom: p.targetFrom,
    snapshot: p.snapshot,
    requestId: randomUUID(),
  });
  it('previews then copies schedules atomically without attendance or KDS, and safely replays', async () => {
    const a = await shift();
    await clockWorkShift(a.id, staffId, 'in', { expectedVersion: 0 });
    await shift({ staffId: otherId });
    const p = await preview();
    expect(p.shifts).toHaveLength(2);
    expect(p.conflicts).toHaveLength(0);
    expect(await WorkShiftModel.countDocuments()).toBe(2);
    const body = copyBody(p),
      created = await copyWorkSchedule(adminId, body);
    expect(created.count).toBe(2);
    expect((await copyWorkSchedule(adminId, body)).ids).toEqual(created.ids);
    expect(await WorkScheduleCopyModel.countDocuments()).toBe(1);
    expect(await AuditLogModel.countDocuments({ action: 'workforce.copied' })).toBe(2);
    const copies = await WorkShiftModel.find({ _id: { $in: created.ids } });
    expect(
      copies.every(
        (s) => s.status === 'SCHEDULED' && !s.effectiveInAt && !s.clockInAt && s.version === 0,
      ),
    ).toBe(true);
    await expect(
      copyWorkSchedule(adminId, { ...body, snapshot: 'a'.repeat(64) }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
  it('rejects changed source and reports target conflicts without partially creating shifts', async () => {
    const a = await shift();
    await shift({ staffId: otherId });
    const p = await preview();
    await updateWorkShift(a.id, adminId, {
      staffId,
      label: 'Đổi nguồn',
      startsAt: a.startsAt,
      endsAt: a.endsAt,
      note: '',
      expectedVersion: 0,
    });
    await expect(copyWorkSchedule(adminId, copyBody(p))).rejects.toMatchObject({
      code: 'COPY_CHANGED',
    });
    const changed = await preview(),
      target = changed.shifts.find((s) => s.staffId === staffId)!;
    await shift({ startsAt: target.startsAt, endsAt: target.endsAt });
    const conflict = await preview();
    expect(conflict.conflicts).toHaveLength(1);
    await expect(copyWorkSchedule(adminId, copyBody(conflict))).rejects.toMatchObject({
      code: 'COPY_CONFLICT',
    });
    expect(await WorkShiftModel.countDocuments()).toBe(3);
    expect(await WorkScheduleCopyModel.countDocuments()).toBe(0);
  });
  it('serializes two copy requests targeting the same week and rolls back an audit failure', async () => {
    await shift();
    await shift({ staffId: otherId });
    const p = await preview();
    vi.spyOn(auditRepository, 'log').mockRejectedValueOnce(new Error('copy audit failed'));
    await expect(copyWorkSchedule(adminId, copyBody(p))).rejects.toThrow('copy audit failed');
    expect(await WorkShiftModel.countDocuments()).toBe(2);
    expect(await WorkScheduleCopyModel.countDocuments()).toBe(0);
    vi.restoreAllMocks();
    const results = await Promise.allSettled([
      copyWorkSchedule(adminId, copyBody(p)),
      copyWorkSchedule(adminId, copyBody(p)),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await WorkShiftModel.countDocuments()).toBe(4);
  });
  it('blocks staff copying, rejects misaligned weeks and catches a disabled employee', async () => {
    await shift();
    const p = await preview();
    expect(
      (
        await request(app)
          .post('/api/v1/admin/workforce/copy-preview')
          .set(staff)
          .send({ from: p.from, targetFrom: p.targetFrom })
      ).status,
    ).toBe(403);
    expect(
      (await request(app).post('/api/v1/admin/workforce/copy').set(staff).send(copyBody(p))).status,
    ).toBe(403);
    await expect(
      previewWorkSchedule(adminId, {
        from: dateInVn(),
        targetFrom: dateInVn(Date.now() + 8 * 86400000),
      }),
    ).rejects.toThrow();
    await UserModel.updateOne({ _id: staffId }, { $set: { isActive: false } });
    expect((await preview()).conflicts[0]?.reason).toContain('khóa');
    await expect(copyWorkSchedule(adminId, copyBody(p))).rejects.toMatchObject({
      code: 'COPY_CONFLICT',
    });
  });
  it('uses four complete Vietnam weeks and paid demand with zero-week denominators, not future data', async () => {
    const anchor = new Date('2026-10-19T00:00:00+07:00'),
      now = new Date('2026-10-21T15:00:00Z');
    const at = new Date('2026-10-12T00:30:00Z'); // Monday 07:30 Vietnam.
    for (let i = 0; i < 24; i++) {
      const o = await paidOrder();
      await OrderModel.collection.updateOne({ _id: o._id }, { $set: { createdAt: at } });
    }
    const ignored = await paidOrder();
    await OrderModel.collection.updateOne(
      { _id: ignored._id },
      { $set: { createdAt: at, paymentStatus: 'UNPAID' } },
    );
    const future = await paidOrder();
    await OrderModel.collection.updateOne(
      { _id: future._id },
      { $set: { createdAt: new Date('2026-10-20T00:30:00Z') } },
    );
    const result = await workforcePeaks(anchor, now, 4);
    expect(result.paidOrders).toBe(24);
    expect(result.items[0]).toMatchObject({
      day: 1,
      hour: 7,
      orders: 24,
      occurrences: 4,
      averageOrders: 6,
      recommendedStaff: 2,
    });
    await saveStaffingPolicy(adminId, { expectedVersion: 0, rules: [], ordersPerStaffHour: 4 });
    expect((await StaffingPolicyModel.findById('default').orFail()).ordersPerStaffHour).toBe(4);
    await expect(
      saveStaffingPolicy(adminId, { expectedVersion: 0, rules: [], ordersPerStaffHour: 5 }),
    ).rejects.toMatchObject({ code: 'POLICY_CHANGED' });
    await OrderModel.deleteMany({});
    expect((await workforcePeaks(anchor, now, 6)).enoughData).toBe(false);
  });
  it('shows cash shifts by opened/closed time plus ongoing shifts, with totals across more than 50 rows', async () => {
    for (let i = 0; i < 60; i++)
      await CashShiftModel.create({
        code: `CS${i}`,
        status: 'CLOSED',
        openedBy: staffId,
        openedByName: 'Thu ngân',
        openedAt: new Date(iso(-120)),
        closedBy: otherId,
        closedByName: 'Người chốt',
        closedAt: new Date(iso(-60)),
        openingCash: 0,
        expectedCash: 100,
        countedCash: 90,
        difference: -10,
        reconciliationNote: 'Thiếu tiền test',
      });
    await CashShiftModel.create({
      code: 'OLDOPEN',
      status: 'OPEN',
      openedBy: staffId,
      openedByName: 'Thu ngân cũ',
      openedAt: new Date(iso(-100000)),
      openingCash: 0,
    });
    const report = await workforceCash(
      new Date(`${dateInVn()}T00:00:00+07:00`),
      new Date(Date.now() + 86400000),
    );
    expect(report.total).toBe(61);
    expect(report.items).toHaveLength(50);
    expect(report.closedCount).toBe(60);
    expect(report.totalDifference).toBe(-600);
    expect((await week(false)).cash).toBeNull();
    expect((await week(false)).peaks).toBeNull();
  });
  it('exports only the authenticated employee, with Vietnamese CSV headers, no secrets and spreadsheet formula protection', async () => {
    await shift({ label: '=HYPERLINK("https://example.invalid")' });
    await shift({ staffId: otherId, label: 'Ca của người khác' });
    const res = await request(app)
      .get(`/api/v1/staff/workforce/export?from=${dateInVn()}`)
      .set(staff);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).toContain('Giờ Việt Nam');
    expect(res.text).toContain("'=HYPERLINK");
    expect(res.text).not.toContain('Ca của người khác');
    expect(res.text).not.toContain('requestHash');
    expect(
      (await request(app).get(`/api/v1/admin/workforce/export?from=${dateInVn()}`).set(staff))
        .status,
    ).toBe(403);
    expect(
      (await request(app).get('/api/v1/staff/workforce/export?from=2026-02-30').set(staff)).status,
    ).toBe(422);
  });
});
