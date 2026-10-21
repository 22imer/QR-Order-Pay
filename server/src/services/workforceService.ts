import { Types, type ClientSession } from 'mongoose';
import {
  workShiftCreateSchema,
  workShiftUpdateSchema,
  workShiftCancelSchema,
  workClockSchema,
  workAttendanceCorrectionSchema,
  staffingPolicySchema,
  workWeekQuerySchema,
  type WorkShiftDto,
  type WorkforceWeek,
} from '@may-cafe/contracts';
import {
  WorkShiftModel,
  StaffingPolicyModel,
  WorkActivityModel,
  type WorkShiftDoc,
} from '../models/WorkShift.js';
import { UserModel } from '../models/User.js';
import { unitOfWork } from '../infrastructure/unitOfWork.js';
import { auditRepository } from '../repositories/auditRepository.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../errors/AppError.js';
import { sha256 } from '../utils/crypto.js';
import { workforcePeaks, workforceCash } from './workforceReportsService.js';
import { queueWorkforceChanged } from './workforceRealtimeService.js';

const HOUR = 3600000;
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const minutes = (a: Date, b: Date) => Math.max(0, Math.floor((b.getTime() - a.getTime()) / 60000));
function validId(id: string) {
  if (!Types.ObjectId.isValid(id)) throw new ValidationError('Mã ca/nhân viên không hợp lệ.');
}
async function lockUser(id: string, session: ClientSession, admin = false) {
  validId(id);
  const user = await UserModel.findOneAndUpdate(
    {
      _id: id,
      isActive: true,
      isDeleted: { $ne: true },
      ...(admin ? { role: 'ADMIN' } : {}),
    },
    { $inc: { __v: 1 } },
    { new: true, session },
  );
  if (!user) throw new ForbiddenError('Tài khoản không còn hoạt động hoặc không có quyền.');
  return user;
}
async function shiftById(id: string, session: ClientSession) {
  validId(id);
  const shift = await WorkShiftModel.findById(id).session(session);
  if (!shift) throw new NotFoundError('Không tìm thấy lịch ca.');
  return shift;
}
function checkVersion(shift: WorkShiftDoc, version: number) {
  if (shift.version !== version)
    throw new ConflictError(
      'WORK_SHIFT_CHANGED',
      'Ca đã thay đổi. Hãy tải lại trước khi thao tác.',
    );
}
async function audit(
  actorId: string,
  action: string,
  shift: WorkShiftDoc,
  before: unknown,
  session: ClientSession,
  notify = true,
) {
  await auditRepository.log(
    {
      actorType: 'USER',
      actorId,
      action: `workforce.${action}`,
      entityType: 'WorkShift',
      entityId: shift.id,
      metadata: { before, after: toWorkShift(shift) },
    },
    session,
  );
  if (notify) await queueWorkforceChanged(session);
}
async function assertScheduleFree(
  staffId: string,
  start: Date,
  end: Date,
  except: string | null,
  session: ClientSession,
) {
  if (
    await WorkShiftModel.exists({
      staffId,
      status: { $ne: 'CANCELLED' },
      startsAt: { $lt: end },
      endsAt: { $gt: start },
      ...(except ? { _id: { $ne: except } } : {}),
    }).session(session)
  )
    throw new ConflictError('WORK_SHIFT_OVERLAP', 'Nhân viên đã có ca trùng thời gian.');
}
async function assertAttendanceFree(
  staffId: string,
  start: Date,
  end: Date | null,
  except: string,
  session: ClientSession,
) {
  if (
    await WorkShiftModel.exists({
      staffId,
      _id: { $ne: except },
      effectiveInAt: { $ne: null, ...(end ? { $lt: end } : {}) },
      $or: [{ effectiveOutAt: null }, { effectiveOutAt: { $gt: start } }],
    }).session(session)
  )
    throw new ConflictError(
      'ATTENDANCE_OVERLAP',
      'Giờ làm thực tế trùng ca khác hoặc còn ca chưa ra.',
    );
}

