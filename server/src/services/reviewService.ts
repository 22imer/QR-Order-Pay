import { reviewRepository } from '../repositories/reviewRepository.js';
import { orderRepository } from '../repositories/orderRepository.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../errors/AppError.js';

export async function submitReview(input: {
  orderId: string;
  participantId: string;
  tableSessionId: string;
  rating: number;
  comment?: string;
}) {
  const order = await orderRepository.findById(input.orderId);
  if (!order) throw new NotFoundError('Đơn không tồn tại.');
  if (
    order.participantId !== input.participantId ||
    (order.tableSessionId?.toString() ?? '') !== input.tableSessionId
  )
    throw new ForbiddenError('Bạn không thể đánh giá đơn của khách khác.');
  if (order.status !== 'SERVED') throw new ValidationError('Đơn chưa được phục vụ xong.');
  if (order.paymentStatus !== 'PAID') throw new ValidationError('Đơn chưa được thanh toán.');
  const existing = await reviewRepository.findByOrder(order._id.toString());
  if (existing) throw new ConflictError('CONFLICT', 'Đơn này đã được đánh giá.');
  try {
    return await reviewRepository.create({
      orderId: order._id.toString(),
      tableSessionId: order.tableSessionId?.toString() ?? '',
      participantId: input.participantId,
      rating: input.rating,
      comment: input.comment,
    });
  } catch (error) {
    if ((error as { code?: number }).code === 11000)
      throw new ConflictError('CONFLICT', 'Đơn này đã được đánh giá.');
    throw error;
  }
}
