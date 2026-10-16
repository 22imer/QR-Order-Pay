import { Schema, model } from 'mongoose';

const schema = new Schema(
  {
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', required: true },
    paymentVersion: { type: Number, required: true },
    kind: { type: String, enum: ['VOID', 'METHOD', 'TRANSFER'], required: true },
    reason: { type: String, required: true },
    method: { type: String, enum: ['CASH', 'BANK_TRANSFER', 'OTHER'], default: null },
    targetOrderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
    status: { type: String, enum: ['REQUESTED', 'APPROVED', 'REJECTED'], default: 'REQUESTED' },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    requestedByName: { type: String, required: true },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decidedByName: { type: String, default: '' },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, default: '' },
    replacementPaymentId: { type: Schema.Types.ObjectId, ref: 'Payment', default: null },
    version: { type: Number, default: 0 },
  },
  { timestamps: true },
);
schema.index({ paymentId: 1 }, { unique: true, partialFilterExpression: { status: 'REQUESTED' } });
export const PaymentCorrectionModel = model('PaymentCorrection', schema);
