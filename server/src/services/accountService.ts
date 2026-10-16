import { z } from 'zod';
import { Types } from 'mongoose';
import { UserModel, type UserDoc } from '../models/User.js';
import { userRepository } from '../repositories/userRepository.js';
import { refreshSessionRepository } from '../repositories/refreshSessionRepository.js';
import { auditRepository } from '../repositories/auditRepository.js';
import { unitOfWork } from '../infrastructure/unitOfWork.js';
import { hashPassword, verifyPassword } from '../utils/crypto.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../errors/AppError.js';

const name = z.string().trim().min(1).max(80);
const email = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
const password = z.string().min(8).max(72);
const role = z.enum(['ADMIN', 'STAFF']);
const createSchema = z.object({ name, email, password, role: role.default('STAFF') }).strict();
const editSchema = z
  .object({
    name: name.optional(),
    email: email.optional(),
    role: role.optional(),
    isActive: z.boolean().optional(),
    password: password.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

export const publicUser = (user: UserDoc) => ({
  id: user.id as string,
  name: user.name,
  email: user.email,
  role: user.role,
  isActive: user.isActive,
  createdAt: user.createdAt,
});

export async function createAccount(input: unknown, actorId: string) {
  const data = createSchema.parse(input);
  if (await userRepository.findByEmail(data.email))
    throw new ConflictError('EMAIL_TAKEN', 'Email đã được sử dụng.');
  const user = await userRepository.create({
    name: data.name,
    email: data.email,
    role: data.role,
    passwordHash: await hashPassword(data.password),
  });
  await auditRepository.log({
    actorType: 'USER',
    actorId,
    action: 'user.created',
    entityType: 'User',
    entityId: user.id,
  });
  return publicUser(user);
}

export async function editAccount(id: string, input: unknown, actorId: string) {
  if (!Types.ObjectId.isValid(id)) throw new ValidationError('Tài khoản không hợp lệ.');
  const data = editSchema.parse(input);
  if (id === actorId && (data.isActive === false || data.role === 'STAFF'))
    throw new ConflictError(
      'SELF_ACCOUNT_CHANGE',
      'Không thể tự khóa hoặc hạ quyền tài khoản đang dùng.',
    );
  const passwordHash = data.password ? await hashPassword(data.password) : undefined;
  return unitOfWork.withTransaction(async (session) => {
    // Lock the actor as well as the target: two admins cannot concurrently remove each other.
    const actor = await UserModel.findOneAndUpdate(
      { _id: actorId, role: 'ADMIN', isActive: true },
      { $inc: { __v: 1 } },
      { new: true, session },
    );
    if (!actor) throw new ForbiddenError();
    const user = await userRepository.findById(id, session);
    if (!user || user.isDeleted) throw new NotFoundError('Không tìm thấy tài khoản.');
    if (
      data.email &&
      data.email !== user.email &&
      (await UserModel.exists({ email: data.email }).session(session))
    )
      throw new ConflictError('EMAIL_TAKEN', 'Email đã được sử dụng.');
    const revoke =
      !!passwordHash ||
      (data.role !== undefined && data.role !== user.role) ||
      (data.isActive !== undefined && data.isActive !== user.isActive);
    const { password: _password, ...fields } = data;
    void _password;
    const updated = await userRepository.update(
      id,
      {
        $set: { ...fields, ...(passwordHash ? { passwordHash } : {}) },
        ...(revoke ? { $inc: { authVersion: 1 } } : {}),
      },
      session,
    );
    if (revoke) await refreshSessionRepository.revokeAllForUser(id, session);
    await auditRepository.log(
      {
        actorType: 'USER',
        actorId,
        action: 'user.updated',
        entityType: 'User',
        entityId: id,
        metadata: { fields: Object.keys(data) },
      },
      session,
    );
    return publicUser(updated!);
  });
}

export async function deleteEmployee(id: string, actorId: string) {
  if (!Types.ObjectId.isValid(id)) throw new ValidationError('Nhân viên không hợp lệ.');
  return unitOfWork.withTransaction(async (session) => {
    const actor = await UserModel.findOneAndUpdate(
      { _id: actorId, role: 'ADMIN', isActive: true },
      { $inc: { __v: 1 } },
      { new: true, session },
    );
    if (!actor) throw new ForbiddenError();
    const user = await userRepository.findById(id, session);
    if (!user || user.isDeleted) throw new NotFoundError('Không tìm thấy nhân viên.');
    if (user.role !== 'STAFF' || id === actorId)
      throw new ConflictError('EMPLOYEE_ONLY', 'Chỉ có thể xóa nhân viên.');
    await userRepository.update(
      id,
      { $set: { isDeleted: true, isActive: false }, $inc: { authVersion: 1 } },
      session,
    );
    await refreshSessionRepository.revokeAllForUser(id, session);
    await auditRepository.log(
      { actorType: 'USER', actorId, action: 'user.deleted', entityType: 'User', entityId: id },
      session,
    );
    return { id };
  });
}

export async function updateProfile(id: string, input: unknown) {
  const data = z.object({ name }).strict().parse(input);
  const user = await userRepository.update(id, { $set: data });
  if (!user) throw new NotFoundError('Không tìm thấy tài khoản.');
  return publicUser(user);
}

export async function changePassword(id: string, input: unknown) {
  const data = z
    .object({ currentPassword: z.string().min(1).max(72), newPassword: password })
    .strict()
    .parse(input);
  if (data.currentPassword === data.newPassword)
    throw new ValidationError('Mật khẩu mới phải khác mật khẩu hiện tại.');
  const user = await userRepository.findById(id);
  if (!user || !(await verifyPassword(data.currentPassword, user.passwordHash)))
    throw new ValidationError('Mật khẩu hiện tại không đúng.');
  const passwordHash = await hashPassword(data.newPassword);
  await unitOfWork.withTransaction(async (session) => {
    const updated = await UserModel.findOneAndUpdate(
      { _id: id, passwordHash: user.passwordHash, isActive: true },
      { $set: { passwordHash }, $inc: { authVersion: 1 } },
      { session },
    );
    if (!updated)
      throw new ConflictError('ACCOUNT_CHANGED', 'Tài khoản vừa thay đổi. Vui lòng đăng nhập lại.');
    await refreshSessionRepository.revokeAllForUser(id, session);
    await auditRepository.log(
      {
        actorType: 'USER',
        actorId: id,
        action: 'user.passwordChanged',
        entityType: 'User',
        entityId: id,
      },
      session,
    );
  });
}
