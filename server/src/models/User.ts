import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const userSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['ADMIN', 'STAFF'], required: true },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    authVersion: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export type UserDoc = HydratedDocument<InferSchemaType<typeof userSchema>>;
export const UserModel = model('User', userSchema);
