import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

// Quantities are integers in 1/1000 of the ingredient's base unit.
const schema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    unit: { type: String, enum: ['g', 'ml', 'unit'], required: true },
    onHand: { type: Number, min: 0, default: 0, required: true },
    reserved: { type: Number, min: 0, default: 0, required: true },
    lowStockThreshold: { type: Number, min: 0, default: 0 },
    isActive: { type: Boolean, default: true },
    version: { type: Number, default: 0 },
  },
  { timestamps: true },
);
export type IngredientDoc = HydratedDocument<InferSchemaType<typeof schema>>;
export const IngredientModel = model('Ingredient', schema);
