import type { Request, Response, NextFunction } from 'express';
import { cancelRequestDecisionSchema, cancelRequestSchema } from '@may-cafe/contracts';
import { ForbiddenError } from '../errors/AppError.js';
import {
  createCancelRequest,
  decideCancelRequest,
  listOpenCancelRequests,
} from '../services/cancelRequestService.js';
import { toStaffOrder } from '../services/orderDto.js';

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.guest) throw new ForbiddenError();
    const input = cancelRequestSchema.parse(req.body);
    const item = await createCancelRequest(
      String(req.params['id'] ?? ''),
      req.guest.participantId,
      input.reason,
    );
    res.status(201).json({ success: true, data: { request: item } });
  } catch (error) {
    next(error);
  }
}
export async function list(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ success: true, data: { items: await listOpenCancelRequests() } });
  } catch (error) {
    next(error);
  }
}
export async function decide(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = cancelRequestDecisionSchema.parse(req.body);
    const { request, order } = await decideCancelRequest(
      String(req.params['id'] ?? ''),
      input.decision,
      req.user!.id,
      input.expectedVersion,
      input.note,
      input.refundConfirmed,
      input.refundMethod,
    );
    res.json({ success: true, data: { request, order: toStaffOrder(order) } });
  } catch (error) {
    next(error);
  }
}
