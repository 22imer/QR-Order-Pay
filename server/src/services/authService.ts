import { userRepository } from '../repositories/userRepository.js';
import { refreshSessionRepository } from '../repositories/refreshSessionRepository.js';
import {
  hashPassword,
  randomToken,
  sha256,
  signAccessToken,
  verifyPassword,
  parseTtlToMs,
} from '../utils/crypto.js';
import { config } from '../config/index.js';
import { UnauthorizedError } from '../errors/AppError.js';

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: { id: string; name: string; email: string; role: 'ADMIN' | 'STAFF' };
  refreshExpiresAt: Date;
}

export async function login(input: {
  email: string;
  password: string;
  userAgent?: string;
  ip?: string;
}): Promise<AuthResult> {
  const user = await userRepository.findByEmail(input.email);
  if (!user || !user.isActive) throw new UnauthorizedError('Tài khoản hoặc mật khẩu không đúng.');
  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) throw new UnauthorizedError('Tài khoản hoặc mật khẩu không đúng.');
  return issueTokens(
    {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      authVersion: user.authVersion ?? 0,
    },
    { userAgent: input.userAgent, ip: input.ip },
  );
}

export async function refresh(input: {
  refreshToken: string;
  userAgent?: string;
  ip?: string;
}): Promise<AuthResult> {
  const hash = sha256(input.refreshToken);
  const stored = await refreshSessionRepository.findByHash(hash);
  if (!stored) throw new UnauthorizedError('Refresh token không hợp lệ.');
  if (stored.revokedAt) throw new UnauthorizedError('Refresh token đã bị thu hồi.');
  if (stored.expiresAt.getTime() <= Date.now())
    throw new UnauthorizedError('Refresh token đã hết hạn.');
  const user = await userRepository.findById(stored.userId);
  if (!user || !user.isActive || (user.authVersion ?? 0) !== stored.authVersion)
    throw new UnauthorizedError('Tài khoản không khả dụng.');
  // rotate
  await refreshSessionRepository.revokeByHash(hash);
  return issueTokens(
    {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      authVersion: user.authVersion ?? 0,
    },
    { userAgent: input.userAgent, ip: input.ip },
  );
}

export async function logout(refreshToken: string): Promise<void> {
  await refreshSessionRepository.revokeByHash(sha256(refreshToken));
}

export async function logoutAll(userId: string): Promise<void> {
  await refreshSessionRepository.revokeAllForUser(userId);
}

async function issueTokens(
  user: { id: string; name: string; email: string; role: 'ADMIN' | 'STAFF'; authVersion?: number },
  meta: { userAgent?: string; ip?: string },
): Promise<AuthResult> {
  const accessToken = signAccessToken({
    sub: user.id,
    role: user.role,
    name: user.name,
    authVersion: user.authVersion ?? 0,
  });
  const refreshToken = randomToken(40);
  const ttlMs = parseTtlToMs(config.refreshTokenTtl);
  const expiresAt = new Date(Date.now() + ttlMs);
  const created = await refreshSessionRepository.create({
    userId: user.id,
    tokenHash: sha256(refreshToken),
    authVersion: user.authVersion ?? 0,
    expiresAt,
    userAgent: meta.userAgent ?? '',
    ip: meta.ip ?? '',
  });
  return {
    accessToken,
    refreshToken,
    refreshExpiresAt: created.expiresAt,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  };
}

export async function bootstrapAdminIfMissing(
  email: string,
  password: string,
  name: string,
): Promise<void> {
  const existing = await userRepository.findByEmail(email);
  if (existing) return;
  const passwordHash = await hashPassword(password);
  await userRepository.create({ name, email, passwordHash, role: 'ADMIN' });
}
