import { z } from 'zod';
const label = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((s) => !/[\p{Cc}\p{Cf}]/u.test(s));
export const FREESTYLE_OPTIONS = 'Theo công thức';
export const freestyleComponentSchema = z
  .object({
    ingredientId: z.string().regex(/^[a-f\d]{24}$/i),
    unit: z.enum(['g', 'ml', 'unit']),
    quantity: z
      .number()
      .positive()
      .max(500)
      .refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6),
  })
  .strict();
const part = z
  .object({
    id: z.string().uuid(),
    name: label,
    components: z.array(freestyleComponentSchema).min(1).max(8),
    instructions: z.string().trim().min(1).max(300),
    caffeine: z.boolean().nullable(),
    dairy: z.boolean().nullable(),
    tags: z.array(label).max(8),
    enabled: z.boolean(),
  })
  .strict();
export const freestyleSettingsSchema = z
  .object({
    enabled: z.boolean(),
    price: z.number().int().min(0).max(1000000),
    sizeName: label,
    sizeMl: z.number().int().min(250).max(700),
    bases: z
      .array(
        part
          .extend({
            allowedFlavorIds: z.array(z.string().uuid()).max(12),
            maxFlavors: z.number().int().min(1).max(2),
          })
          .strict(),
      )
      .max(6),
    flavors: z
      .array(part.extend({ conflictsWith: z.array(z.string().uuid()).max(11) }).strict())
      .max(12),
  })
  .strict()
  .superRefine((v, ctx) => {
    const ids = [...v.bases, ...v.flavors].map((p) => p.id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: 'custom', message: 'Không lặp ID nền/vị.' });
    for (const p of [...v.bases, ...v.flavors]) {
      if (new Set(p.components.map((c) => c.ingredientId)).size !== p.components.length)
        ctx.addIssue({ code: 'custom', message: 'Không lặp nguyên liệu trong một nền/vị.' });
    }
    const flavorIds = new Set(v.flavors.map((p) => p.id));
    for (const b of v.bases)
      if (
        new Set(b.allowedFlavorIds).size !== b.allowedFlavorIds.length ||
        b.allowedFlavorIds.some((id) => !flavorIds.has(id))
      )
        ctx.addIssue({ code: 'custom', message: 'Vị được phép phải tồn tại và không lặp.' });
    for (const f of v.flavors)
      if (
        new Set(f.conflictsWith).size !== f.conflictsWith.length ||
        f.conflictsWith.some((id) => id === f.id || !flavorIds.has(id))
      )
        ctx.addIssue({ code: 'custom', message: 'Vị xung khắc không hợp lệ.' });
    if (
      v.enabled &&
      (v.price < 1000 ||
        !v.bases.some(
          (b) =>
            b.enabled &&
            b.allowedFlavorIds.some((id) => v.flavors.some((f) => f.id === id && f.enabled)),
        ))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Đặt giá từ 1.000đ và ít nhất một nền/vị đã bật trước khi mở bán.',
      });
  });
export type FreestyleSettings = z.infer<typeof freestyleSettingsSchema>;
export const freestyleSaveSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedVersion: z.number().int().nonnegative(),
    settings: freestyleSettingsSchema,
  })
  .strict();
export const freestyleAskSchema = z
  .object({
    context: z.enum(['TABLE', 'PICKUP']),
    prompt: z.string().trim().min(1).max(500),
    maxBudget: z.number().int().positive().max(10000000).optional(),
    preferences: z
      .object({
        noCaffeine: z.boolean().optional(),
        noDairy: z.boolean().optional(),
        lowSugar: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const freestyleValidateSchema = z
  .object({
    context: z.enum(['TABLE', 'PICKUP']),
    productId: z.string().regex(/^[a-f\d]{24}$/i),
    token: z.string().min(20).max(8192),
  })
  .strict();
export interface FreestyleView {
  name: string;
  instructions: string;
  caffeine: boolean | null;
  dairy: boolean | null;
  components: { name: string; unit: 'g' | 'ml' | 'unit'; quantity: number }[];
}
export interface FreestyleRecommendation extends FreestyleView {
  productId: string;
  token: string;
  unitPrice: number;
  sizeName: string;
  sizeMl: number;
  reason: string;
  expiresAt: string;
}
export interface FreestyleResult {
  mode: 'llm' | 'fallback' | 'off';
  message: string;
  recommendations: FreestyleRecommendation[];
}
export interface FreestyleCatalog {
  enabled: boolean;
  price: number;
  sizeName: string;
  sizeMl: number;
  bases: string[];
  flavors: string[];
}
