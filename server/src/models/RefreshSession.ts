import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const refreshSessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    authVersion: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    userAgent: { type: String },
    ip: { type: String },
  },
  { timestamps: true },
);
refreshSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type RefreshSessionDoc = HydratedDocument<InferSchemaType<typeof refreshSessionSchema>>;
export const RefreshSessionModel = model('RefreshSession', refreshSessionSchema);