export function toWorkShift(shift: WorkShiftDoc, now = new Date()): WorkShiftDto {
  const effectiveIn = shift.effectiveInAt ?? null;
  const effectiveOut = shift.effectiveOutAt ?? null;
  return {
    id: shift.id,
    staffId: String(shift.staffId),
    staffName: shift.staffName,
    label: shift.label,
    startsAt: shift.startsAt.toISOString(),
    endsAt: shift.endsAt.toISOString(),
    status: shift.status as WorkShiftDto['status'],
    note: shift.note,
    clockInAt: iso(shift.clockInAt),
    clockOutAt: iso(shift.clockOutAt),
    effectiveInAt: iso(effectiveIn),
    effectiveOutAt: iso(effectiveOut),
    correctionReason: shift.correctionReason,
    correctedByName: shift.correctedByName,
    cancelReason: shift.cancelReason,
    version: shift.version,
    lateMinutes: effectiveIn ? Math.max(0, minutes(shift.startsAt, effectiveIn) - 5) : 0,
    workedMinutes: effectiveIn && effectiveOut ? minutes(effectiveIn, effectiveOut) : null,
    attendance:
      shift.status === 'CANCELLED'
        ? 'CANCELLED'
        : effectiveOut
          ? 'COMPLETED'
          : effectiveIn
            ? 'WORKING'
            : now >= shift.endsAt
              ? 'ABSENT'
              : now >= shift.startsAt
                ? 'WAITING'
                : 'UPCOMING',
  };
}

