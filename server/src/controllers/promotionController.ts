import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { config } from '../config/index.js';
import * as members from '../services/memberService.js';
import * as promotions from '../services/promotionService.js';
import { LOYALTY_RULES } from '@may-cafe/contracts';

type Work = (req: Request, res: Response) => Promise<unknown>;
function handler(work: Work, status = 200) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(status).json({ success: true, data: await work(req, res) });
    } catch (e) {
      next(e);
    }
  };
}
const token = (req: Request): unknown => req.cookies?.[members.MEMBER_COOKIE];
const id = (req: Request) =>
  z
    .string()
    .regex(/^[a-f\d]{24}$/i)
    .parse(req.params['id']);
const page = (req: Request) =>
  z.coerce.number().int().min(1).max(100000).default(1).parse(req.query.page);
const clear = (res: Response) =>
  res.clearCookie(members.MEMBER_COOKIE, { domain: config.cookieDomain, path: '/' });
function cookie(res: Response, value: string) {
  res.cookie(members.MEMBER_COOKIE, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    domain: config.cookieDomain,
    path: '/',
    maxAge: members.MEMBER_TTL_MS,
  });
}
export const register = handler(async (req, res) => {
  const result = await members.registerMember(req.body);
  await members.logoutMember(token(req));
  cookie(res, result.token);
  return { member: result.member };
}, 201);
export const login = handler(async (req, res) => {
  const result = await members.loginMember(req.body);
  await members.logoutMember(token(req));
  cookie(res, result.token);
  return { member: result.member };
});
export const logout = handler(async (req, res) => {
  await members.logoutMember(token(req));
  clear(res);
  return {};
});
export const me = handler(async (req) => {
  const member = await members.resolveMember(token(req));
  return { member: member ? members.memberDto(member) : null, rules: LOYALTY_RULES };
});
export const password = handler(async (req, res) => {
  await members.changeMemberPassword(token(req), req.body);
  clear(res);
  return {};
});
export const points = handler(async (req) =>
  members.listMemberPoints((await members.requireMember(token(req))).id, page(req)),
);
export const listMembers = handler((req) =>
  members.listMembers(z.string().max(80).default('').parse(req.query.q), page(req)),
);
export const updateMember = handler(async (req) => ({
  member: await members.updateMember(id(req), req.body, req.user!.id),
}));
export const memberPoints = handler((req) => members.listMemberPoints(id(req), page(req)));
export const vouchers = handler(() => promotions.listVouchers());
export const createVoucher = handler(
  async (req) => ({ voucher: await promotions.saveVoucher(null, req.body, req.user!.id) }),
  201,
);
export const updateVoucher = handler(async (req) => ({
  voucher: await promotions.saveVoucher(id(req), req.body, req.user!.id),
}));
