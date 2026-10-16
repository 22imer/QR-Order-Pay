import type { ClientSession } from 'mongoose';
import { ConflictError, NotFoundError, ValidationError } from '../errors/AppError.js';
import { unitOfWork } from '../infrastructure/unitOfWork.js';
import { CashShiftModel, type CashShiftDoc } from '../models/CashShift.js';
import { PaymentModel } from '../models/Payment.js';
import { TableSessionModel } from '../models/TableSession.js';
import { UserModel } from '../models/User.js';
import { auditRepository } from '../repositories/auditRepository.js';
import { randomShortCode } from '../utils/crypto.js';
interface RawShift extends Record<string, unknown> {
  _id: unknown;
  code: string;
  status: 'OPEN' | 'CLOSED';
  openedBy: unknown;
  openedByName: string;
  openedAt: Date;
  openingCash: number;
  closedBy?: unknown;
  closedByName?: string;
  closedAt?: Date | null;
  countedCash?: number | null;
  expectedCash?: number | null;
  difference?: number | null;
  reconciliationNote?: string;
  version: number;
}

export async function ensureOpenShift(
  actorId: string,
  session: ClientSession,
): Promise<CashShiftDoc> {
  // A write guard on the shift serializes payment assignment with shift closing.
  const existing = await CashShiftModel.findOneAndUpdate(
    { status: 'OPEN' },
    { $inc: { version: 1 } },
    { new: true, session },
  );
  if (existing) return existing;
  const user = await UserModel.findById(actorId).session(session);
  try {
    const [created] = await CashShiftModel.create(
      [
        {
          code: shiftCode(),
          openedBy: actorId,
          openedByName: user?.name ?? 'Nhân viên',
          openingCash: 0,
        },
      ],
      { session },
    );
    if (!created) throw new Error('Failed to open shift');
    await auditRepository.log(
      {
        actorType: 'USER',
        actorId,
        action: 'cashShift.autoOpened',
        entityType: 'CashShift',
        entityId: created.id,
        metadata: { openingCash: 0, reason: 'FIRST_PAYMENT_WITHOUT_OPEN_SHIFT' },
      },
      session,
    );
    return created;
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      const raced = await CashShiftModel.findOne({ status: 'OPEN' }).session(session);
      if (raced) return raced;
    }
    throw error;
  }
}

export async function openShift(actorId: string, openingCash: number) {
  return unitOfWork.withTransaction(async (session) => {
    if (await CashShiftModel.findOne({ status: 'OPEN' }).session(session))
      throw new ConflictError('SHIFT_ALREADY_OPEN', 'Đang có một ca thu ngân mở.');
    const user = await UserModel.findById(actorId).session(session);
    const [shift] = await CashShiftModel.create(
      [
        {
          code: shiftCode(),
          openedBy: actorId,
          openedByName: user?.name ?? 'Nhân viên',
          openingCash,
        },
      ],
      { session },
    );
    if (!shift) throw new Error('Failed to open shift');
    await auditRepository.log(
      {
        actorType: 'USER',
        actorId,
        action: 'cashShift.opened',
        entityType: 'CashShift',
        entityId: shift.id,
        metadata: { openingCash },
      },
      session,
    );
    return shift;
  });
}

export async function currentShift() {
  const shift = await CashShiftModel.findOne({ status: 'OPEN' }).lean();
  if (!shift) return null;
  return shiftSummary(shift as unknown as RawShift);
}

