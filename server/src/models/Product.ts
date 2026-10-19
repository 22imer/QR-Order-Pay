import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

const variantSchema = new Schema(
  {
    name: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    isAvailable: { type: Boolean, default: true },
  },
  { _id: true },
);

const allowedOptionsSchema = new Schema(
  {
    sizes: { type: [String], default: [] },
    sugarLevels: { type: [String], default: [] },
    iceLevels: { type: [String], default: [] },
    toppingIds: { type: [Schema.Types.ObjectId], default: [] },
  },
  { _id: false },
);

const ingredientMetadataSchema = new Schema(
  {
    caffeine: { type: Boolean, default: false },
    dairy: { type: Boolean, default: false },
    flavorProfile: { type: [String], default: [] },
    allergens: { type: [String], default: [] },
    notes: { type: String, default: '' },
  },
  { _id: false },
);

export const productSchema = new Schema(
  {
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true, index: true },
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    description: { type: String, default: '' },
    image: { type: String, required: true },
    basePrice: { type: Number, required: true, min: 0 },
    variants: { type: [variantSchema], default: [] },
    allowedOptions: { type: allowedOptionsSchema, default: () => ({}) },
    toppingIds: { type: [Schema.Types.ObjectId], default: [] },
    tags: { type: [String], default: [] },
    ingredientMetadata: { type: ingredientMetadataSchema, default: () => ({}) },
    isAvailable: { type: Boolean, default: true },
    isArchived: { type: Boolean, default: false },
    isFeatured: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
    version: { type: Number, default: 0 },
    inventoryVersion: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export type ProductDoc = HydratedDocument<InferSchemaType<typeof productSchema>>;
export const ProductModel = model('Product', productSchema);
