import type { ClientSession } from 'mongoose';
import {
  memberRegisterSchema,
  memberLoginSchema,
  memberChangePasswordSchema,
  memberAdminUpdateSchema,
  memberDtoSchema,
  pointEntrySchema,
} from '@may-cafe/contracts';
import {
  MemberModel,
  MemberSessionModel,
  PointEntryModel,
  type MemberDoc,
} from '../models/Member.js';
import { hashPassword, verifyPassword, randomToken, sha256 } from '../utils/crypto.js';
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  RateLimitError,
} from '../errors/AppError.js';
import { unitOfWork } from '../infrastructure/unitOfWork.js';
import { auditRepository } from '../repositories/auditRepository.js';

export const MEMBER_COOKIE = 'mc_member';
export const MEMBER_TTL_MS = 14 * 86400000;
export function memberDto(m: MemberDoc) {
  return memberDtoSchema.parse({
    id: m.id,
    name: m.name,
    phone: m.phone,
    points: m.points,
    isActive: m.isActive,
    version: m.version,
    createdAt: m.createdAt.toISOString(),
  });
}
export async function resolveMember(token: unknown, session?: ClientSession | null) {
  if (typeof token !== 'string' || token.length > 128) return null;
  const login = await MemberSessionModel.findOne({
    tokenHash: sha256(token),
    expiresAt: { $gt: new Date() },
  }).session(session ?? null);
  if (!login) return null;
  return MemberModel.findOne({
    _id: login.memberId,
    isActive: true,
    authVersion: login.authVersion,
  }).session(session ?? null);
}
async function newSession(member: MemberDoc, session: ClientSession) {
  const token = randomToken();
  await MemberSessionModel.create(
    [
      {
        memberId: member._id,
        tokenHash: sha256(token),
        authVersion: member.authVersion,
        expiresAt: new Date(Date.now() + MEMBER_TTL_MS),
      },
    ],
    { session },
  );
  return { member: memberDto(member), token };
}
export async function registerMember(body: unknown) {
  const input = memberRegisterSchema.parse(body);
  const passwordHash = await hashPassword(input.password);
  try {
    return await unitOfWork.withTransaction(async (session) => {
      const [member] = await MemberModel.create(
        [{ name: input.name, phone: input.phone, passwordHash }],
        { session },
      );
      if (!member) throw new Error('Failed to create member');
      return newSession(member, session);
    });
  } catch (e) {
    if ((e as { code?: number }).code === 11000)
      throw new ConflictError('MEMBER_EXISTS', 'SĐT đã được đăng ký.');
    throw e;
  }
}
// A fixed bcrypt hash also makes unknown-account logins perform a password comparison.
const dummyHash = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
export async function loginMember(body: unknown) {
  const input = memberLoginSchema.parse(body);
  const candidate = await MemberModel.findOne({ phone: input.phone });
  const valid = await verifyPassword(input.password, candidate?.passwordHash ?? dummyHash);
  const outcome = await unitOfWork.withTransaction(async (session) => {
    const member = candidate ? await MemberModel.findById(candidate._id).session(session) : null;
    if (member?.lockedUntil && member.lockedUntil.getTime() > Date.now())
      return { locked: true } as const;
    if (!member || !valid || member.passwordHash !== candidate?.passwordHash || !member.isActive) {
      if (member) {
        const attempts =
          member.lockedUntil && member.lockedUntil.getTime() <= Date.now()
            ? 1
            : member.failedLogins + 1;
        await MemberModel.updateOne(
          { _id: member._id },
          {
            $set: {
              failedLogins: attempts,
              lockedUntil: attempts >= 6 ? new Date(Date.now() + 15 * 60000) : null,
            },
          },
          { session },
        );
      }
      return { invalid: true } as const;
    }
    member.failedLogins = 0;
    member.lockedUntil = null;
    await member.save({ session });
    return newSession(member, session);
  });
  if ('locked' in outcome)
    throw new RateLimitError('Đăng nhập sai nhiều lần. Vui lòng thử lại sau 15 phút.');
  if ('invalid' in outcome) throw new UnauthorizedError('SĐT hoặc mật khẩu không đúng.');
  return outcome;
}
export async function logoutMember(token: unknown) {
  if (typeof token === 'string') await MemberSessionModel.deleteOne({ tokenHash: sha256(token) });
}
export async function requireMember(token: unknown) {
  const member = await resolveMember(token);
  if (!member) throw new UnauthorizedError('Vui lòng đăng nhập thành viên.');
  return member;
}
export async function changeMemberPassword(token: unknown, body: unknown) {
  const input = memberChangePasswordSchema.parse(body);
  const member = await requireMember(token);
  if (!(await verifyPassword(input.currentPassword, member.passwordHash)))
    throw new UnauthorizedError('Mật khẩu hiện tại không đúng.');
  const passwordHash = await hashPassword(input.password);
  await unitOfWork.withTransaction(async (session) => {
    const updated = await MemberModel.findOneAndUpdate(
      { _id: member._id, authVersion: member.authVersion },
      {
        $set: { passwordHash, failedLogins: 0, lockedUntil: null },
        $inc: { authVersion: 1, version: 1 },
      },
      { session },
    );
    if (!updated)
      throw new ConflictError('CONFLICT', 'Tài khoản vừa thay đổi. Vui lòng đăng nhập lại.');
    await MemberSessionModel.deleteMany({ memberId: member._id }, { session });
  });
}
export async function listMemberPoints(memberId: string, page = 1) {
  const [rows, total] = await Promise.all([
    PointEntryModel.find({ memberId })
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * 20)
      .limit(20),
    PointEntryModel.countDocuments({ memberId }),
  ]);
  return {
    items: rows.map((r) =>
      pointEntrySchema.parse({
        id: r.id,
        orderCode: r.orderCode,
        type: r.type,
        points: r.points,
        balanceAfter: r.balanceAfter,
        createdAt: r.createdAt.toISOString(),
      }),
    ),
    total,
    page,
  };
}
export async function listMembers(q: string, page = 1) {
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const filter = q
    ? { $or: [{ phone: new RegExp(escaped, 'i') }, { name: new RegExp(escaped, 'i') }] }
    : {};
  const [members, total] = await Promise.all([
    MemberModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * 20)
      .limit(20),
    MemberModel.countDocuments(filter),
  ]);
  return { items: members.map(memberDto), total, page };
}
export async function updateMember(id: string, body: unknown, actorId: string) {
  const { expectedVersion, password, ...changes } = memberAdminUpdateSchema.parse(body);
  const passwordHash = password ? await hashPassword(password) : undefined;
  return unitOfWork.withTransaction(async (session) => {
    const member = await MemberModel.findOneAndUpdate(
      { _id: id, version: expectedVersion },
      {
        $set: {
          ...changes,
          ...(passwordHash ? { passwordHash, failedLogins: 0, lockedUntil: null } : {}),
        },
        $inc: { version: 1, authVersion: 1 },
      },
      { new: true, session },
    );
    if (!member) {
      if (!(await MemberModel.exists({ _id: id }).session(session))) throw new NotFoundError();
      throw new ConflictError('CONFLICT', 'Thành viên vừa được cập nhật.');
    }
    await MemberSessionModel.deleteMany({ memberId: member._id }, { session });
    await auditRepository.log(
      {
        actorType: 'USER',
        actorId,
        action: 'member.updated',
        entityType: 'Member',
        entityId: id,
        metadata: { isActive: member.isActive, passwordReset: !!password },
      },
      session,
    );
    return memberDto(member);
  });
}
