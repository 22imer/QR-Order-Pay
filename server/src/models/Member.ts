import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
const schema = new Schema(
  {
    phone: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    passwordHash: { type: String, required: true },
    points: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
    version: { type: Number, default: 0 },
    authVersion: { type: Number, default: 0 },
    failedLogins: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
  },
  { timestamps: true },
);
export type MemberDoc = HydratedDocument<InferSchemaType<typeof schema>>;
export const MemberModel = model('Member', schema);
const sessionSchema = new Schema(
  {
    memberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    authVersion: { type: Number, required: true },
    expiresAt: { type: Date, required: true, expires: 0 },
  },
  { timestamps: true },
);
export const MemberSessionModel = model('MemberSession', sessionSchema);
const ledgerSchema = new Schema(
  {
    memberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    orderCode: { type: String, required: true },
    type: { type: String, enum: ['EARN', 'REDEEM', 'RETURN'], required: true },
    points: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
  },
  { timestamps: true },
);
ledgerSchema.index({ orderId: 1, type: 1 }, { unique: true });
ledgerSchema.index({ memberId: 1, createdAt: -1 });
export const PointEntryModel = model('PointEntry', ledgerSchema);
