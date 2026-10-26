import { z } from 'zod';
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Ngày không hợp lệ.');
export const insightsQuerySchema = z
  .object({
    from: date,
    to: date,
    channel: z.enum(['ALL', 'DINE_IN', 'TAKEAWAY', 'PICKUP']).default('ALL'),
  })
  .strict()
  .refine(
    (v) => v.from <= v.to && (Date.parse(v.to) - Date.parse(v.from)) / 86400000 < 93,
    'Chọn từ 1 đến 93 ngày.',
  );
export const companionQuerySchema = z
  .object({
    context: z.enum(['TABLE', 'PICKUP']),
    productIds: z
      .string()
      .max(249)
      .transform((s) => s.split(',').filter(Boolean))
      .pipe(
        z
          .array(
            z
              .string()
              .regex(/^[a-f\d]{24}$/i)
              .transform((s) => s.toLowerCase()),
          )
          .min(1)
          .max(10),
      ),
  })
  .strict();
export type InsightsQuery = z.infer<typeof insightsQuerySchema>;
export interface InsightPair {
  a: string;
  b: string;
  nameA: string;
  nameB: string;
  orders: number;
  ordersA: number;
  ordersB: number;
  confidenceAB: number;
  confidenceBA: number;
  lift: number;
}
export interface InsightsReport {
  from: string;
  to: string;
  channel: InsightsQuery['channel'];
  generatedAt: string;
  sample: {
    orders: number;
    activeDays: number;
    patternOrders: number;
    capped: boolean;
    limit: number;
    skippedLargeBaskets: number;
    minimumOrders: number;
    minimumPairOrders: number;
  };
  summary: { orderValue: number; cups: number; averageOrderValue: number };
  comparison: {
    from: string;
    to: string;
    orders: number;
    capped: boolean;
    orderChangePct: number | null;
  };
  hours: { hour: number; orders: number; cups: number }[];
  topProducts: {
    productId: string;
    name: string;
    quantity: number;
    orders: number;
    grossValue: number;
    freestyle: boolean;
  }[];
  pairs: InsightPair[];
  margins: {
    totalVariants: number;
    completeVariants: number;
    items: {
      productId: string;
      variantId: string | null;
      name: string;
      size: string | null;
      price: number;
      ingredientCost: number | null;
      grossMargin: number | null;
      marginPct: number | null;
      missing: string[];
    }[];
  };
  advice: { code: string; text: string }[];
}
export interface CompanionResult {
  items: { productId: string; name: string; image: string; unitPrice: number }[];
}
