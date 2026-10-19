import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
const schema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    type: { type: String, enum: ['FIXED', 'PERCENT'], required: true },
    value: { type: Number, required: true },
    minSubtotal: { type: Number, required: true },
    maxDiscount: { type: Number, default: null },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    maxUses: { type: Number, required: true },
    usedCount: { type: Number, default: 0 },
    perMemberLimit: { type: Number, default: null },
    memberRequired: { type: Boolean, default: false },
    allowPointRedemption: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    version: { type: Number, default: 0 },
  },
  { timestamps: true },
);
export type VoucherDoc = HydratedDocument<InferSchemaType<typeof schema>>;
export const VoucherModel = model('Voucher', schema);
const useSchema = new Schema(
  {
    voucherId: { type: Schema.Types.ObjectId, ref: 'Voucher', required: true },
    memberId: { type: Schema.Types.ObjectId, ref: 'Member', default: null },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, unique: true },
    state: { type: String, enum: ['RESERVED', 'CONSUMED', 'RELEASED'], default: 'RESERVED' },
  },
  { timestamps: true },
);
useSchema.index({ voucherId: 1, memberId: 1, state: 1 });
export const VoucherUseModel = model('VoucherUse', useSchema);
