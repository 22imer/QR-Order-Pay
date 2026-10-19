import { Schema, model, type InferSchemaType } from 'mongoose';

export const recipeComponentSchema = new Schema(
  {
    ingredientId: { type: Schema.Types.ObjectId, ref: 'Ingredient', required: true },
    quantity: { type: Number, min: 1, required: true },
  },
  { _id: false },
);
const variantSchema = new Schema(
  {
    variantId: { type: Schema.Types.ObjectId, required: true },
    components: { type: [recipeComponentSchema], default: [] },
  },
  { _id: false },
);
const schema = new Schema(
  {
    targetType: { type: String, enum: ['PRODUCT', 'TOPPING'], required: true },
    targetId: { type: Schema.Types.ObjectId, required: true },
    enabled: { type: Boolean, default: false },
    components: { type: [recipeComponentSchema], default: [] },
    variants: { type: [variantSchema], default: [] },
    version: { type: Number, default: 0 },
  },
  { timestamps: true },
);
schema.index({ targetType: 1, targetId: 1 }, { unique: true });
export type RecipeData = InferSchemaType<typeof schema>;
export const RecipeModel = model('Recipe', schema);
