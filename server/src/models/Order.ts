import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { recipeComponentSchema } from './Recipe.js';

const orderItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    variantId: { type: Schema.Types.ObjectId, default: null },
    sizeName: { type: String, default: null },
    sugarLevel: { type: String, required: true },
    iceLevel: { type: String, required: true },
    toppingIds: { type: [Schema.Types.ObjectId], default: [] },
    toppingNamesSnapshot: { type: [String], default: [] },
    note: { type: String, default: '' },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
    nameSnapshot: { type: String, required: true },
    variantNameSnapshot: { type: String, default: '' },
  },
  { _id: false },
);

const statusHistorySchema = new Schema(
  {
    from: { type: String, default: null },
    to: { type: String, required: true },
    at: { type: Date, default: Date.now },
    by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    byParticipantId: { type: String, default: null },
    reason: { type: String, default: '' },
  },
  { _id: false },
);

export const orderSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    fulfillmentType: { type: String, enum: ['DINE_IN', 'TAKEAWAY', 'PICKUP'], default: 'DINE_IN' },
    pickup: {
      type: new Schema({
        name: { type: String, required: true },
        phone: { type: String, required: true },
        scheduledAt: { type: Date, default: null },
        outcome: { type: String, enum: ['ACTIVE', 'COLLECTED', 'NO_SHOW'], default: 'ACTIVE' },
        closedAt: { type: Date, default: null },
        reason: { type: String, default: '' },
        createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      }, { _id: false }),
      default: null,
    },
    tableSessionId: {
      type: Schema.Types.ObjectId,
      ref: 'TableSession',
      default: null,
      index: true,
    },
    participantId: { type: String, required: true, index: true },
    tableId: { type: Schema.Types.ObjectId, ref: 'Table', default: null, index: true },
    items: { type: [orderItemSchema], required: true },
    total: { type: Number, required: true, min: 0 },
    subtotal: { type: Number, default: null },
    memberId: { type: Schema.Types.ObjectId, ref: 'Member', default: null },
    voucherId: { type: Schema.Types.ObjectId, ref: 'Voucher', default: null },
    voucherCode: { type: String, default: '' },
    voucherDiscount: { type: Number, default: 0 },
    pointsDiscount: { type: Number, default: 0 },
    redeemedPoints: { type: Number, default: 0 },
    earnedPoints: { type: Number, default: 0 },
    inventorySnapshot: { type: [recipeComponentSchema], default: [] },
    inventoryState: {
      type: String,
      enum: ['NONE', 'RESERVED', 'CONSUMED', 'RELEASED'],
      default: 'NONE',
    },
    // Null preserves old fully paid orders without a data rewrite.
    paidAmount: { type: Number, min: 0, default: null },
    status: {
      type: String,
      enum: [
        'AWAITING_PAYMENT',
        'PENDING',
        'CONFIRMED',
        'PREPARING',
        'READY',
        'SERVED',
        'CANCELLED',
      ],
      default: 'PENDING',
      required: true,
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: ['UNPAID', 'PAID', 'REFUNDED'],
      default: 'UNPAID',
      index: true,
    },
    statusHistory: { type: [statusHistorySchema], default: [] },
    idempotencyKey: { type: String, required: true },
    requestHash: { type: String, required: true },
    version: { type: Number, default: 0 },
    cancelReason: { type: String, default: '' },
  },
  { timestamps: true },
);

orderSchema.index({ tableSessionId: 1, idempotencyKey: 1 }, { name: 'tableSessionId_1_idempotencyKey_1_dine_in', unique: true, partialFilterExpression: { tableSessionId: { $type: 'objectId' } } });
orderSchema.index({ participantId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { fulfillmentType: { $in: ['TAKEAWAY', 'PICKUP'] } }, name: 'pickup_request_unique' });
orderSchema.index({ fulfillmentType: 1, 'pickup.outcome': 1, 'pickup.scheduledAt': 1, createdAt: -1 });
orderSchema.index({ createdAt: -1, status: 1 });
orderSchema.pre('validate', function () {
  if (this.fulfillmentType === 'DINE_IN' && (!this.tableSessionId || !this.tableId))
    throw new Error('Dine-in orders require a table and session.');
  if (this.fulfillmentType !== 'DINE_IN' && (this.tableSessionId || this.tableId || !this.pickup))
    throw new Error('Pickup orders require pickup details and cannot occupy a table.');
});

export type OrderDoc = HydratedDocument<InferSchemaType<typeof orderSchema>>;
export const OrderModel = model('Order', orderSchema);
