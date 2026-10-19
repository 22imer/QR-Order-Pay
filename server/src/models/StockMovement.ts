import { Schema, model } from 'mongoose';

const schema = new Schema(
  {
    ingredientId: { type: Schema.Types.ObjectId, ref: 'Ingredient', required: true },
    ingredientName: { type: String, required: true },
    unit: { type: String, required: true },
    type: {
      type: String,
      enum: ['RECEIPT', 'ISSUE', 'ADJUSTMENT', 'RESERVE', 'RELEASE', 'CONSUME'],
      required: true,
    },
    quantity: { type: Number, required: true },
    onHandAfter: { type: Number, required: true },
    reservedAfter: { type: Number, required: true },
    reason: { type: String, required: true },
    orderId: { type: Schema.Types.ObjectId, default: null },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    idempotencyKey: { type: String },
    requestHash: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
schema.index({ ingredientId: 1, createdAt: -1, _id: -1 });
schema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);
export const StockMovementModel = model('StockMovement', schema);
