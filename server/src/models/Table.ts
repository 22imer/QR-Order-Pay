import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const tableSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    capacity: { type: Number, required: true, min: 1 },
    publicTokenHash: { type: String, required: true, unique: true },
    displayTokenHash: { type: String, default: null, select: false },
    qrEpoch: { type: Number, default: 0 },
    staticQrEpoch: { type: Number, default: 0 },
    admissionCount: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export type TableDoc = HydratedDocument<InferSchemaType<typeof tableSchema>>;
export const TableModel = model('Table', tableSchema);
