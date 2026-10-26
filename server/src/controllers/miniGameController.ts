import type { Request, Response, NextFunction } from 'express';
import { ForbiddenError } from '../errors/AppError.js';
import * as game from '../services/miniGameService.js';

type Operation = (actor: game.GameActor, req: Request) => Promise<unknown>;
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
export const feed = handle((actor) => game.gameFeed(actor));
export const create = handle((actor, req) => game.createGame(actor, req.body));
export const continueRound = handle((actor, req) => game.continueGame(actor, String(req.params['id']), req.body));
export const action = (kind: game.GameAction) =>
  handle((actor, req) => game.actOnGame(actor, String(req.params['id']), kind, req.body));
