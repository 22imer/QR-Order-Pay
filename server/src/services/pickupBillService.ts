import type { ClientSession } from 'mongoose';
import type { OrderDoc } from '../models/Order.js';
import { BillModel } from '../models/Bill.js';
import { PaymentModel } from '../models/Payment.js';
import { UserModel } from '../models/User.js';
import { randomShortCode } from '../utils/crypto.js';

/** One immutable invoice for one completed pickup, written in the order transaction. */
export async function finalizePickupBill(order: OrderDoc, actorId: string, session: ClientSession) {
  const existing = await BillModel.findOne({ pickupOrderId: order._id }).session(session);
  if (existing) return existing;
  const payments = await PaymentModel.find({ orderIds: order._id, status: 'SUCCESS' }).session(
    session,
  );
  const cashier = await UserModel.findById(actorId).session(session);
  const now = new Date();
  const [bill] = await BillModel.create(
    [
      {
        invoiceCode: `HD${now.toISOString().slice(0, 10).replaceAll('-', '')}-${randomShortCode(6)}`,
        pickupOrderId: order._id,
        tableSessionId: null,
        tableId: null,
        tableCode: order.code,
        tableName: order.fulfillmentType === 'PICKUP' ? 'Đặt trước nhận tại quầy' : 'Mang đi',
        cashierName: cashier?.name ?? 'Nhân viên',
        source: order.pickup?.createdBy ? 'STAFF' : 'GUEST',
        openedAt: order.createdAt,
        closedAt: now,
        closedBy: actorId,
        participants: [order.participantId],
        orders: [{ ...order.toObject(), orderId: order._id }],
        subtotal: order.subtotal ?? order.total,
        total: order.total,
        paidAmount: payments.reduce((sum, p) => sum + p.amount, 0),
        paymentIds: payments.map((p) => p._id),
        payments: payments.map((p) => ({
          paymentId: p._id,
          method: p.method,
          amount: p.amount,
          paidAt: p.paidAt,
        })),
      },
    ],
    { session },
  );
  return bill!;
}
