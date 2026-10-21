import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

export const cashShiftSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    status: { type: String, enum: ['OPEN', 'CLOSED'], default: 'OPEN', required: true },
    openedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    openedByName: { type: String, required: true },
    openedAt: { type: Date, default: Date.now, required: true },
    openingCash: { type: Number, required: true, min: 0 },
    closedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    closedByName: { type: String, default: '' },
    closedAt: { type: Date, default: null },
    countedCash: { type: Number, default: null },
    expectedCash: { type: Number, default: null },
    difference: { type: Number, default: null },
    reconciliationNote: { type: String, default: '', maxlength: 500 },
    version: { type: Number, default: 0 },
  },
  { timestamps: true },
);
cashShiftSchema.index(
  { status: 1 },
  {
    name: 'one_open_cash_shift',
    unique: true,
    partialFilterExpression: { status: 'OPEN' },
  },
);
export type CashShiftDoc = HydratedDocument<InferSchemaType<typeof cashShiftSchema>>;
cashShiftSchema.index({ openedAt: -1 });
cashShiftSchema.index({ closedAt: -1 });
export const CashShiftModel = model('CashShift', cashShiftSchema);