export async function createWorkShift(actorId: string, raw: unknown) {
  const data = workShiftCreateSchema.parse(raw);
  const requestHash = sha256(JSON.stringify(data));
  return unitOfWork
    .withTransaction(async (session) => {
      await lockUser(actorId, session, true);
      const user = await lockUser(data.staffId, session);
      const existing = await WorkShiftModel.findOne({ requestId: data.requestId }).session(session);
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw new ConflictError('IDEMPOTENCY_CONFLICT', 'Mã yêu cầu đã dùng với dữ liệu khác.');
        return toWorkShift(existing);
      }
      const start = new Date(data.startsAt),
        end = new Date(data.endsAt);
      if (end <= new Date())
        throw new ValidationError(
          'Không tạo lịch ca đã kết thúc. Dùng điều chỉnh chấm công cho ca đã có.',
        );
      await assertScheduleFree(data.staffId, start, end, null, session);
      const [shift] = await WorkShiftModel.create(
        [{ ...data, staffName: user.name, requestHash }],
        {
          session,
        },
      );
      await audit(actorId, 'scheduled', shift!, null, session);
      return toWorkShift(shift!);
    })
    .catch(async (error: unknown) => {
      if ((error as { code?: number }).code === 11000) {
        const existing = await WorkShiftModel.findOne({ requestId: data.requestId });
        if (existing?.requestHash === requestHash) return toWorkShift(existing);
        throw new ConflictError(
          'IDEMPOTENCY_CONFLICT',
          'Mã yêu cầu vừa được dùng với dữ liệu khác.',
        );
      }
      throw error;
    });
}
export async function updateWorkShift(id: string, actorId: string, raw: unknown) {
  const data = workShiftUpdateSchema.parse(raw);
  return unitOfWork.withTransaction(async (session) => {
    await lockUser(actorId, session, true);
    const shift = await shiftById(id, session);
    await lockUser(String(shift.staffId), session);
    const user = await lockUser(data.staffId, session);
    if (
      shift.version === data.expectedVersion + 1 &&
      String(shift.staffId) === data.staffId &&
      shift.label === data.label &&
      shift.note === data.note &&
      shift.startsAt.getTime() === Date.parse(data.startsAt) &&
      shift.endsAt.getTime() === Date.parse(data.endsAt) &&
      shift.status === 'SCHEDULED'
    )
      return toWorkShift(shift);
    checkVersion(shift, data.expectedVersion);
    if (shift.status !== 'SCHEDULED')
      throw new ConflictError('WORK_SHIFT_LOCKED', 'Ca đã vào làm hoặc đã hủy không thể đổi lịch.');
    const start = new Date(data.startsAt),
      end = new Date(data.endsAt);
    if (end <= new Date()) throw new ValidationError('Lịch mới phải chưa kết thúc.');
    await assertScheduleFree(data.staffId, start, end, id, session);
    const before = toWorkShift(shift);
    shift.set({ ...data, staffName: user.name, version: shift.version + 1 });
    await shift.save({ session });
    await audit(actorId, 'rescheduled', shift, before, session);
    return toWorkShift(shift);
  });
}
export async function cancelWorkShift(id: string, actorId: string, raw: unknown) {
  const data = workShiftCancelSchema.parse(raw);
  return unitOfWork.withTransaction(async (session) => {
    await lockUser(actorId, session, true);
    const shift = await shiftById(id, session);
    // Lock even a disabled employee: cancelling their future schedule remains possible.
    await UserModel.updateOne({ _id: shift.staffId }, { $inc: { __v: 1 } }, { session });
    if (shift.status === 'CANCELLED' && shift.cancelReason === data.reason)
      return toWorkShift(shift);
    checkVersion(shift, data.expectedVersion);
    if (shift.status !== 'SCHEDULED')
      throw new ConflictError('WORK_SHIFT_LOCKED', 'Chỉ hủy được ca chưa vào làm.');
    const before = toWorkShift(shift);
    shift.status = 'CANCELLED';
    shift.cancelReason = data.reason;
    shift.version++;
    await shift.save({ session });
    await audit(actorId, 'cancelled', shift, before, session);
    return toWorkShift(shift);
  });
}
export async function clockWorkShift(
  id: string,
  actorId: string,
  direction: 'in' | 'out',
  raw: unknown,
) {
  const data = workClockSchema.parse(raw);
  return unitOfWork.withTransaction(async (session) => {
    await lockUser(actorId, session);
    const shift = await shiftById(id, session);
    if (String(shift.staffId) !== actorId)
      throw new ForbiddenError('Chỉ được chấm công ca của chính mình.');
    if ((direction === 'in' && shift.clockInAt) || (direction === 'out' && shift.clockOutAt))
      return toWorkShift(shift);
    checkVersion(shift, data.expectedVersion);
    const now = new Date(),
      before = toWorkShift(shift, now);
    if (direction === 'in') {
      if (shift.status !== 'SCHEDULED')
        throw new ConflictError('WORK_SHIFT_LOCKED', 'Ca không còn chờ vào làm.');
      if (now.getTime() < shift.startsAt.getTime() - 30 * 60000 || now >= shift.endsAt)
        throw new ConflictError(
          'CLOCK_WINDOW',
          'Được vào ca từ 30 phút trước giờ bắt đầu đến trước giờ kết thúc.',
        );
      await assertAttendanceFree(actorId, now, null, id, session);
      shift.clockInAt = now;
      shift.effectiveInAt = now;
      shift.status = 'WORKING';
    } else {
      if (shift.status !== 'WORKING')
        throw new ConflictError('WORK_SHIFT_LOCKED', 'Ca chưa vào hoặc đã được quản lý chốt giờ.');
      if (shift.effectiveInAt && now.getTime() - shift.effectiveInAt.getTime() > 24 * HOUR)
        throw new ConflictError(
          'ATTENDANCE_CORRECTION_REQUIRED',
          'Ca mở quá 24 giờ. Nhờ quản lý điều chỉnh giờ thực tế trước khi chấm ca mới.',
        );
      shift.clockOutAt = now;
      shift.effectiveOutAt = now;
      shift.status = 'COMPLETED';
    }
    shift.version++;
    await shift.save({ session });
    await audit(actorId, direction === 'in' ? 'clockedIn' : 'clockedOut', shift, before, session);
    return toWorkShift(shift, now);
  });
}
export async function correctWorkAttendance(id: string, actorId: string, raw: unknown) {
  const data = workAttendanceCorrectionSchema.parse(raw);
  return unitOfWork.withTransaction(async (session) => {
    const admin = await lockUser(actorId, session, true);
    const shift = await shiftById(id, session);
    await UserModel.updateOne({ _id: shift.staffId }, { $inc: { __v: 1 } }, { session });
    if (
      shift.version === data.expectedVersion + 1 &&
      shift.effectiveInAt?.getTime() === Date.parse(data.startsAt) &&
      shift.effectiveOutAt?.getTime() === Date.parse(data.endsAt) &&
      shift.correctionReason === data.reason &&
      shift.correctedByName === admin.name
    )
      return toWorkShift(shift);
    checkVersion(shift, data.expectedVersion);
    if (shift.status === 'CANCELLED')
      throw new ConflictError('WORK_SHIFT_LOCKED', 'Không điều chỉnh ca đã hủy.');
    const start = new Date(data.startsAt),
      end = new Date(data.endsAt);
    if (
      end > new Date() ||
      start.getTime() < shift.startsAt.getTime() - 12 * HOUR ||
      end.getTime() > shift.endsAt.getTime() + 12 * HOUR
    )
      throw new ValidationError(
        'Giờ thực tế không được ở tương lai và phải nằm trong 12 giờ quanh lịch ca.',
      );
    await assertAttendanceFree(String(shift.staffId), start, end, id, session);
    const before = toWorkShift(shift);
    shift.set({
      effectiveInAt: start,
      effectiveOutAt: end,
      status: 'COMPLETED',
      correctionReason: data.reason,
      correctedByName: admin.name,
      version: shift.version + 1,
    });
    await shift.save({ session });
    await audit(actorId, 'attendanceCorrected', shift, before, session);
    return toWorkShift(shift);
  });
}

