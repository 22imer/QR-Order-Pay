import type { Request, Response, NextFunction } from 'express';
import {
  login as loginSvc,
  refresh as refreshSvc,
  logout as logoutSvc,
  logoutAll as logoutAllSvc,
} from '../services/authService.js';
import { loginRequestSchema, authResponseSchema } from '@may-cafe/contracts';
import { setRefreshCookie, clearRefreshCookie, refreshCookieName } from './cookieHelpers.js';
import { changePassword, publicUser, updateProfile } from '../services/accountService.js';
import { userRepository } from '../repositories/userRepository.js';

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = loginRequestSchema.parse(req.body);
    const result = await loginSvc({
      email: input.email,
      password: input.password,
      userAgent: req.headers['user-agent'] ?? '',
      ip: req.ip ?? '',
    });
    setRefreshCookie(req, res, result.refreshToken, result.refreshExpiresAt);
    const data = authResponseSchema.parse({ accessToken: result.accessToken, user: result.user });
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.cookies?.[refreshCookieName(req)];
    if (!token || typeof token !== 'string') {
      res
        .status(401)
        .json({
          success: false,
          error: { code: 'UNAUTHENTICATED', message: 'Thiếu refresh token.' },
        });
      return;
    }
    const result = await refreshSvc({
      refreshToken: token,
      userAgent: req.headers['user-agent'] ?? '',
      ip: req.ip ?? '',
    });
    setRefreshCookie(req, res, result.refreshToken, result.refreshExpiresAt);
    const data = authResponseSchema.parse({ accessToken: result.accessToken, user: result.user });
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.cookies?.[refreshCookieName(req)];
    if (typeof token === 'string') {
      await logoutSvc(token);
    }
    clearRefreshCookie(req, res);
    res.json({ success: true, data: { ok: true } });
  } catch (e) {
    next(e);
  }
}

export async function logoutAll(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res
        .status(401)
        .json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Thiếu phiên.' } });
      return;
    }
    await logoutAllSvc(req.user.id);
    clearRefreshCookie(req, res);
    res.json({ success: true, data: { ok: true } });
  } catch (e) {
    next(e);
  }
}

export async function me(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res
        .status(401)
        .json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Thiếu phiên.' } });
      return;
    }
    const user = await userRepository.findById(req.user.id);
    res.json({ success: true, data: publicUser(user!) });
  } catch (e) {
    next(e);
  }
}

export async function profile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ success: true, data: { user: await updateProfile(req.user!.id, req.body) } });
  } catch (error) {
    next(error);
  }
}

export async function password(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await changePassword(req.user!.id, req.body);
    clearRefreshCookie(req, res);
    res.json({ success: true, data: { ok: true } });
  } catch (error) {
    next(error);
  }
}
