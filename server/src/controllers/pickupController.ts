import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { MEMBER_COOKIE, requireMember } from '../services/memberService.js';
import * as pickup from '../services/pickupService.js';
import { transitionByStaff } from '../services/orderService.js';
import { confirmOrderPayment } from '../services/paymentService.js';
import { refundAndCancelOrder } from '../services/orderRefundService.js';
import {
  paymentRequestSchema,
  refundOrderRequestSchema,
  orderStatusSchema,
} from '@may-cafe/contracts';
import { ValidationError } from '../errors/AppError.js';
import { listPublicMenu } from '../services/menuService.js';

type Work = (req: Request, actor: pickup.PickupActor) => Promise<unknown>;
export function handler(staff: boolean, work: Work) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = {
        staff,
        id: staff ? req.user!.id : (await requireMember(req.cookies?.[MEMBER_COOKIE])).id,
      };
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, data: await work(req, actor) });
    } catch (e) {
      next(e);
    }
  };
}
const id = (req: Request) =>
  z
    .string()
    .regex(/^[a-f\d]{24}$/i)
    .parse(req.params['id']);
async function pickupId(req: Request) {
  const orderId = id(req);
  return pickup.assertPickupId(orderId);
}
export const quote = (staff: boolean) =>
  handler(staff, (req, a) => pickup.quotePickup(a, req.body));
export const catalog = handler(true, () => listPublicMenu());
export const create = (staff: boolean) =>
  handler(staff, async (req, a) => {
    const result = await pickup.createPickup(a, req.body);
    return { order: await pickup.pickupDto(result.order), created: result.created };
  });
export const list = (staff: boolean) =>
  handler(staff, (req, a) =>
    pickup.listPickups(
      a,
      z.coerce.number().int().min(1).max(100000).default(1).parse(req.query.page),
      z.enum(['true', 'false']).default('false').parse(req.query.history) === 'true',
    ),
  );
export const cancel = (staff: boolean, noShow = false) =>
  handler(staff, async (req, a) => ({
    order: await pickup.pickupDto(await pickup.closePickup(a, id(req), req.body, noShow)),
  }));
export const bill = (staff: boolean) =>
  handler(staff, (req, a) => pickup.getPickupBill(a, id(req)));
export const transition = handler(true, async (req, a) => {
  const body = z
    .object({ status: orderStatusSchema, expectedVersion: z.number().int().nonnegative() })
    .strict()
    .parse(req.body);
  return {
    order: await pickup.pickupDto(
      await transitionByStaff(await pickupId(req), body.status, a, undefined, body.expectedVersion),
    ),
  };
});
export const pay = handler(true, async (req, a) => {
  const input = paymentRequestSchema.strict().parse(req.body),
    key = req.get('Idempotency-Key');
  if (!key || key.length < 8 || key.length > 64)
    throw new ValidationError('Thiếu Idempotency-Key.');
  const result = await confirmOrderPayment({
    ...input,
    orderId: await pickupId(req),
    staffId: a.id,
    idempotencyKey: key,
  });
  return { replayed: result.replayed };
});
export const refund = handler(true, async (req, a) => {
  const input = refundOrderRequestSchema.strict().parse(req.body);
  return {
    order: await pickup.pickupDto(
      await refundAndCancelOrder(
        await pickupId(req),
        a.id,
        input.expectedVersion,
        input.amount,
        input.method,
        input.reason,
      ),
    ),
  };
});
