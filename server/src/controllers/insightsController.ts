import type { Request, Response, NextFunction } from 'express';
import { smartInsights, companions } from '../services/insightsService.js';
const handle =
  (work: (input: unknown) => Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, data: await work(req.query) });
    } catch (error) {
      next(error);
    }
  };
export const overview = handle(smartInsights);
export const recommendations = handle(companions);
