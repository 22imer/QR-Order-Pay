import type { Request, Response, NextFunction } from 'express';
import { ForbiddenError, UnauthorizedError } from '../errors/AppError.js';
import { verifyAccessToken } from '../utils/crypto.js';
import { userRepository } from '../repositories/userRepository.js';

export interface AuthedUser {
  id: string;
  role: 'ADMIN' | 'STAFF';
  name: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthedUser;
    requestId?: string;
    guest?: { id: string; tableSessionId: string; participantId: string };
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Vui lòng đăng nhập.'));
  }
  const token = header.slice('Bearer '.length).trim();
  try {
    const payload = verifyAccessToken(token);
    const user = await userRepository.findById(payload.sub);
    if (
      !user?.isActive ||
      user.role !== payload.role ||
      (user.authVersion ?? 0) !== (payload.authVersion ?? 0)
    )
      return next(new UnauthorizedError('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.'));
    req.user = { id: user.id, role: user.role, name: user.name };
    next();
  } catch {
    next(new UnauthorizedError('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.'));
  }
}

export function requireRole(...roles: Array<'ADMIN' | 'STAFF'>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new UnauthorizedError());
    if (!roles.includes(req.user.role))
      return next(new ForbiddenError('Bạn không có quyền truy cập chức năng này.'));
    next();
  };
}

export async function loadUserIfActive(userId: string): Promise<AuthedUser | null> {
  const user = await userRepository.findById(userId);
  if (!user || !user.isActive) return null;
  return { id: user._id.toString(), role: user.role, name: user.name };
}

function paramString(req: Request, key: string): string {
  const v = req.params[key];
  if (typeof v !== 'string') throw new Error(`Missing param ${key}`);
  return v;
}

export function getParam(req: Request, key: string): string {
  return paramString(req, key);
}
