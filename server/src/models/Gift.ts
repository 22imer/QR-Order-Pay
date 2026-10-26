import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

const item = new Schema(
  {
    productId: { type: String, required: true },
    variantId: { type: String, default: null },
    sugarLevel: { type: String, required: true },
    iceLevel: { type: String, required: true },
    toppingIds: { type: [String], default: [] },
    note: { type: String, default: '' },
    quantity: { type: Number, required: true },
    cupPhotoId: { type: String, default: undefined },
    freestyleToken: { type: String, default: undefined },
    name: { type: String, required: true },
    variantName: { type: String, default: '' },
    toppingNames: { type: [String], default: [] },
  },
  { _id: false },
);
const schema = new Schema(
  {
    senderSessionId: { type: Schema.Types.ObjectId, required: true },
    senderParticipantId: { type: String, required: true },
    showSenderTable: { type: Boolean, default: false },
    senderTableName: { type: String, default: null },
    senderTableCode: { type: String, default: null },
    recipientSessionId: { type: Schema.Types.ObjectId, required: true },
    recipientTableId: { type: Schema.Types.ObjectId, required: true },
    recipientTableName: { type: String, required: true },
    recipientTableCode: { type: String, required: true },
    message: { type: String, default: '' },
    items: { type: [item], required: true },
    requestId: { type: String, required: true },
    requestHash: { type: String, required: true },
    status: {
      type: String,
      enum: ['PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED', 'ORDERED'],
      default: 'PENDING',
      required: true,
    },
    expiresAt: { type: Date, required: true },
    version: { type: Number, default: 0 },
    decidedByParticipantId: { type: String, default: null },
    orderId: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);
schema.index({ senderSessionId: 1, senderParticipantId: 1, requestId: 1 }, { unique: true });
schema.index({ recipientSessionId: 1, createdAt: -1 });
schema.index({ senderSessionId: 1, createdAt: -1 });
schema.index({ status: 1, expiresAt: 1 });
export type GiftDoc = HydratedDocument<InferSchemaType<typeof schema>>;
export const GiftModel = model('Gift', schema);