export async function saveStaffingPolicy(actorId: string, raw: unknown) {
  const data = staffingPolicySchema.parse(raw);
  for (let i = 0; i < data.rules.length; i++)
    for (const other of data.rules.slice(i + 1)) {
      const rule = data.rules[i]!;
      if (
        rule.day === other.day &&
        rule.startMinute < other.endMinute &&
        rule.endMinute > other.startMinute
      )
        throw new ValidationError(
          'Các khung yêu cầu nhân sự trong cùng ngày không được chồng lấn.',
        );
    }
  return unitOfWork
    .withTransaction(async (session) => {
      await lockUser(actorId, session, true);
      const existing = await StaffingPolicyModel.findById('default').session(session);
      if (
        existing?.version === data.expectedVersion + 1 &&
        JSON.stringify(
          existing.rules.map((r) => ({
            day: r.day,
            startMinute: r.startMinute,
            endMinute: r.endMinute,
            minStaff: r.minStaff,
            label: r.label,
          })),
        ) === JSON.stringify(data.rules) &&
        (existing.ordersPerStaffHour ?? 6) === data.ordersPerStaffHour
      )
        return {
          version: existing.version,
          rules: data.rules,
          ordersPerStaffHour: data.ordersPerStaffHour,
        };
      if ((existing?.version ?? 0) !== data.expectedVersion)
        throw new ConflictError('POLICY_CHANGED', 'Cấu hình đã thay đổi. Hãy tải lại.');
      const before = existing?.toObject() ?? { version: 0, rules: [] };
      const policy = existing ?? new StaffingPolicyModel({ _id: 'default' });
      policy.set({
        rules: data.rules,
        ordersPerStaffHour: data.ordersPerStaffHour,
        version: data.expectedVersion + 1,
      });
      await policy.save({ session });
      await auditRepository.log(
        {
          actorType: 'USER',
          actorId,
          action: 'workforce.staffingPolicyChanged',
          entityType: 'StaffingPolicy',
          metadata: { before, after: policy.toObject() },
        },
        session,
      );
      await queueWorkforceChanged(session);
      return {
        version: policy.version,
        rules: data.rules,
        ordersPerStaffHour: data.ordersPerStaffHour,
      };
    })
    .catch((error: unknown) => {
      if ((error as { code?: number }).code === 11000)
        throw new ConflictError(
          'POLICY_CHANGED',
          'Cấu hình vừa được quản lý khác tạo. Hãy tải lại.',
        );
      throw error;
    });
}

