import type { Request, Response, NextFunction } from 'express';
import {
  orderStatusSchema,
  placeOrderRequestSchema,
  quoteOrderRequestSchema,
  reviewRequestSchema,
  updateOrderStatusRequestSchema,
} from '@may-cafe/contracts';
import {
  cancelOrderByGuest,
  getOrderForGuest,
  listOrdersForGuest,
  listOrdersForStaff,
  placeOrder,
} from '../services/orderService.js';
import { toGuestOrder, toStaffOrder } from '../services/orderDto.js';
import { submitReview } from '../services/reviewService.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors/AppError.js';
import { transitionByStaff } from '../services/orderService.js';
import { orderRepository } from '../repositories/orderRepository.js';
import { tableRepository } from '../repositories/tableRepository.js';
import { recordBusinessEvent, recordOrderStageDuration } from '../infrastructure/metrics.js';
import { createOrderQuote } from '../services/orderPricingService.js';
import { reviewRepository } from '../repositories/reviewRepository.js';
import { MEMBER_COOKIE, resolveMember } from '../services/memberService.js';

export async function quote(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.guest) throw new ForbiddenError('Vui lòng quét QR tại bàn để báo giá.');
    const input = quoteOrderRequestSchema.parse(req.body);
    const data = await createOrderQuote({
      tableSessionId: req.guest.tableSessionId,
      participantId: req.guest.participantId,
      items: input.items,
      voucherCode: input.voucherCode,
      redeemPoints: input.redeemPoints,
      memberId: (await resolveMember(req.cookies?.[MEMBER_COOKIE]))?.id ?? null,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function place(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.guest) throw new ForbiddenError('Vui lòng quét QR tại bàn để đặt món.');
    const input = placeOrderRequestSchema.parse(req.body);
    const idempotencyKey = req.headers['idempotency-key'];
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8) {
      throw new ValidationError('Thiếu header Idempotency-Key.');
    }
    const result = await placeOrder({
      tableSessionId: req.guest.tableSessionId,
      participantId: req.guest.participantId,
      idempotencyKey,
      items: input.items,
      note: input.note,
      voucherCode: input.voucherCode,
      redeemPoints: input.redeemPoints,
      memberId: (await resolveMember(req.cookies?.[MEMBER_COOKIE]))?.id ?? null,
      quoteToken: input.quoteToken,
    });
    if (result.created) {
      recordBusinessEvent('order_created');
    }
    res.status(result.created ? 201 : 200).json({
      success: true,
      data: { order: toGuestOrder(result.order), created: result.created },
    });
  } catch (e) {
    next(e);
  }
}

export async function cancel(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.guest) throw new ForbiddenError();
    const id = String(req.params['id'] ?? '');
    const order = await cancelOrderByGuest(id, req.guest.participantId);
    recordBusinessEvent('order_cancelled');
    res.json({ success: true, data: { order: toGuestOrder(order) } });
  } catch (e) {
    next(e);
  }
}

export async function detail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.guest) throw new ForbiddenError();
    const id = String(req.params['id'] ?? '');
    const order = await getOrderForGuest(id, req.guest.participantId);
    const review = await reviewRepository.findByOrder(order.id);
    res.json({ success: true, data: { order: toGuestOrder(order, review) } });
  } catch (e) {
    next(e);
  }
}

export async function listMine(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.guest) throw new ForbiddenError();
    const [orders, reviews] = await Promise.all([
      listOrdersForGuest(req.guest.participantId, req.guest.tableSessionId),
      reviewRepository.listByParticipant(req.guest.tableSessionId, req.guest.participantId),
    ]);
    const byOrder = new Map(reviews.map((review) => [review.orderId.toString(), review]));
    res.json({
      success: true,
      data: { orders: orders.map((order) => toGuestOrder(order, byOrder.get(order.id))) },
    });
  } catch (e) {
    next(e);
  }
}

export async function review(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.guest) throw new ForbiddenError();
    const id = String(req.params['id'] ?? '');
    const input = reviewRequestSchema.parse(req.body);
    const created = await submitReview({
      orderId: id,
      participantId: req.guest.participantId,
      tableSessionId: req.guest.tableSessionId,
      rating: input.rating,
      comment: input.comment,
    });
    res.status(201).json({ success: true, data: { review: created } });
  } catch (e) {
    next(e);
  }
}

export async function staffList(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const status =
      typeof req.query.status === 'string' ? orderStatusSchema.parse(req.query.status) : undefined;
    const items = await listOrdersForStaff(status);
    const tables = await tableRepository.list();
    const byId = new Map(tables.map((t) => [t.id, t]));
    res.json({
      success: true,
      data: {
        items: items.map((o) => {
          const table = byId.get(o.tableId?.toString() ?? '');
          return toStaffOrder(o, { name: table?.name ?? (o.fulfillmentType === 'PICKUP' ? 'Đặt trước nhận tại quầy' : o.fulfillmentType === 'TAKEAWAY' ? 'Mang đi' : 'Bàn'), code: table?.code ?? '' });
        }),
      },
    });
  } catch (e) {
    next(e);
  }
}

export async function staffGetOne(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = String(req.params['id'] ?? '');
    const order = await orderRepository.findById(id);
    if (!order) {
      res.status(404).json({
        success: false,
        error: { code: 'ORDER_NOT_FOUND', message: 'Không tìm thấy đơn.' },
      });
      return;
    }
    const table = order.tableId ? await tableRepository.findById(order.tableId.toString()) : null;
    res.json({
      success: true,
      data: {
        order: toStaffOrder(order, { name: table?.name ?? (order.fulfillmentType === 'PICKUP' ? 'Đặt trước nhận tại quầy' : order.fulfillmentType === 'TAKEAWAY' ? 'Mang đi' : 'Bàn'), code: table?.code ?? '' }),
      },
    });
  } catch (e) {
    next(e);
  }
}

export async function staffTransition(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) throw new NotFoundError();
    const id = String(req.params['id'] ?? '');
    const body = updateOrderStatusRequestSchema.parse(req.body);
    const order = await transitionByStaff(id, body.status, { id: req.user.id }, body.reason);
    recordStageDuration(order);
    if (order.status === 'CANCELLED') recordBusinessEvent('order_cancelled');
    if (order.status === 'SERVED') recordBusinessEvent('order_served');
    res.json({ success: true, data: { order: toStaffOrder(order) } });
  } catch (e) {
    next(e);
  }
}

function recordStageDuration(order: Awaited<ReturnType<typeof transitionByStaff>>): void {
  const history = order.statusHistory;
  const transition = history.at(-1);
  const previous = history.at(-2);
  if (!transition?.at || !previous?.at) return;
  const stage =
    transition.to === 'CONFIRMED'
      ? 'acceptance'
      : transition.to === 'READY'
        ? 'preparation'
        : transition.to === 'SERVED'
          ? 'service'
          : null;
  if (!stage) return;
  recordOrderStageDuration(stage, (transition.at.getTime() - previous.at.getTime()) / 1_000);
}

export async function staffConfirmReceipt(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) throw new NotFoundError();
    const id = String(req.params['id'] ?? '');
    const order = await transitionByStaff(id, 'CONFIRMED', { id: req.user.id });
    recordStageDuration(order);
    res.json({ success: true, data: { order: toStaffOrder(order) } });
  } catch (e) {
    next(e);
  }
}
