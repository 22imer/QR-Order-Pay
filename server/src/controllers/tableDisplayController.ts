import type { Request, Response, NextFunction } from 'express';
import {
  getDisplayQr,
  getStaticTableQr,
  provisionTableDisplay,
} from '../services/tableQrService.js';
import { ValidationError } from '../errors/AppError.js';
import { z } from 'zod';

export async function staticQr(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = z
      .string()
      .regex(/^[a-f\d]{24}$/i)
      .parse(req.params['id']);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: await getStaticTableQr(id) });
  } catch (error) {
    next(error);
  }
}

export async function provision(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await provisionTableDisplay(String(req.params['id']), req.user!.id);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}
export async function currentQr(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.headers['x-table-display-token'];
    if (typeof token !== 'string') throw new ValidationError('Thiếu khóa màn hình bàn.');
    const result = await getDisplayQr(token);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}