export async function closeShift(
  id: string,
  actorId: string,
  expectedVersion: number,
  countedCash: number,
  note?: string,
) {
  return unitOfWork.withTransaction(async (session) => {
    const shift = await CashShiftModel.findById(id).session(session);
    if (!shift) throw new NotFoundError('Không tìm thấy ca.');
    if (shift.status !== 'OPEN' || shift.version !== expectedVersion)
      throw new ConflictError('CONFLICT', 'Ca đã được người khác chốt.');
    if (
      await TableSessionModel.exists({
        status: { $in: ['OPEN', 'CHECKOUT'] },
        collectionExpiresAt: { $gt: new Date() },
      }).session(session)
    )
      throw new ConflictError(
        'PAYMENT_CLAIMED',
        'Còn bàn đang được thu tiền. Hãy kết thúc thu tiền trước khi chốt ca.',
      );
    const [cash] = await PaymentModel.aggregate<{ total: number }>([
      { $match: { shiftId: shift._id, status: { $in: ['SUCCESS', 'REFUNDED'] }, method: 'CASH' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]).session(session);
    const [refunded] = await PaymentModel.aggregate<{ total: number }>([
      { $match: { refundShiftId: shift._id, status: 'REFUNDED', refundMethod: 'CASH' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]).session(session);
    const expectedCash = shift.openingCash + (cash?.total ?? 0) - (refunded?.total ?? 0);
    if (countedCash !== expectedCash && (!note || note.trim().length < 3))
      throw new ValidationError('Phải nhập lý do chênh lệch tiền khi chốt ca (ít nhất 3 ký tự).');
    const user = await UserModel.findById(actorId).session(session);
    const closed = await CashShiftModel.findOneAndUpdate(
      { _id: id, status: 'OPEN', version: expectedVersion },
      {
        $set: {
          status: 'CLOSED',
          closedBy: actorId,
          closedByName: user?.name ?? 'Nhân viên',
          closedAt: new Date(),
          countedCash,
          expectedCash,
          difference: countedCash - expectedCash,
          reconciliationNote: note ?? '',
        },
        $inc: { version: 1 },
      },
      { new: true, session },
    );
    if (!closed) throw new ConflictError('CONFLICT', 'Ca vừa được chốt.');
    await auditRepository.log(
      {
        actorType: 'USER',
        actorId,
        action: 'cashShift.closed',
        entityType: 'CashShift',
        entityId: id,
        metadata: { countedCash, expectedCash, difference: countedCash - expectedCash, note },
      },
      session,
    );
    return shiftSummary(closed.toObject() as unknown as RawShift);
  });
}

export async function listShifts(page = 1, limit = 20) {
  const [items, total] = await Promise.all([
    CashShiftModel.find()
      .sort({ openedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    CashShiftModel.countDocuments(),
  ]);
  return {
    items: await Promise.all(items.map((item) => shiftSummary(item as unknown as RawShift))),
    page,
    limit,
    total,
  };
}

async function shiftSummary(shift: RawShift) {
  const [byMethod, unpaidSessions, refunds, reversals] = await Promise.all([
    PaymentModel.aggregate<{ _id: string; total: number; count: number }>([
      { $match: { shiftId: shift._id, status: { $in: ['SUCCESS', 'REFUNDED'] } } },
      { $group: { _id: '$method', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    TableSessionModel.aggregate<{
      id: string;
      tableCode: string;
      tableName: string;
      status: string;
      startedAt: Date;
      unpaidTotal: number;
    }>([
      { $match: { status: { $in: ['OPEN', 'CHECKOUT'] } } },
      {
        $lookup: {
          from: 'tables',
          localField: 'tableId',
          foreignField: '_id',
          as: 'table',
        },
      },
      {
        $lookup: {
          from: 'orders',
          let: { sessionId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$tableSessionId', '$$sessionId'] },
                paymentStatus: 'UNPAID',
                status: { $ne: 'CANCELLED' },
              },
            },
          ],
          as: 'unpaidOrders',
        },
      },
      {
        $project: {
          _id: 0,
          id: { $toString: '$_id' },
          tableCode: { $ifNull: [{ $first: '$table.code' }, ''] },
          tableName: { $ifNull: [{ $first: '$table.name' }, 'Bàn'] },
          status: 1,
          startedAt: 1,
          unpaidTotal: {
            $sum: {
              $map: {
                input: '$unpaidOrders',
                as: 'order',
                in: { $subtract: ['$$order.total', { $ifNull: ['$$order.paidAmount', 0] }] },
              },
            },
          },
        },
      },
      { $sort: { startedAt: 1 } },
    ]),
    PaymentModel.aggregate<{ _id: string; total: number; count: number }>([
      { $match: { refundShiftId: shift._id, status: 'REFUNDED', reversalKind: null } },
      { $group: { _id: '$refundMethod', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    PaymentModel.aggregate<{ _id: string; total: number; count: number }>([
      {
        $match: {
          refundShiftId: shift._id,
          status: 'REFUNDED',
          reversalKind: { $in: ['VOID', 'METHOD', 'TRANSFER'] },
        },
      },
      { $group: { _id: '$refundMethod', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
  ]);
  return {
    id: String(shift._id),
    code: shift.code,
    status: shift.status,
    openedBy: String(shift.openedBy),
    openedByName: shift.openedByName,
    openedAt: shift.openedAt,
    openingCash: shift.openingCash,
    closedBy: shift.closedBy ? String(shift.closedBy) : null,
    closedByName: shift.closedByName || null,
    closedAt: shift.closedAt ?? null,
    countedCash: shift.countedCash ?? null,
    expectedCash: shift.expectedCash ?? null,
    difference: shift.difference ?? null,
    reconciliationNote: shift.reconciliationNote ?? '',
    version: shift.version,
    paymentsByMethod: Object.fromEntries(
      byMethod.map((row) => [row._id, { total: row.total, count: row.count }]),
    ),
    refundsByMethod: Object.fromEntries(
      refunds.map((row) => [row._id, { total: row.total, count: row.count }]),
    ),
    reversalsByMethod: Object.fromEntries(
      reversals.map((row) => [row._id, { total: row.total, count: row.count }]),
    ),
    openSessions: unpaidSessions.length,
    unpaidSessions,
  };
}
function shiftCode(): string {
  return `CA${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomShortCode(4)}`;
}
