import type { Request, Response, NextFunction } from 'express';
import { MEMBER_COOKIE, requireMember } from '../services/memberService.js';

// AI reads the public catalog; a member can use it without a table capability.
export async function requireAiCustomer(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.guest) await requireMember(req.cookies?.[MEMBER_COOKIE]);
    res.set('Cache-Control', 'no-store');
    next();
  } catch (error) {
    next(error);
  }
}
