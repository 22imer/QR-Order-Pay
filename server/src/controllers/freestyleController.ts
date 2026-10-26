import type { Request, Response, NextFunction } from 'express';
import { freestyleAskSchema, freestyleValidateSchema } from '@may-cafe/contracts';
import { ForbiddenError } from '../errors/AppError.js';
import { requireMember, MEMBER_COOKIE } from '../services/memberService.js';
import { photoOwner } from '../services/cupPhotoService.js';
import { guestCanOrder } from '../services/tableSessionService.js';
import { inventoryOverview } from '../services/inventoryService.js';
import {
  buildFreestyleAdvisor,
  freestyleSettings,
  saveFreestyleSettings,
  freestyleCatalog,
  validateFreestyle,
} from '../services/freestyleService.js';
const advisor = buildFreestyleAdvisor();
const handle =
  (work: (req: Request) => Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, data: await work(req) });
    } catch (error) {
      next(error);
    }
  };
export const catalog = handle(() => freestyleCatalog());
export const admin = handle(async () => ({
  ...(await freestyleSettings()),
  ingredients: (await inventoryOverview()).ingredients,
}));
export const save = handle((req) => saveFreestyleSettings(req.user!.id, req.body));
async function ownerFor(req: Request, context: 'TABLE' | 'PICKUP') {
  let owner: string;
  if (context === 'TABLE') {
    if (!req.guest) throw new ForbiddenError('Quét QR tại bàn để dùng Freestyle tại bàn.');
    await guestCanOrder(req.guest.tableSessionId);
    owner = photoOwner(req.guest.tableSessionId, req.guest.participantId);
  } else owner = `member:${(await requireMember(req.cookies?.[MEMBER_COOKIE])).id}`;
  return owner;
}
export const recommend = handle(async (req) => {
  const body = freestyleAskSchema.parse(req.body);
  return advisor.recommend(await ownerFor(req, body.context), body);
});
export const validate = handle(async (req) => {
  const body = freestyleValidateSchema.parse(req.body);
  return validateFreestyle(await ownerFor(req, body.context), body);
});
