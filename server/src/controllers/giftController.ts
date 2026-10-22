import type { Request, Response, NextFunction } from 'express';
import { ForbiddenError } from '../errors/AppError.js';
import * as gifts from '../services/giftService.js';

type Operation = (actor: gifts.GiftActor, req: Request) => Promise<unknown>;
const handle =
  (operation: Operation) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.guest) throw new ForbiddenError('Vui lòng quét QR tại bàn.');
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, data: await operation(req.guest, req) });
    } catch (error) {
      next(error);
    }
  };
export const tables = handle((actor) => gifts.giftTables(actor));
export const list = handle((actor, req) => gifts.listGifts(actor, req.query));
export const create = handle((actor, req) => gifts.createGift(actor, req.body));
export const decide = handle((actor, req) =>
  gifts.decideGift(actor, gifts.giftIdSchema.parse(req.params['id']), req.body),
);