/** Called inside the order transaction; no attendance requirement is added to existing KDS flows. */
export async function recordWorkActivity(
  orderId: string,
  stage: string,
  actorId: string,
  session: ClientSession,
) {
  if (!['CONFIRMED', 'PREPARING', 'READY', 'SERVED'].includes(stage)) return;
  const at = new Date();
  const user = await UserModel.findById(actorId).session(session);
  const shift = await WorkShiftModel.findOneAndUpdate(
    { staffId: actorId, status: 'WORKING', effectiveInAt: { $lte: at } },
    { $inc: { activityVersion: 1 } },
    { new: true, session },
  );
  const preparation =
    stage === 'READY'
      ? await WorkActivityModel.findOne({ orderId, stage: 'PREPARING' }).session(session)
      : null;
  await WorkActivityModel.create(
    [
      {
        orderId,
        stage,
        staffId: actorId,
        staffName: user?.name ?? 'Nhân viên',
        at,
        workShiftId: shift?._id ?? null,
        preparationStaffId: preparation?.staffId ?? null,
        preparationStaffName: preparation?.staffName ?? '',
        preparationShiftId: preparation?.workShiftId ?? null,
        preparationMs: preparation ? Math.max(0, at.getTime() - preparation.at.getTime()) : null,
      },
    ],
    { session },
  );
}

export async function workforceWeek(
  actorId: string,
  admin: boolean,
  raw: unknown,
): Promise<WorkforceWeek> {
  const { from } = workWeekQuerySchema.parse(raw);
  const start = new Date(`${from}T00:00:00+07:00`),
    end = new Date(start.getTime() + 7 * 24 * HOUR),
    now = new Date();
  const own = admin ? {} : { staffId: new Types.ObjectId(actorId) };
  const shifts = await WorkShiftModel.find({
    ...own,
    startsAt: { $lt: end },
    endsAt: { $gt: start },
  }).sort({ startsAt: 1, staffId: 1 });
  const current = await WorkShiftModel.findOne({ staffId: actorId, status: 'WORKING' });
  const users = admin
    ? await UserModel.find({ isDeleted: { $ne: true } })
        .select('name isActive')
        .sort({ name: 1 })
        .lean()
    : [];
  const policy = admin ? await StaffingPolicyModel.findById('default').lean() : null;
  const rules = (policy?.rules ?? []).map((r) => ({
    day: r.day!,
    startMinute: r.startMinute!,
    endMinute: r.endMinute!,
    minStaff: r.minStaff!,
    label: r.label!,
  }));
  const coverage: WorkforceWeek['coverage'] = [];
  if (admin)
    for (let d = 0; d < 7; d++) {
      const dayStart = new Date(start.getTime() + d * 24 * HOUR);
      const weekday = new Date(dayStart.getTime() + 7 * HOUR).getUTCDay() || 7;
      for (const rule of rules.filter((r) => r.day === weekday)) {
        const a = dayStart.getTime() + rule.startMinute * 60000,
          b = dayStart.getTime() + rule.endMinute * 60000;
        const active = shifts.filter(
          (s) =>
            s.status !== 'CANCELLED' &&
            s.startsAt.getTime() < b &&
            s.endsAt.getTime() > a &&
            users.some((u) => String(u._id) === String(s.staffId) && u.isActive),
        );
        const boundaries = [
          ...new Set([
            a,
            ...active
              .flatMap((s) => [s.startsAt.getTime(), s.endsAt.getTime()])
              .filter((t) => t > a && t < b),
          ]),
        ];
        const scheduled = Math.min(
          ...boundaries.map(
            (t) =>
              new Set(
                active
                  .filter((s) => s.startsAt.getTime() <= t && s.endsAt.getTime() > t)
                  .map((s) => String(s.staffId)),
              ).size,
          ),
        );
        const presentNow =
          now.getTime() >= a && now.getTime() < b
            ? await WorkShiftModel.countDocuments({
                status: 'WORKING',
                staffId: { $in: users.filter((u) => u.isActive).map((u) => u._id) },
                effectiveInAt: { $lte: now },
              })
            : null;
        coverage.push({
          label: rule.label,
          startsAt: new Date(a).toISOString(),
          endsAt: new Date(b).toISOString(),
          required: rule.minStaff,
          scheduled,
          shortage: Math.max(0, rule.minStaff - scheduled),
          presentNow,
        });
      }
    }
  const metrics = await workforceMetrics(start, end, admin ? null : actorId, now);
  const shiftMetrics = await metricsByShift(shifts.map((s) => s._id));
  const [peaks, cash] = admin
    ? await Promise.all([
        workforcePeaks(start, now, policy?.ordersPerStaffHour ?? 6),
        workforceCash(start, end),
      ])
    : [null, null];
  return {
    from,
    until: end.toISOString(),
    now: now.toISOString(),
    shifts: shifts.map((s) => toWorkShift(s, now)),
    currentShift: current ? toWorkShift(current, now) : null,
    staff: users.map((u) => ({ id: String(u._id), name: u.name, isActive: u.isActive })),
    policy: {
      version: policy?.version ?? 0,
      rules,
      ordersPerStaffHour: policy?.ordersPerStaffHour ?? 6,
    },
    peaks,
    cash,
    coverage,
    metrics,
    shiftMetrics,
  };
}

