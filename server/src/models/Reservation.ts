import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

const schema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    actorId: { type: Schema.Types.ObjectId, required: true },
    actorType: { type: String, enum: ['MEMBER', 'STAFF'], required: true },
    memberId: { type: Schema.Types.ObjectId, ref: 'Member', default: null },
    requestId: { type: String, required: true },
    requestHash: { type: String, required: true, select: false },
    tableId: { type: Schema.Types.ObjectId, ref: 'Table', required: true },
    tableName: { type: String, required: true },
    partySize: { type: Number, required: true, min: 1, max: 30 },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    arrivalDeadline: { type: Date, required: true },
    name: { type: String, required: true },
    phone: { type: String, required: true },
    note: { type: String, default: '' },
    status: {
      type: String,
      enum: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW'],
      default: 'CONFIRMED',
      required: true,
    },
    version: { type: Number, default: 0 },
    tableSessionId: { type: Schema.Types.ObjectId, ref: 'TableSession', default: null },
    checkedInAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    reason: { type: String, default: '' },
  },
  { timestamps: true },
);
schema.index({ actorId: 1, actorType: 1, requestId: 1 }, { unique: true });
schema.index({ tableId: 1, status: 1, startsAt: 1, endsAt: 1 });
schema.index({ memberId: 1, status: 1, startsAt: -1 });
schema.index({ status: 1, arrivalDeadline: 1 });
schema.index(
  { tableSessionId: 1 },
  { unique: true, partialFilterExpression: { tableSessionId: { $type: 'objectId' } } },
);
export type ReservationDoc = HydratedDocument<InferSchemaType<typeof schema>>;
export const ReservationModel = model('Reservation', schema);
