import { z } from 'zod';

export const memberPhoneSchema = z
  .string()
  .trim()
  .max(24)
  .transform((v) => v.replace(/[\s().-]/g, '').replace(/^\+84/, '0'))
  .pipe(z.string().regex(/^0[35789]\d{8}$/, 'SĐT di động Việt Nam không hợp lệ.'));
export const memberPasswordSchema = z
  .string()
  .min(8, 'Mật khẩu cần ít nhất 8 ký tự.')
  .max(64)
  .refine((v) => new TextEncoder().encode(v).length <= 72, 'Mật khẩu quá dài.');
export const memberRegisterSchema = z
  .object({
    phone: memberPhoneSchema,
    name: z.string().trim().min(2).max(80),
    password: memberPasswordSchema,
  })
  .strict();
export const memberLoginSchema = z
  .object({ phone: memberPhoneSchema, password: z.string().min(1).max(128) })
  .strict();
export const memberChangePasswordSchema = z
  .object({ currentPassword: z.string().min(1).max(128), password: memberPasswordSchema })
  .strict();
export const memberAdminUpdateSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    isActive: z.boolean().optional(),
    password: memberPasswordSchema.optional(),
  })
  .strict()
  .refine((v) => v.isActive !== undefined || v.password !== undefined, 'Chưa có thay đổi.');
export const memberDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  points: z.number().int().nonnegative(),
  isActive: z.boolean(),
  version: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type MemberDto = z.infer<typeof memberDtoSchema>;
export const pointEntrySchema = z.object({
  id: z.string(),
  orderCode: z.string(),
  type: z.enum(['EARN', 'REDEEM', 'RETURN']),
  points: z.number().int(),
  balanceAfter: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type PointEntry = z.infer<typeof pointEntrySchema>;
export const voucherCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9_-]{3,32}$/, 'Mã gồm 3–32 chữ, số, dấu _ hoặc -.');
const voucherFields = {
  code: voucherCodeSchema,
  name: z.string().trim().min(2).max(100),
  type: z.enum(['FIXED', 'PERCENT']),
  value: z.number().int().positive().max(100000000),
  minSubtotal: z.number().int().nonnegative().max(100000000),
  maxDiscount: z.number().int().positive().max(100000000).nullable(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  maxUses: z.number().int().positive().max(1000000),
  perMemberLimit: z.number().int().positive().max(1000000).nullable(),
  memberRequired: z.boolean(),
  allowPointRedemption: z.boolean().default(false),
  isActive: z.boolean(),
};
const validVoucher = (v: {
  type: string;
  value: number;
  startsAt: string;
  endsAt: string;
  memberRequired: boolean;
  perMemberLimit: number | null;
}) =>
  (v.type !== 'PERCENT' || v.value <= 100) &&
  new Date(v.endsAt) > new Date(v.startsAt) &&
  (!v.perMemberLimit || v.memberRequired);
export const voucherCreateSchema = z
  .object(voucherFields)
  .strict()
  .refine(validVoucher, 'Kiểm tra % giảm, thời hạn và điều kiện thành viên.');
export const voucherUpdateSchema = z
  .object({ ...voucherFields, expectedVersion: z.number().int().nonnegative() })
  .strict()
  .refine(validVoucher, 'Kiểm tra % giảm, thời hạn và điều kiện thành viên.');
export const voucherDtoSchema = z.object({
  ...voucherFields,
  id: z.string(),
  usedCount: z.number().int().nonnegative(),
  version: z.number().int().nonnegative(),
});
export type VoucherDto = z.infer<typeof voucherDtoSchema>;
export type VoucherInput = z.infer<typeof voucherCreateSchema>;
export const benefitSelectionSchema = z.object({
  voucherCode: voucherCodeSchema.optional(),
  redeemPoints: z.number().int().min(0).max(1000000).optional(),
});
export const benefitBreakdownSchema = z.object({
  subtotal: z.number().int().nonnegative().optional(),
  voucherCode: z.string().optional(),
  voucherDiscount: z.number().int().nonnegative().optional(),
  pointsDiscount: z.number().int().nonnegative().optional(),
  redeemedPoints: z.number().int().nonnegative().optional(),
  earnedPoints: z.number().int().nonnegative().optional(),
});
export const LOYALTY_RULES = {
  earnEveryVnd: 10000,
  redeemValueVnd: 1000,
  maxRedeemPercent: 50,
} as const;