export {
  lockUser as lockWorkforceUser,
  assertScheduleFree as assertWorkScheduleFree,
  audit as logWorkShiftAudit,
};

async function metricsByShift(ids: Types.ObjectId[]): Promise<WorkforceWeek['shiftMetrics']> {
  const [result] = await WorkActivityModel.aggregate<{
    counts: Array<{ _id: { shift: Types.ObjectId; stage: string }; count: number }>;
    preparation: Array<{ _id: Types.ObjectId; count: number; avg: number }>;
    reviews: Array<{ _id: Types.ObjectId; count: number; avg: number }>;
  }>([
    { $match: { $or: [{ workShiftId: { $in: ids } }, { preparationShiftId: { $in: ids } }] } },
    {
      $facet: {
        counts: [
          { $match: { workShiftId: { $in: ids } } },
          { $group: { _id: { shift: '$workShiftId', stage: '$stage' }, count: { $sum: 1 } } },
        ],
        preparation: [
          { $match: { stage: 'READY', preparationShiftId: { $in: ids } } },
          {
            $group: {
              _id: '$preparationShiftId',
              count: { $sum: 1 },
              avg: { $avg: '$preparationMs' },
            },
          },
        ],
        reviews: [
          { $match: { stage: 'SERVED', workShiftId: { $in: ids } } },
          {
            $lookup: {
              from: 'reviews',
              localField: 'orderId',
              foreignField: 'orderId',
              as: 'review',
            },
          },
          { $unwind: '$review' },
          { $group: { _id: '$workShiftId', count: { $sum: 1 }, avg: { $avg: '$review.rating' } } },
        ],
      },
    },
  ]);
  return ids.map((id) => {
    const row: WorkforceWeek['shiftMetrics'][number] = {
      workShiftId: String(id),
      confirmed: 0,
      preparing: 0,
      ready: 0,
      served: 0,
      preparationSamples: 0,
      averagePreparationMinutes: null,
      reviewedOrders: 0,
      averageOrderRating: null,
    };
    for (const c of result?.counts ?? [])
      if (String(c._id.shift) === String(id))
        row[c._id.stage.toLowerCase() as 'confirmed' | 'preparing' | 'ready' | 'served'] = c.count;
    const p = result?.preparation.find((r) => String(r._id) === String(id));
    if (p) {
      row.preparationSamples = p.count;
      row.averagePreparationMinutes = Math.round(p.avg / 6000) / 10;
    }
    const r = result?.reviews.find((r) => String(r._id) === String(id));
    if (r) {
      row.reviewedOrders = r.count;
      row.averageOrderRating = Math.round(r.avg * 100) / 100;
    }
    return row;
  });
}

