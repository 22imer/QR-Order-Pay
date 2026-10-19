import { z } from 'zod';

export const inventoryIdSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'ID không hợp lệ.')
  .transform((v) => v.toLowerCase());
// Public quantities use g/ml/unit with at most three decimal places.
export const inventoryQuantitySchema = z
  .number()
  .finite()
  .min(0)
  .max(1_000_000_000)
  .refine((n) => n === Math.round(n * 1000) / 1000, 'Tối đa 3 chữ số thập phân.');
const version = z.number().int().nonnegative();
export const ingredientCreateSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{1,32}$/),
    name: z.string().trim().min(1).max(100),
    unit: z.enum(['g', 'ml', 'unit']),
    lowStockThreshold: inventoryQuantitySchema.default(0),
  })
  .strict();
export const ingredientUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    lowStockThreshold: inventoryQuantitySchema,
    isActive: z.boolean(),
    expectedVersion: version,
  })
  .strict();
export const stockMovementRequestSchema = z
  .object({
    type: z.enum(['RECEIPT', 'ISSUE', 'ADJUSTMENT']),
    quantity: inventoryQuantitySchema,
    reason: z.string().trim().min(3).max(280),
    expectedVersion: version,
    idempotencyKey: z.string().min(8).max(64),
  })
  .strict()
  .refine((v) => v.type === 'ADJUSTMENT' || v.quantity > 0, {
    message: 'Số lượng nhập/xuất phải lớn hơn 0.',
    path: ['quantity'],
  });
const component = z
  .object({
    ingredientId: inventoryIdSchema,
    quantity: inventoryQuantitySchema.refine((v) => v > 0, 'Định lượng phải lớn hơn 0.'),
  })
  .strict();
const components = z
  .array(component)
  .max(100)
  .refine(
    (items) => new Set(items.map((i) => i.ingredientId.toLowerCase())).size === items.length,
    'Không lặp nguyên liệu trong cùng công thức.',
  );
export const recipeSaveSchema = z
  .object({
    enabled: z.boolean(),
    components,
    variants: z
      .array(
        z
          .object({
            variantId: inventoryIdSchema,
            components: components.refine((v) => v.length > 0, 'Cần ít nhất một nguyên liệu.'),
          })
          .strict(),
      )
      .max(30),
    expectedVersion: version,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.enabled && v.components.length === 0)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Công thức bật cần nguyên liệu nền.',
        path: ['components'],
      });
    if (new Set(v.variants.map((i) => i.variantId.toLowerCase())).size !== v.variants.length)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Không lặp size.', path: ['variants'] });
  });

export type IngredientCreateInput = z.infer<typeof ingredientCreateSchema>;
export type IngredientUpdateInput = z.infer<typeof ingredientUpdateSchema>;
export type StockMovementInput = z.infer<typeof stockMovementRequestSchema>;
export type RecipeSaveInput = z.infer<typeof recipeSaveSchema>;
export interface IngredientDto {
  id: string;
  code: string;
  name: string;
  unit: 'g' | 'ml' | 'unit';
  onHand: number;
  reserved: number;
  available: number;
  lowStockThreshold: number;
  isLowStock: boolean;
  isActive: boolean;
  version: number;
}
export interface RecipeDto extends Omit<RecipeSaveInput, 'expectedVersion'> {
  id: string;
  targetType: 'PRODUCT' | 'TOPPING';
  targetId: string;
  version: number;
}
export interface StockMovementDto {
  id: string;
  ingredientId: string;
  ingredientName: string;
  unit: string;
  type: 'RECEIPT' | 'ISSUE' | 'ADJUSTMENT' | 'RESERVE' | 'RELEASE' | 'CONSUME';
  quantity: number;
  onHandAfter: number;
  reservedAfter: number;
  reason: string;
  orderId: string | null;
  actorName: string;
  createdAt: string;
}
