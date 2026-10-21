import type { Request, Response, NextFunction } from 'express';
import {
  confirmPayment,
  confirmOrderPayment,
  listAwaitingPayments,
} from '../services/paymentService.js';
import { toStaffOrder } from '../services/orderDto.js';
import { tableRepository } from '../repositories/tableRepository.js';
import { NotFoundError, ValidationError } from '../errors/AppError.js';
import { buildBill } from '../services/paymentService.js';
import { paymentRequestSchema, refundOrderRequestSchema } from '@may-cafe/contracts';
import { refundAndCancelOrder } from '../services/orderRefundService.js';
import { recordBusinessEvent } from '../infrastructure/metrics.js';
import {
  claimPayment,
  releasePaymentClaim,
  paymentClaims,
} from '../services/paymentClaimService.js';
import { paymentClaimRequestSchema } from '@may-cafe/contracts';
import {
  paymentCorrectionRequestSchema,
  paymentCorrectionDecisionSchema,
} from '@may-cafe/contracts';
import {
  requestPaymentCorrection,
  decidePaymentCorrection,
  listPaymentAccounting,
} from '../services/paymentCorrectionService.js';

export async function accounting(req: Request, res: Response, next: NextFunction) {
  try {
    const page = Math.max(1, Math.min(10000, Number(req.query['page']) || 1));
    res.json({ success: true, data: await listPaymentAccounting(Math.floor(page), 30) });
  } catch (error) {
    next(error);
  }
}
export async function requestCorrection(req: Request, res: Response, next: NextFunction) {
  try {
    const input = paymentCorrectionRequestSchema.parse(req.body);
    res
      .status(201)
      .json({
        success: true,
        data: await requestPaymentCorrection(String(req.params['id']), req.user!.id, input),
      });
  } catch (error) {
    next(error);
  }
}
export async function decideCorrection(req: Request, res: Response, next: NextFunction) {
  try {
    const input = paymentCorrectionDecisionSchema.parse(req.body);
    res.json({
      success: true,
      data: await decidePaymentCorrection(String(req.params['id']), req.user!.id, input),
    });
  } catch (error) {
    next(error);
  }
}

export async function claim(req: Request, res: Response, next: NextFunction) {
  try {
    const { token } = paymentClaimRequestSchema.parse(req.body);
    res.json({
      success: true,
      data: await claimPayment(String(req.params['id']), req.user!.id, token),
    });
  } catch (error) {
    next(error);
  }
}
export async function releaseClaim(req: Request, res: Response, next: NextFunction) {
  try {
    const { token } = paymentClaimRequestSchema.parse(req.body);
    await releasePaymentClaim(String(req.params['id']), req.user!.id, token);
    res.json({ success: true, data: {} });
  } catch (error) {
    next(error);
  }
}

export async function refundOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = refundOrderRequestSchema.parse(req.body);
    const order = await refundAndCancelOrder(
      String(req.params['id']),
      req.user!.id,
      input.expectedVersion,
      input.amount,
      input.method,
      input.reason,
    );
    res.json({ success: true, data: { order: toStaffOrder(order) } });
  } catch (error) {
    next(error);
  }
}

export async function awaiting(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orders = await listAwaitingPayments();
    const tables = await tableRepository.list();
    const claims = await paymentClaims(orders.map((o) => o.tableSessionId?.toString() ?? ''));
    const names = new Map(tables.map((t) => [t.id, t.name]));
    res.json({
      success: true,
      data: {
        items: orders.map((o) => ({
          ...toStaffOrder(o),
          tableName: names.get(o.tableId?.toString() ?? '') ?? 'Bàn',
          collectionClaim: claims.get(o.tableSessionId?.toString() ?? '') ?? null,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
}
export async function confirmOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = paymentRequestSchema.parse(req.body);
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length < 8 || key.length > 64)
      throw new ValidationError('Thiếu hoặc sai Idempotency-Key.');
    const result = await confirmOrderPayment({
      ...input,
      orderId: String(req.params['id']),
      staffId: req.user!.id,
      claimToken: req.get('X-Payment-Claim'),
      idempotencyKey: key,
    });
    if (!result.replayed) recordBusinessEvent('payment_confirmed');
    res.status(result.replayed ? 200 : 201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

export async function confirm(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw new NotFoundError();
    const id = String(req.params['id'] ?? '');
    const body = paymentRequestSchema.parse(req.body);
    const idempotencyKey = req.headers['idempotency-key'];
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8)
      throw new ValidationError('Thiếu Idempotency-Key.');
    const result = await confirmPayment({
      tableSessionId: id,
      expectedVersion: body.expectedVersion,
      amount: body.amount,
      method: body.method,
      staffId: req.user.id,
      claimToken: req.get('X-Payment-Claim'),
      idempotencyKey,
      note: body.note,
    });
    if (!result.replayed) {
      recordBusinessEvent('payment_confirmed');
    }
    res.status(result.replayed ? 200 : 201).json({
      success: true,
      data: {
        payment: result.payment,
        orderIds: result.orderIds,
        replayed: result.replayed,
        billId: result.billId,
      },
    });
  } catch (e) {
    next(e);
  }
}

export async function bill(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = String(req.params['id'] ?? '');
    const result = await buildBill(id);
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
}
