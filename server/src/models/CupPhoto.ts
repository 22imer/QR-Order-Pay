import { Schema, model } from 'mongoose';
const photoSchema = new Schema(
  {
    owner: { type: String, required: true },
    requestId: { type: String, required: true },
    sourceHash: { type: String, required: true },
    data: { type: Buffer, required: true, select: false },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);
photoSchema.index({ owner: 1, requestId: 1 }, { unique: true });
photoSchema.index({ owner: 1, createdAt: -1 });
photoSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const CupPhotoModel = model('CupPhoto', photoSchema);
const ownerSchema = new Schema({
  _id: String,
  version: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true },
});
ownerSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const CupPhotoOwnerModel = model('CupPhotoOwner', ownerSchema);
const printSchema = new Schema(
  {
    userId: { type: String, required: true },
    requestId: { type: String, required: true },
    hash: { type: String, required: true },
    orderId: { type: Schema.Types.ObjectId, required: true },
    itemIndex: { type: Number, required: true },
    copies: { type: Number, required: true },
    paper: { type: String, required: true },
  },
  { timestamps: true },
);
printSchema.index({ userId: 1, requestId: 1 }, { unique: true });
printSchema.index({ orderId: 1, itemIndex: 1 });
export const CupPrintAttemptModel = model('CupPrintAttempt', printSchema);
