import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

const playerSchema = new Schema(
  {
    publicId: { type: String, required: true },
    participantId: { type: String, required: true },
    name: { type: String, required: true },
    managedByHost: { type: Boolean, default: false },
  },
  { _id: false },
);
const roundSchema = new Schema(
  {
    tableSessionId: { type: Schema.Types.ObjectId, required: true },
    hostParticipantId: { type: String, required: true },
    requestId: { type: String, required: true },
    requestHash: { type: String, required: true },
    status: {
      type: String,
      enum: ['WAITING', 'DRAWN', 'CANCELLED', 'EXPIRED'],
      required: true,
      default: 'WAITING',
    },
    players: { type: [playerSchema], required: true },
    version: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
    winnerId: { type: String, default: null },
    spinStartsAt: { type: Date, default: null },
    revealsAt: { type: Date, default: null },
  },
  { timestamps: true },
);
roundSchema.index({ tableSessionId: 1, hostParticipantId: 1, requestId: 1 }, { unique: true });
roundSchema.index(
  { tableSessionId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'WAITING' },
    name: 'one_waiting_game_per_session',
  },
);
roundSchema.index({ tableSessionId: 1, createdAt: -1, _id: -1 });
export type MiniGameDoc = HydratedDocument<InferSchemaType<typeof roundSchema>>;
export const MiniGameRoundModel = model('MiniGameRound', roundSchema);

const actionSchema = new Schema(
  {
    roundId: { type: Schema.Types.ObjectId, required: true },
    actorParticipantId: { type: String, required: true },
    requestId: { type: String, required: true },
    requestHash: { type: String, required: true },
  },
  { timestamps: true },
);
actionSchema.index({ roundId: 1, actorParticipantId: 1, requestId: 1 }, { unique: true });
export const MiniGameActionModel = model('MiniGameAction', actionSchema);
