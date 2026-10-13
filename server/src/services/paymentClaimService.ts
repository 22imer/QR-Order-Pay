import type { ClientSession } from 'mongoose';
import { TableSessionModel } from '../models/TableSession.js';
import { UserModel } from '../models/User.js';
import { ConflictError } from '../errors/AppError.js';
import { sha256 } from '../utils/crypto.js';
import { CashShiftModel } from '../models/CashShift.js';
import { unitOfWork } from '../infrastructure/unitOfWork.js';

export const PAYMENT_CLAIM_MS = 120_000;

export async function paymentClaims(ids: string[]) {
  const sessions = await TableSessionModel.find({ _id: { $in: ids } });
  return new Map(
    sessions.map((s) => [
      s.id,
      s.collectionExpiresAt && s.collectionExpiresAt.getTime() > Date.now()
        ? {
            ownerId: String(s.collectionOwner),
            ownerName: s.collectionOwnerName,
            expiresAt: s.collectionExpiresAt.toISOString(),
          }
        : null,
    ]),
  );
}

export async function claimPayment(id: string, actorId: string, token: string) {
  return unitOfWork.withTransaction(async (session) => {
    const user = await UserModel.findById(actorId).session(session);
    const now = new Date();
    const claimed = await TableSessionModel.findOneAndUpdate(
      {
        _id: id,
        status: { $in: ['OPEN', 'CHECKOUT'] },
        $or: [
          { collectionExpiresAt: null },
          { collectionExpiresAt: { $lte: now } },
          { collectionOwner: actorId, collectionTokenHash: sha256(token) },
        ],
      },
      {
        $set: {
          collectionOwner: actorId,
          collectionOwnerName: user?.name ?? 'Nhân viên',
          collectionTokenHash: sha256(token),
          collectionExpiresAt: new Date(now.getTime() + PAYMENT_CLAIM_MS),
        },
        $inc: { version: 1 },
      },
      { new: true, session },
    );
    if (!claimed)
      throw new ConflictError(
        'PAYMENT_CLAIMED',
        'Bàn đang được nhân viên khác thu tiền hoặc đã đóng. Vui lòng tải lại.',
      );
    await CashShiftModel.updateOne({ status: 'OPEN' }, { $inc: { version: 1 } }, { session });
    return { expiresAt: claimed.collectionExpiresAt, version: claimed.version };
  });
}

export async function guardUnpaidCancellation(id: string, session: ClientSession) {
  const active = await TableSessionModel.findOneAndUpdate(
    {
      _id: id,
      status: { $ne: 'CLOSED' },
      $or: [{ collectionExpiresAt: null }, { collectionExpiresAt: { $lte: new Date() } }],
    },
    { $inc: { version: 1 } },
    { new: true, session },
  );
  if (!active)
    throw new ConflictError(
      'PAYMENT_CLAIMED',
      'Bàn đang được thu tiền hoặc đã đóng, chưa thể hủy đơn.',
    );
}

export async function releasePaymentClaim(id: string, actorId: string, token: string) {
  await TableSessionModel.updateOne(
    { _id: id, collectionOwner: actorId, collectionTokenHash: sha256(token) },
    {
      $set: {
        collectionOwner: null,
        collectionOwnerName: '',
        collectionTokenHash: '',
        collectionExpiresAt: null,
      },
      $inc: { version: 1 },
    },
  );
}

// A committed receipt releases the claim even if the browser navigates away before its cleanup request.
export async function clearCommittedPaymentClaim(id: string, session: ClientSession) {
  await TableSessionModel.updateOne(
    { _id: id },
    {
      $set: {
        collectionOwner: null,
        collectionOwnerName: '',
        collectionTokenHash: '',
        collectionExpiresAt: null,
      },
    },
    { session },
  );
}

// The write guard serializes collection, close, correction and claim takeover.
export async function guardPaymentClaim(
  id: string,
  actorId: string,
  token: string | undefined,
  session: ClientSession,
) {
  if (!token)
    throw new ConflictError('PAYMENT_CLAIM_REQUIRED', 'Hãy nhận quyền thu tiền cho bàn trước.');
  const active = await TableSessionModel.findOneAndUpdate(
    {
      _id: id,
      status: { $in: ['OPEN', 'CHECKOUT'] },
      collectionOwner: actorId,
      collectionTokenHash: sha256(token),
      collectionExpiresAt: { $gt: new Date() },
    },
    { $inc: { version: 1 } },
    { new: true, session },
  );
  if (!active)
    throw new ConflictError(
      'PAYMENT_CLAIM_EXPIRED',
      'Quyền thu tiền đã hết hạn hoặc bàn đã thay đổi. Hãy kiểm tra lại trước khi nhận tiền.',
    );
  return active;
}