async function workforceMetrics(start: Date, end: Date, staffId: string | null, now: Date) {
  const own = staffId ? { staffId: new Types.ObjectId(staffId) } : {};
  // Attendance is clipped to the selected week. Preparation samples belong to the READY timestamp.
  const attendance = await WorkShiftModel.find({
    ...own,
    status: { $ne: 'CANCELLED' },
    $or: [
      { startsAt: { $lt: end }, endsAt: { $gt: start } },
      {
        effectiveInAt: { $ne: null, $lt: end },
        $or: [{ effectiveOutAt: null }, { effectiveOutAt: { $gt: start } }],
      },
    ],
  });
  type Count = {
    _id: { staffId: Types.ObjectId; stage: string };
    name: string;
    count: number;
    outside: number;
  };
  const counts = await WorkActivityModel.aggregate<Count>([
    { $match: { at: { $gte: start, $lt: end }, ...own } },
    {
      $group: {
        _id: { staffId: '$staffId', stage: '$stage' },
        name: { $last: '$staffName' },
        count: { $sum: 1 },
        outside: { $sum: { $cond: [{ $eq: ['$workShiftId', null] }, 1, 0] } },
      },
    },
  ]);
  const preparation = await WorkActivityModel.aggregate<{
    _id: Types.ObjectId;
    name: string;
    count: number;
    avg: number;
  }>([
    {
      $match: {
        at: { $gte: start, $lt: end },
        stage: 'READY',
        preparationStaffId: staffId ? new Types.ObjectId(staffId) : { $ne: null },
      },
    },
    {
      $group: {
        _id: '$preparationStaffId',
        name: { $last: '$preparationStaffName' },
        count: { $sum: 1 },
        avg: { $avg: '$preparationMs' },
      },
    },
  ]);
  const reviews = await WorkActivityModel.aggregate<{
    _id: Types.ObjectId;
    name: string;
    count: number;
    avg: number;
  }>([
    { $match: { at: { $gte: start, $lt: end }, stage: 'SERVED', ...own } },
    { $lookup: { from: 'reviews', localField: 'orderId', foreignField: 'orderId', as: 'review' } },
    { $unwind: '$review' },
    {
      $group: {
        _id: '$staffId',
        name: { $last: '$staffName' },
        count: { $sum: 1 },
        avg: { $avg: '$review.rating' },
      },
    },
  ]);
  const rows = new Map<string, WorkforceWeek['metrics'][number]>();
  function row(id: string, name: string) {
    if (!rows.has(id))
      rows.set(id, {
        staffId: id,
        staffName: name,
        scheduledMinutes: 0,
        workedMinutes: 0,
        openAttendances: 0,
        absentShifts: 0,
        lateShifts: 0,
        confirmed: 0,
        preparing: 0,
        ready: 0,
        served: 0,
        outsideShiftActions: 0,
        preparationSamples: 0,
        averagePreparationMinutes: null,
        reviewedOrders: 0,
        averageOrderRating: null,
      });
    return rows.get(id)!;
  }
  for (const s of attendance) {
    const r = row(String(s.staffId), s.staffName);
    const scheduledHere = s.startsAt < end && s.endsAt > start;
    if (scheduledHere) {
      r.scheduledMinutes += minutes(
        new Date(Math.max(start.getTime(), s.startsAt.getTime())),
        new Date(Math.min(end.getTime(), s.endsAt.getTime())),
      );
      if (!s.effectiveInAt && s.endsAt <= now) r.absentShifts++;
      if (toWorkShift(s, now).lateMinutes > 0) r.lateShifts++;
    }
    if (s.effectiveInAt) {
      if (!s.effectiveOutAt) r.openAttendances++;
      else
        r.workedMinutes += minutes(
          new Date(Math.max(start.getTime(), s.effectiveInAt.getTime())),
          new Date(Math.min(end.getTime(), s.effectiveOutAt.getTime())),
        );
    }
  }
  for (const c of counts) {
    const r = row(String(c._id.staffId), c.name);
    const stage = c._id.stage.toLowerCase() as 'confirmed' | 'preparing' | 'ready' | 'served';
    r[stage] = c.count;
    r.outsideShiftActions += c.outside;
  }
  for (const p of preparation) {
    const r = row(String(p._id), p.name);
    r.preparationSamples = p.count;
    r.averagePreparationMinutes = Math.round(p.avg / 6000) / 10;
  }
  for (const v of reviews) {
    const r = row(String(v._id), v.name);
    r.reviewedOrders = v.count;
    r.averageOrderRating = Math.round(v.avg * 100) / 100;
  }
  return [...rows.values()].sort((a, b) => a.staffName.localeCompare(b.staffName, 'vi'));
}
