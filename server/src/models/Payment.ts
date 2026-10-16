import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const paymentSchema = new Schema(
  {
    tableSessionId: {
      type: Schema.Types.ObjectId,
      ref: 'TableSession',
      required: true,
      index: true,
    },
    shiftId: { type: Schema.Types.ObjectId, ref: 'CashShift', default: null, index: true },
    orderIds: { type: [Schema.Types.ObjectId], default: [], index: true },
    amount: { type: Number, required: true, min: 0 },
    method: { type: String, enum: ['CASH', 'BANK_TRANSFER', 'OTHER'], default: 'CASH' },
    status: { type: String, enum: ['SUCCESS', 'REFUNDED'], default: 'SUCCESS' },
    confirmedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    paidAt: { type: Date, default: Date.now, index: true },
    idempotencyKey: { type: String, required: true, unique: true },
    note: { type: String, default: '' },
    version: { type: Number, default: 0 },
    replacesPaymentId: { type: Schema.Types.ObjectId, ref: 'Payment', default: null },
    reversalKind: { type: String, enum: ['VOID', 'METHOD', 'TRANSFER'], default: null },
    refundShiftId: { type: Schema.Types.ObjectId, ref: 'CashShift', default: null },
    refundMethod: { type: String, enum: ['CASH', 'BANK_TRANSFER', 'OTHER'], default: null },
    refundedAt: { type: Date, default: null },
    refundedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    refundReason: { type: String, default: '' },
  },
  { timestamps: true },
);

export type PaymentDoc = HydratedDocument<InferSchemaType<typeof paymentSchema>>;
export const PaymentModel = model('Payment', paymentSchema);
