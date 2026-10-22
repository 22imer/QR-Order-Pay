import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const billItemSchema = new Schema(
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

export const billOrderSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    gift: {
      type: new Schema(
        { recipientTableName: String, recipientTableCode: String, message: String },
        { _id: false },
      ),
      default: null,
    },
    code: { type: String, required: true },
    status: { type: String, required: true },
    paymentStatus: { type: String, required: true },
    total: { type: Number, required: true, min: 0 },
    subtotal: { type: Number, default: null },
    voucherCode: { type: String, default: '' },
    voucherDiscount: { type: Number, default: 0 },
    pointsDiscount: { type: Number, default: 0 },
    redeemedPoints: { type: Number, default: 0 },
    earnedPoints: { type: Number, default: 0 },
    createdAt: { type: Date, required: true },
    participantId: { type: String, default: null },
    items: { type: [billItemSchema], default: [] },
  },
  { _id: false },
);

// Snapshot bất biến của một phiên đã thanh toán; chỉ ghi một lần, không có API sửa/xoá.
export const billSchema = new Schema(
  {
    invoiceCode: { type: String, unique: true, sparse: true, index: true },
    tableSessionId: {
      type: Schema.Types.ObjectId,
      ref: 'TableSession',
      default: null,
    },
    pickupOrderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
    tableId: { type: Schema.Types.ObjectId, ref: 'Table', default: null, index: true },
    tableCode: { type: String, required: true },
    tableName: { type: String, required: true, default: '' },
    cashierName: { type: String, required: true, default: '' },
    source: { type: String, enum: ['STAFF', 'GUEST'], default: 'STAFF', required: true },
    openedAt: { type: Date, required: true },
    closedAt: { type: Date, required: true },
    openedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    closedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    participants: { type: [String], default: [] },
    orders: { type: [billOrderSchema], default: [] },
    subtotal: { type: Number, required: true },
    total: { type: Number, required: true },
    paidAmount: { type: Number, required: true },
    paymentIds: { type: [Schema.Types.ObjectId], ref: 'Payment', default: [] },
    payments: {
      type: [
        {
          paymentId: Schema.Types.ObjectId,
          method: String,
          amount: Number,
          paidAt: Date,
          _id: false,
        },
      ],
      default: [],
    },
  },
  { timestamps: true },
);

billSchema.index({ createdAt: -1 });
billSchema.index(
  { tableSessionId: 1 },
  {
    name: 'tableSessionId_1_dine_in',
    unique: true,
    partialFilterExpression: { tableSessionId: { $type: 'objectId' } },
  },
);
billSchema.index(
  { pickupOrderId: 1 },
  { unique: true, partialFilterExpression: { pickupOrderId: { $type: 'objectId' } } },
);

export type BillDoc = HydratedDocument<InferSchemaType<typeof billSchema>>;
export const BillModel = model('Bill', billSchema);
