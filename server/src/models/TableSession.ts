import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const tableSessionSchema = new Schema(
  {
    tableId: { type: Schema.Types.ObjectId, ref: 'Table', required: true, index: true },
    status: { type: String, enum: ['OPEN', 'CHECKOUT', 'CLOSED'], default: 'OPEN', required: true },
    startedAt: { type: Date, default: Date.now, required: true },
    closedAt: { type: Date, default: null },
    openedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    closedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    source: { type: String, enum: ['STAFF', 'GUEST'], default: 'STAFF', required: true },
    billId: { type: Schema.Types.ObjectId, ref: 'Bill', default: null },
    closedReason: { type: String, enum: ['PAID', 'STAFF', 'IDLE'], default: null },
    version: { type: Number, default: 0 },
    collectionOwner: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    collectionOwnerName: { type: String, default: '' },
    collectionTokenHash: { type: String, default: '', select: false },
    collectionExpiresAt: { type: Date, default: null },
    tableTransfers: {
      type: [
        {
          fromTableId: Schema.Types.ObjectId,
          toTableId: Schema.Types.ObjectId,
          by: Schema.Types.ObjectId,
          at: Date,
          _id: false,
        },
      ],
      default: [],
    },
  },
  { timestamps: true },
);

// only one OPEN/CHECKOUT session per table
tableSessionSchema.index(
  { tableId: 1 },
  {
    name: 'one_active_session_per_table',
    unique: true,
    partialFilterExpression: { status: { $in: ['OPEN', 'CHECKOUT'] } },
  },
);

export type TableSessionDoc = HydratedDocument<InferSchemaType<typeof tableSessionSchema>>;
export const TableSessionModel = model('TableSession', tableSessionSchema);
