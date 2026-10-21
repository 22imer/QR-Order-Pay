import { z } from 'zod';
import { placeOrderRequestSchema, guestOrderSchema } from './schemas.js';
import { memberPhoneSchema } from './promotions.js';

export const pickupDetailsSchema = z
  .object({
    fulfillmentType: z.enum(['TAKEAWAY', 'PICKUP']),
    name: z.string().trim().min(1).max(80),
    phone: memberPhoneSchema,
    scheduledAt: z.string().datetime({ offset: true }).nullable().default(null),
  })
  .strict()
  .superRefine((v, ctx) => {
    if ((v.fulfillmentType === 'PICKUP') !== (v.scheduledAt !== null))
      ctx.addIssue({
        code: 'custom',
        path: ['scheduledAt'],
        message: 'Đặt trước cần giờ nhận; mang đi ngay không có giờ hẹn.',
      });
  });
export const pickupCreateSchema = placeOrderRequestSchema
  .extend({
    items: placeOrderRequestSchema.shape.items.max(50),
    pickup: pickupDetailsSchema,
    requestId: z.string().uuid(),
  })
  .strict();
export const pickupActionSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    reason: z.string().trim().min(3).max(280),
  })
  .strict();
export const pickupDtoSchema = guestOrderSchema.extend({
  version: z.number().int().nonnegative(),
  pickup: z.object({
    name: z.string(),
    phone: z.string(),
    scheduledAt: z.string().nullable(),
    outcome: z.enum(['ACTIVE', 'COLLECTED', 'NO_SHOW']),
    closedAt: z.string().nullable(),
    reason: z.string(),
  }),
  billId: z.string().nullable(),
});
export type PickupOrder = z.infer<typeof pickupDtoSchema>;
export type PickupCreate = z.infer<typeof pickupCreateSchema>;
