import { randomUUID } from 'node:crypto';
import type { ClientSession } from 'mongoose';
import {
  workCopyPreviewSchema,
  workCopyConfirmSchema,
  type WorkCopyPreview,
} from '@may-cafe/contracts';
import { UserModel } from '../models/User.js';
import { WorkShiftModel, WorkScheduleCopyModel } from '../models/WorkShift.js';
import { unitOfWork } from '../infrastructure/unitOfWork.js';
import { sha256 } from '../utils/crypto.js';
import { queueWorkforceChanged } from './workforceRealtimeService.js';
import { ConflictError, ForbiddenError, ValidationError } from '../errors/AppError.js';
import {
  lockWorkforceUser,
  assertWorkScheduleFree,
  logWorkShiftAudit,
} from './workforceService.js';

async function plan(
  from: string,
  targetFrom: string,
  session?: ClientSession,
): Promise<WorkCopyPreview> {
  const start = new Date(`${from}T00:00:00+07:00`),
    end = new Date(start.getTime() + 7 * 86400000);
  const offset = Date.parse(`${targetFrom}T00:00:00+07:00`) - start.getTime();
  const source = await WorkShiftModel.find({
    startsAt: { $gte: start, $lt: end },
    status: { $ne: 'CANCELLED' },
  })
    .sort({ _id: 1 })
    .session(session ?? null);
  if (!source.length) throw new ValidationError('Tuần nguồn không có ca bắt đầu để sao chép.');
  if (source.length > 200) throw new ValidationError('Tối đa 200 ca trong một lần sao chép.');
  const users = await UserModel.find({ _id: { $in: source.map((s) => s.staffId) } }).session(
    session ?? null,
  );
  const shifts = source.map((s) => ({
    sourceId: s.id,
    staffId: String(s.staffId),
    staffName: users.find((u) => String(u._id) === String(s.staffId))?.name ?? s.staffName,
    label: s.label,
    startsAt: new Date(s.startsAt.getTime() + offset).toISOString(),
    endsAt: new Date(s.endsAt.getTime() + offset).toISOString(),
    note: s.note,
  }));
  const targets = await WorkShiftModel.find({
    staffId: { $in: source.map((s) => s.staffId) },
    status: { $ne: 'CANCELLED' },
    startsAt: { $lt: new Date(Math.max(...shifts.map((s) => Date.parse(s.endsAt)))) },
    endsAt: { $gt: new Date(Math.min(...shifts.map((s) => Date.parse(s.startsAt)))) },
  }).session(session ?? null);
  const conflicts: WorkCopyPreview['conflicts'] = [];
  for (const s of shifts) {
    const user = users.find((u) => String(u._id) === s.staffId);
    const reason =
      !user || !user.isActive || user.isDeleted
        ? 'Tài khoản đã khóa/xóa'
        : Date.parse(s.startsAt) <= Date.now()
          ? 'Ca đích phải bắt đầu trong tương lai'
          : targets.some(
                (t) =>
                  String(t.staffId) === s.staffId &&
                  t.startsAt.getTime() < Date.parse(s.endsAt) &&
                  t.endsAt.getTime() > Date.parse(s.startsAt),
              )
            ? 'Trùng lịch ca đã có'
            : shifts.some(
                  (t) =>
                    t.sourceId !== s.sourceId &&
                    t.staffId === s.staffId &&
                    t.startsAt < s.endsAt &&
                    t.endsAt > s.startsAt,
                )
              ? 'Các ca nguồn chồng nhau'
              : '';
    if (reason) conflicts.push({ staffName: s.staffName, label: s.label, reason });
  }
  const snapshot = sha256(
    JSON.stringify({ from, targetFrom, shifts, versions: source.map((s) => s.version) }),
  );
  return { from, targetFrom, snapshot, shifts, conflicts };
}
export async function previewWorkSchedule(actorId: string, raw: unknown) {
  const data = workCopyPreviewSchema.parse(raw);
  if (
    !(await UserModel.exists({
      _id: actorId,
      role: 'ADMIN',
      isActive: true,
      isDeleted: { $ne: true },
    }))
  )
    throw new ForbiddenError();
  return plan(data.from, data.targetFrom);
}
export async function copyWorkSchedule(actorId: string, raw: unknown) {
  const data = workCopyConfirmSchema.parse(raw),
    requestHash = sha256(JSON.stringify(data));
  return unitOfWork
    .withTransaction(async (session) => {
      await lockWorkforceUser(actorId, session, true);
      const replay = await WorkScheduleCopyModel.findById(data.requestId).session(session);
      if (replay) {
        if (replay.requestHash !== requestHash)
          throw new ConflictError(
            'IDEMPOTENCY_CONFLICT',
            'Mã yêu cầu sao chép đã dùng với dữ liệu khác.',
          );
        return {
          count: replay.shiftIds.length,
          ids: replay.shiftIds.map(String),
          targetFrom: data.targetFrom,
        };
      }
      const current = await plan(data.from, data.targetFrom, session);
      if (current.snapshot !== data.snapshot)
        throw new ConflictError('COPY_CHANGED', 'Lịch nguồn đã đổi. Hãy xem trước lại.');
      if (current.conflicts.length)
        throw new ConflictError(
          'COPY_CONFLICT',
          'Tuần đích có xung đột. Chưa tạo ca nào.',
          current.conflicts,
        );
      for (const id of [...new Set(current.shifts.map((s) => s.staffId))].sort())
        await lockWorkforceUser(id, session);
      const ids: string[] = [];
      for (const s of current.shifts) {
        await assertWorkScheduleFree(
          s.staffId,
          new Date(s.startsAt),
          new Date(s.endsAt),
          null,
          session,
        );
        const requestId = randomUUID();
        const [created] = await WorkShiftModel.create(
          [
            {
              staffId: s.staffId,
              staffName: s.staffName,
              label: s.label,
              startsAt: s.startsAt,
              endsAt: s.endsAt,
              note: s.note,
              requestId,
              requestHash: sha256(JSON.stringify(s)),
            },
          ],
          { session },
        );
        await logWorkShiftAudit(
          actorId,
          'copied',
          created!,
          { sourceId: s.sourceId, batchId: data.requestId },
          session,
          false,
        );
        ids.push(created!.id);
      }
      await WorkScheduleCopyModel.create(
        [{ _id: data.requestId, requestHash, createdBy: actorId, shiftIds: ids }],
        { session },
      );
      await queueWorkforceChanged(session);
      return { count: ids.length, ids, targetFrom: data.targetFrom };
    })
    .catch(async (error: unknown) => {
      if ((error as { code?: number }).code === 11000) {
        const replay = await WorkScheduleCopyModel.findById(data.requestId);
        if (replay?.requestHash === requestHash)
          return {
            count: replay.shiftIds.length,
            ids: replay.shiftIds.map(String),
            targetFrom: data.targetFrom,
          };
        throw new ConflictError('IDEMPOTENCY_CONFLICT', 'Yêu cầu sao chép bị trùng. Hãy tải lại.');
      }
      throw error;
    });
}
