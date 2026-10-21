import { z } from 'zod';

const objectId = z
  .string()
  .regex(/^[a-f\d]{24}$/i)
  .transform((v) => v.toLowerCase());
const version = z.number().int().nonnegative();
const instant = z.string().datetime({ offset: true });
const reason = z.string().trim().min(3).max(500);
const shiftFields = {
  staffId: objectId,
  label: z.string().trim().min(1).max(80),
  startsAt: instant,
  endsAt: instant,
  note: z.string().trim().max(500).default(''),
};
const validDuration = (v: { startsAt: string; endsAt: string }) => {
  const duration = Date.parse(v.endsAt) - Date.parse(v.startsAt);
  return duration > 0 && duration <= 16 * 3600000;
};
export const workShiftCreateSchema = z
  .object({
    ...shiftFields,
    requestId: z.string().uuid(),
  })
  .strict()
  .refine(validDuration, 'Ca phải dài hơn 0 và không quá 16 giờ.');
export const workShiftUpdateSchema = z
  .object({
    ...shiftFields,
    expectedVersion: version,
  })
  .strict()
  .refine(validDuration, 'Ca phải dài hơn 0 và không quá 16 giờ.');
export const workShiftCancelSchema = z.object({ expectedVersion: version, reason }).strict();
export const workClockSchema = z.object({ expectedVersion: version }).strict();
export const workAttendanceCorrectionSchema = z
  .object({
    expectedVersion: version,
    startsAt: instant,
    endsAt: instant,
    reason,
  })
  .strict()
  .refine((v) => {
    const duration = Date.parse(v.endsAt) - Date.parse(v.startsAt);
    return duration > 0 && duration <= 24 * 3600000;
  }, 'Khoảng chấm công phải dài hơn 0 và không quá 24 giờ.');
export const staffingRuleSchema = z
  .object({
    day: z.number().int().min(1).max(7),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
    minStaff: z.number().int().min(1).max(50),
    label: z.string().trim().min(1).max(80),
  })
  .strict()
  .refine((v) => v.endMinute > v.startMinute, 'Giờ kết thúc phải sau giờ bắt đầu.');
export const staffingPolicySchema = z
  .object({
    expectedVersion: version,
    rules: z.array(staffingRuleSchema).max(100),
    ordersPerStaffHour: z.number().int().min(1).max(100).default(6),
  })
  .strict();

export interface WorkCopyPreview {
  from: string;
  targetFrom: string;
  snapshot: string;
  shifts: Array<{
    sourceId: string;
    staffId: string;
    staffName: string;
    label: string;
    startsAt: string;
    endsAt: string;
    note: string;
  }>;
  conflicts: Array<{ staffName: string; label: string; reason: string }>;
}
export interface WorkforcePeaks {
  from: string;
  until: string;
  weeks: number;
  paidOrders: number;
  minimumOrders: number;
  ordersPerStaffHour: number;
  enoughData: boolean;
  items: Array<{
    day: number;
    hour: number;
    orders: number;
    occurrences: number;
    averageOrders: number;
    recommendedStaff: number;
  }>;
}
export interface WorkforceCash {
  total: number;
  closedCount: number;
  totalDifference: number;
  items: Array<{
    id: string;
    code: string;
    status: 'OPEN' | 'CLOSED';
    openedAt: string;
    closedAt: string | null;
    openedByName: string;
    closedByName: string;
    expectedCash: number | null;
    countedCash: number | null;
    difference: number | null;
    reconciliationNote: string;
  }>;
}
export const workWeekQuerySchema = z
  .object({
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((v) => {
        const d = new Date(`${v}T00:00:00+07:00`);
        return (
          Number.isFinite(d.getTime()) &&
          new Date(d.getTime() + 7 * 3600000).toISOString().slice(0, 10) === v
        );
      }, 'Ngày không hợp lệ.'),
  })
  .strict();

const copyFields = {
  from: workWeekQuerySchema.shape.from,
  targetFrom: workWeekQuerySchema.shape.from,
};
const validCopyWeek = (v: { from: string; targetFrom: string }) => {
  const offset =
    Date.parse(`${v.targetFrom}T00:00:00+07:00`) - Date.parse(`${v.from}T00:00:00+07:00`);
  return offset >= 7 * 86400000 && offset % (7 * 86400000) === 0;
};
const copyMessage = 'Tuần đích phải sau tuần nguồn ít nhất 7 ngày và cùng thứ bắt đầu.';
export const workCopyPreviewSchema = z
  .object(copyFields)
  .strict()
  .refine(validCopyWeek, copyMessage);
export const workCopyConfirmSchema = z
  .object({
    ...copyFields,
    requestId: z.string().uuid(),
    snapshot: z.string().regex(/^[a-f\d]{64}$/),
  })
  .strict()
  .refine(validCopyWeek, copyMessage);

export interface WorkShiftDto {
  id: string;
  staffId: string;
  staffName: string;
  label: string;
  startsAt: string;
  endsAt: string;
  note: string;
  status: 'SCHEDULED' | 'WORKING' | 'COMPLETED' | 'CANCELLED';
  clockInAt: string | null;
  clockOutAt: string | null;
  effectiveInAt: string | null;
  effectiveOutAt: string | null;
  correctionReason: string;
  correctedByName: string;
  cancelReason: string;
  version: number;
  lateMinutes: number;
  workedMinutes: number | null;
  attendance: 'CANCELLED' | 'UPCOMING' | 'WAITING' | 'ABSENT' | 'WORKING' | 'COMPLETED';
}
export interface WorkforceMetric {
  staffId: string;
  staffName: string;
  scheduledMinutes: number;
  workedMinutes: number;
  openAttendances: number;
  absentShifts: number;
  lateShifts: number;
  confirmed: number;
  preparing: number;
  ready: number;
  served: number;
  outsideShiftActions: number;
  preparationSamples: number;
  averagePreparationMinutes: number | null;
  reviewedOrders: number;
  averageOrderRating: number | null;
}
export interface WorkforceWeek {
  from: string;
  until: string;
  now: string;
  shifts: WorkShiftDto[];
  currentShift: WorkShiftDto | null;
  staff: Array<{ id: string; name: string; isActive: boolean }>;
  policy: {
    version: number;
    rules: z.infer<typeof staffingRuleSchema>[];
    ordersPerStaffHour: number;
  };
  peaks: WorkforcePeaks | null;
  cash: WorkforceCash | null;
  coverage: Array<{
    label: string;
    startsAt: string;
    endsAt: string;
    required: number;
    scheduled: number;
    shortage: number;
    presentNow: number | null;
  }>;
  metrics: WorkforceMetric[];
  shiftMetrics: Array<{
    workShiftId: string;
    confirmed: number;
    preparing: number;
    ready: number;
    served: number;
    preparationSamples: number;
    averagePreparationMinutes: number | null;
    reviewedOrders: number;
    averageOrderRating: number | null;
  }>;
}
