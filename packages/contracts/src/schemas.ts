import { z } from 'zod';
import { benefitSelectionSchema, benefitBreakdownSchema } from './promotions.js';

export const moneyVndSchema = z.number().int().nonnegative();

export const realtimeEventTypeSchema = z.enum([
  'workforce.changed',
  'order.created',
  'order.statusChanged',
  'menu.availabilityChanged',
  'serviceRequest.created',
  'serviceRequest.resolved',
  'payment.confirmed',
  'tableSession.statusChanged',
  'cancelRequest.created',
  'cancelRequest.resolved',
]);
export type RealtimeEventType = z.infer<typeof realtimeEventTypeSchema>;

export const realtimeEventEnvelopeSchema = z.object({
  eventId: z.string().min(1),
  eventType: realtimeEventTypeSchema,
  schemaVersion: z.number().int().positive(),
  entityId: z.string().min(1),
  entityVersion: z.number().int().nonnegative(),
  occurredAt: z.string().datetime(),
  data: z.unknown(),
});
export type RealtimeEventEnvelope = z.infer<typeof realtimeEventEnvelopeSchema>;

export const apiSuccessSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    success: z.literal(true),
    data,
    meta: z
      .object({
        page: z.number().int().optional(),
        limit: z.number().int().optional(),
        total: z.number().int().optional(),
      })
      .optional(),
    requestId: z.string().optional(),
  });

export const apiErrorSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.unknown()).optional(),
  }),
  requestId: z.string().optional(),
});

export const errorCode = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  CONFLICT: 'CONFLICT',
  TABLE_LOCKED: 'TABLE_LOCKED',
  TABLE_SESSION_CLOSED: 'TABLE_SESSION_CLOSED',
  TABLE_SESSION_CHECKOUT: 'TABLE_SESSION_CHECKOUT',
  TABLE_SESSION_NOT_OPEN: 'TABLE_SESSION_NOT_OPEN',
  PRODUCT_UNAVAILABLE: 'PRODUCT_UNAVAILABLE',
  PRICE_CHANGED: 'PRICE_CHANGED',
  QUOTE_CHANGED: 'QUOTE_CHANGED',
  INVALID_OPTIONS: 'INVALID_OPTIONS',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  STATE_TRANSITION_INVALID: 'STATE_TRANSITION_INVALID',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof errorCode)[keyof typeof errorCode];

export const orderStatusSchema = z.enum([
  'AWAITING_PAYMENT',
  'PENDING',
  'CONFIRMED',
  'PREPARING',
  'READY',
  'SERVED',
  'CANCELLED',
]);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

export const paymentStatusSchema = z.enum(['UNPAID', 'PAID', 'REFUNDED']);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

export const paymentMethodSchema = z.enum(['CASH', 'BANK_TRANSFER', 'OTHER']);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const paymentRequestSchema = z.object({
  amount: moneyVndSchema,
  method: paymentMethodSchema,
  expectedVersion: z.number().int().nonnegative(),
  note: z.string().max(280).optional(),
});
export type PaymentRequest = z.infer<typeof paymentRequestSchema>;

export const paymentClaimRequestSchema = z.object({ token: z.string().min(16).max(128) });
export const paymentCorrectionRequestSchema = z
  .object({
    kind: z.enum(['VOID', 'METHOD', 'TRANSFER']),
    reason: z.string().trim().min(3).max(280),
    method: paymentMethodSchema.optional(),
    targetOrderId: z
      .string()
      .regex(/^[a-f\d]{24}$/i)
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'METHOD' && !value.method)
      ctx.addIssue({ code: 'custom', path: ['method'], message: 'Chọn phương thức đúng.' });
    if (value.kind === 'TRANSFER' && !value.targetOrderId)
      ctx.addIssue({
        code: 'custom',
        path: ['targetOrderId'],
        message: 'Chọn đơn nhận khoản thu.',
      });
  });
export const paymentCorrectionDecisionSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  approve: z.boolean(),
  note: z.string().trim().min(3).max(280),
});

export const orderPaymentRequestSchema = paymentRequestSchema;
export const dynamicQrResponseSchema = z.object({
  tableId: z.string(),
  tableName: z.string(),
  url: z.string().url(),
  expiresAt: z.number().int(),
  serverTime: z.number().int(),
});
export type DynamicQrResponse = z.infer<typeof dynamicQrResponseSchema>;

export const tableSessionStatusSchema = z.enum(['OPEN', 'CHECKOUT', 'CLOSED']);
export type TableSessionStatus = z.infer<typeof tableSessionStatusSchema>;

export const tableSummarySchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  capacity: z.number().int().positive().optional(),
});

export const joinTableResponseSchema = z.object({
  guestSessionId: z.string(),
  participantId: z.string(),
  tableSessionId: z.string(),
  created: z.boolean(),
  table: tableSummarySchema.extend({ capacity: z.number().int().positive() }),
  tableSession: z.object({
    id: z.string(),
    status: tableSessionStatusSchema,
    startedAt: z.union([z.string(), z.date().transform((value) => value.toISOString())]),
  }),
});
export type JoinTableResponse = z.infer<typeof joinTableResponseSchema>;

export const currentTableSessionResponseSchema = z.discriminatedUnion('active', [
  z.object({
    active: z.literal(true),
    tableSessionId: z.string(),
    participantId: z.string(),
    status: tableSessionStatusSchema.optional(),
    table: tableSummarySchema.omit({ capacity: true }).nullable(),
  }),
  z.object({
    active: z.literal(false),
    receiptAvailable: z.boolean(),
  }),
]);
export type CurrentTableSessionResponse = z.infer<typeof currentTableSessionResponseSchema>;

export const updateTableSessionStatusRequestSchema = z.object({
  status: tableSessionStatusSchema,
  expectedVersion: z.number().int().nonnegative(),
});
export const transferTableSessionRequestSchema = z.object({
  targetTableId: z.string().min(1),
  expectedVersion: z.number().int().nonnegative(),
});

export const roleSchema = z.enum(['ADMIN', 'STAFF']);
export type Role = z.infer<typeof roleSchema>;

export const toppingSchema = z.object({
  id: z.string(),
  name: z.string(),
  price: moneyVndSchema,
  isAvailable: z.boolean(),
});

export const productVariantSchema = z.object({
  id: z.string(),
  name: z.string(),
  price: moneyVndSchema,
  isAvailable: z.boolean().optional(),
});

export const productSchema = z.object({
  id: z.string(),
  categoryId: z.string(),
  name: z.string(),
  description: z.string(),
  image: z.string(),
  basePrice: moneyVndSchema,
  variants: z.array(productVariantSchema),
  allowedOptions: z.object({
    sizes: z.array(z.string()),
    sugarLevels: z.array(z.string()),
    iceLevels: z.array(z.string()),
    toppingIds: z.array(z.string()),
  }),
  tags: z.array(z.string()),
  ingredientMetadata: z.object({
    caffeine: z.boolean().optional(),
    dairy: z.boolean().optional(),
    flavorProfile: z.array(z.string()).optional(),
  }),
  isAvailable: z.boolean(),
  isArchived: z.boolean(),
  isFeatured: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export const categorySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
});

export const tableSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  capacity: z.number().int(),
  isActive: z.boolean(),
});

export const orderItemSchema = z.object({
  productId: z.string(),
  variantId: z.string().nullable(),
  sizeName: z.string().nullable(),
  sugarLevel: z.string(),
  iceLevel: z.string(),
  toppingIds: z.array(z.string()),
  note: z.string().max(280).optional(),
  quantity: z.number().int().positive(),
  unitPrice: moneyVndSchema,
  lineTotal: moneyVndSchema,
  nameSnapshot: z.string(),
});

export const orderSchema = z.object({
  ...benefitBreakdownSchema.shape,
  id: z.string(),
  code: z.string(),
  tableSessionId: z.string().nullable(),
  participantId: z.string(),
  items: z.array(orderItemSchema),
  total: moneyVndSchema,
  status: orderStatusSchema,
  paymentStatus: paymentStatusSchema,
  paidAmount: moneyVndSchema.optional(),
  balanceDue: moneyVndSchema.optional(),
  statusHistory: z.array(
    z.object({
      from: orderStatusSchema.nullable(),
      to: orderStatusSchema,
      at: z.string(),
      by: z.string().nullable(),
      reason: z.string().optional(),
    }),
  ),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// DTO đơn trả qua API: liệt kê field tường minh để không lộ idempotencyKey/requestHash/__v.
const orderDtoItemSchema = orderItemSchema.extend({
  note: z.string(),
  toppingNamesSnapshot: z.array(z.string()),
  variantNameSnapshot: z.string(),
});
const orderDtoBaseSchema = z.object({
  fulfillmentType: z.enum(['DINE_IN', 'TAKEAWAY', 'PICKUP']).optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  ...benefitBreakdownSchema.shape,
  _id: z.string(),
  code: z.string(),
  tableSessionId: z.string().nullable(),
  participantId: z.string(),
  items: z.array(orderDtoItemSchema),
  total: moneyVndSchema,
  paidAmount: moneyVndSchema.optional(),
  balanceDue: moneyVndSchema.optional(),
  status: orderStatusSchema,
  paymentStatus: paymentStatusSchema,
  cancelReason: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const orderReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
});
export type OrderReview = z.infer<typeof orderReviewSchema>;

export const guestOrderSchema = orderDtoBaseSchema.extend({
  review: orderReviewSchema.nullable().default(null),
  statusHistory: z.array(
    z.object({
      from: orderStatusSchema.nullable(),
      to: orderStatusSchema,
      at: z.string(),
      reason: z.string(),
    }),
  ),
});
export type GuestOrder = z.infer<typeof guestOrderSchema>;
export const staffOrderSchema = orderDtoBaseSchema.extend({
  collectionClaim: z
    .object({ ownerId: z.string(), ownerName: z.string(), expiresAt: z.string() })
    .nullable()
    .optional(),
  tableId: z.string().nullable(),
  version: z.number().int().nonnegative(),
  tableName: z.string().optional(),
  tableCode: z.string().optional(),
  statusHistory: z.array(
    z.object({
      from: orderStatusSchema.nullable(),
      to: orderStatusSchema,
      at: z.string(),
      by: z.string().nullable(),
      byParticipantId: z.string().nullable(),
      reason: z.string(),
    }),
  ),
});
export type StaffOrder = z.infer<typeof staffOrderSchema>;

export const tableSessionSchema = z.object({
  id: z.string(),
  tableId: z.string(),
  status: tableSessionStatusSchema,
  startedAt: z.string(),
  closedAt: z.string().nullable(),
});

export const joinTableRequestSchema = z.object({
  tableToken: z.string().min(8),
});

export const placeOrderRequestSchema = z.object({
  ...benefitSelectionSchema.shape,
  items: z
    .array(
      z.object({
        productId: z.string(),
        variantId: z.string().nullable(),
        sugarLevel: z.string(),
        iceLevel: z.string(),
        toppingIds: z.array(z.string()),
        note: z.string().max(280).optional(),
        quantity: z.number().int().positive().max(50),
      }),
    )
    .min(1),
  note: z.string().max(280).optional(),
  quoteToken: z.string().min(20).optional(),
});
export const quoteOrderRequestSchema = placeOrderRequestSchema.omit({ quoteToken: true });
export const orderQuoteResponseSchema = z.object({
  voucherAllowsPoints: z.boolean().optional(),
  maxRedeemPoints: z.number().int().nonnegative().optional(),
  ...benefitBreakdownSchema.shape,
  quoteId: z.string(),
  quoteToken: z.string(),
  expiresAt: z.string().datetime(),
  total: moneyVndSchema,
  items: z.array(
    z.object({
      productId: z.string(),
      variantId: z.string().nullable(),
      name: z.string(),
      variantName: z.string(),
      toppingNames: z.array(z.string()),
      quantity: z.number().int().positive(),
      unitPrice: moneyVndSchema,
      lineTotal: moneyVndSchema,
    }),
  ),
});
export type OrderQuoteResponse = z.infer<typeof orderQuoteResponseSchema>;

export const aiRecommendRequestSchema = z.object({
  prompt: z.string().min(1).max(500),
  maxBudget: z.number().int().positive().optional(),
  preferences: z
    .object({
      noCaffeine: z.boolean().optional(),
      noDairy: z.boolean().optional(),
      lowSugar: z.boolean().optional(),
      flavor: z.string().optional(),
    })
    .optional(),
});

export const aiRecommendResponseSchema = z.object({
  mode: z.enum(['llm', 'fallback']),
  message: z.string(),
  recommendations: z.array(
    z.object({
      productId: z.string(),
      variantId: z.string().nullable(),
      reason: z.string(),
      unitPrice: moneyVndSchema,
      name: z.string(),
      image: z.string(),
    }),
  ),
  followUpQuestion: z.string().optional(),
  latencyMs: z.number().int().optional(),
});

export const menuSearchIntentSchema = z.object({
  normalizedQuery: z.string(),
  keywords: z.array(z.string()),
  requirements: z.object({
    noCaffeine: z.boolean(),
    noDairy: z.boolean(),
    includedGroups: z.array(z.enum(['coffee', 'tea', 'fruit'])),
    excludedGroups: z.array(z.enum(['coffee', 'tea', 'fruit'])),
    budget: z
      .object({ maxVnd: moneyVndSchema, inclusive: z.boolean(), scope: z.literal('item') })
      .nullable(),
  }),
  preferences: z.object({
    lowSugar: z.boolean(),
    flavors: z.array(z.enum(['sour', 'bitter', 'sweet', 'light', 'rich'])),
  }),
});
export type MenuSearchIntent = z.infer<typeof menuSearchIntentSchema>;

export const menuSearchRequestSchema = z.object({
  query: z.string().trim().min(1).max(200),
  filters: z
    .object({
      maxBudget: z.number().int().positive().nullable().optional(),
      noCaffeine: z.boolean().optional(),
      noDairy: z.boolean().optional(),
    })
    .optional(),
});
export type MenuSearchRequest = z.infer<typeof menuSearchRequestSchema>;

export const menuSearchResponseSchema = z.object({
  mode: z.enum(['fallback', 'llm']),
  intent: menuSearchIntentSchema,
  message: z.string(),
  items: z.array(
    z.object({
      productId: z.string(),
      variantId: z.string().nullable(),
      name: z.string(),
      description: z.string(),
      image: z.string(),
      unitPrice: moneyVndSchema,
      reason: z.string(),
    }),
  ),
  latencyMs: z.number().int().nonnegative(),
});
export type MenuSearchResponse = z.infer<typeof menuSearchResponseSchema>;

export const anomalyDetectorSchema = z.enum([
  'HTTP_ERROR_RATE',
  'HTTP_LATENCY_P95',
  'PREPARATION_P95',
  'CANCELLATION_RATE',
]);
export const anomalyStateSchema = z.enum(['OK', 'INSUFFICIENT_DATA', 'ALERT']);
export const anomalySeveritySchema = z.enum(['INFO', 'WARNING', 'CRITICAL']);
export const anomalyAlertStatusSchema = z.enum(['OPEN', 'ACKNOWLEDGED', 'CLOSED']);

export const anomalyExplanationSchema = z.object({
  mode: z.enum(['llm', 'fallback']),
  summary: z.string().min(1).max(500),
  evidence: z.array(z.string().min(1).max(300)).max(8),
  hypotheses: z.array(z.string().min(1).max(300)).max(5),
  checks: z.array(z.string().min(1).max(300)).max(8),
});
export type AnomalyExplanation = z.infer<typeof anomalyExplanationSchema>;

export const anomalyEvaluationSchema = z.object({
  detector: anomalyDetectorSchema,
  target: z.string(),
  state: anomalyStateSchema,
  severity: anomalySeveritySchema,
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
  observedValue: z.number().nullable(),
  thresholdValue: z.number(),
  baselineValue: z.number().nullable(),
  sampleCount: z.number().int().nonnegative(),
  baselineSampleCount: z.number().int().nonnegative(),
  method: z.string(),
  evidence: z.record(z.unknown()),
});
export type AnomalyEvaluation = z.infer<typeof anomalyEvaluationSchema>;

export const anomalyAlertSchema = anomalyEvaluationSchema.extend({
  id: z.string(),
  status: anomalyAlertStatusSchema,
  firstDetectedAt: z.string().datetime(),
  lastDetectedAt: z.string().datetime(),
  acknowledgedAt: z.string().datetime().nullable(),
  closedAt: z.string().datetime().nullable(),
  explanation: anomalyExplanationSchema,
});
export type AnomalyAlert = z.infer<typeof anomalyAlertSchema>;

export const anomalyDashboardResponseSchema = z.object({
  observedAt: z.string().datetime(),
  lastRunAt: z.string().datetime().nullable(),
  evaluations: z.array(anomalyEvaluationSchema),
  alerts: z.array(anomalyAlertSchema),
  schedule: z.object({
    intervalMs: z.number().int().nonnegative(),
    windowMinutes: z.number().int().nonnegative(),
    baselineMinutes: z.number().int().nonnegative(),
  }),
});
export type AnomalyDashboardResponse = z.infer<typeof anomalyDashboardResponseSchema>;

export const updateAnomalyStatusRequestSchema = z.object({
  status: z.enum(['ACKNOWLEDGED', 'CLOSED']),
});

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(200),
});

export const authUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  role: roleSchema,
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const authResponseSchema = z.object({
  accessToken: z.string().min(1),
  user: authUserSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

export const openTableSessionRequestSchema = z.object({
  tableId: z.string(),
});

export const updateOrderStatusRequestSchema = z.object({
  status: orderStatusSchema,
  reason: z.string().max(280).optional(),
});

export const reviewRequestSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(500).optional(),
});

export const serviceRequestSchema = z.object({
  type: z.enum(['CALL_STAFF', 'REQUEST_BILL', 'OTHER']),
  note: z.string().max(280).optional(),
});

export const availabilityRequestSchema = z.object({ isAvailable: z.boolean() });
export type AvailabilityRequest = z.infer<typeof availabilityRequestSchema>;
export const cancelRequestSchema = z.object({ reason: z.string().trim().min(3).max(280) });
export const cancelRequestDecisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  expectedVersion: z.number().int().nonnegative(),
  note: z.string().max(280).optional(),
  refundConfirmed: z.boolean().optional(),
  refundMethod: paymentMethodSchema.optional(),
});
export const refundOrderRequestSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  amount: moneyVndSchema,
  method: paymentMethodSchema,
  reason: z.string().trim().min(3).max(280),
  refundConfirmed: z.literal(true),
});
export const openCashShiftRequestSchema = z.object({ openingCash: moneyVndSchema });
export const closeCashShiftRequestSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  countedCash: moneyVndSchema,
  note: z.string().max(500).optional(),
});
export const validateAiConfigurationRequestSchema = z.object({
  productId: z.string(),
  variantId: z.string().nullable(),
  toppingIds: z.array(z.string()),
  constraints: z.object({
    noCaffeine: z.boolean().optional(),
    noDairy: z.boolean().optional(),
    maxBudget: moneyVndSchema.optional(),
  }),
});

export const receiptResponseSchema = z.object({
  source: z.enum(['BILL_SNAPSHOT', 'LEGACY_ORDER_FALLBACK']),
  tableName: z.string(),
  closedAt: z.string().datetime().nullable(),
  total: moneyVndSchema,
  orders: z.array(
    z.object({
      ...benefitBreakdownSchema.shape,
      _id: z.string(),
      code: z.string(),
      total: moneyVndSchema,
      status: orderStatusSchema,
      paymentStatus: paymentStatusSchema,
      participantId: z.string().nullable(),
      createdAt: z.string().datetime(),
      items: z.array(
        z.object({
          nameSnapshot: z.string(),
          variantNameSnapshot: z.string().optional().default(''),
          sizeName: z.string().nullable(),
          sugarLevel: z.string(),
          iceLevel: z.string(),
          toppingNamesSnapshot: z.array(z.string()).optional().default([]),
          note: z.string().optional().default(''),
          quantity: z.number().int().positive(),
          unitPrice: moneyVndSchema,
          lineTotal: moneyVndSchema,
        }),
      ),
      review: orderReviewSchema.nullable(),
    }),
  ),
});
export type ReceiptResponse = z.infer<typeof receiptResponseSchema>;

// Form lọc gửi cả ô để trống (`q=`); chuỗi rỗng nghĩa là không lọc.
const emptyAsUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;
const optionalFilter = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(emptyAsUndefined, schema.optional());
export const billHistoryQuerySchema = z.object({
  q: optionalFilter(z.string().trim().max(100)),
  table: optionalFilter(z.string().trim().max(100)),
  cashier: optionalFilter(z.string().trim().max(100)),
  from: optionalFilter(z.string().date()),
  to: optionalFilter(z.string().date()),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type BillHistoryQuery = z.infer<typeof billHistoryQuerySchema>;

export const billHistoryRowSchema = z.object({
  id: z.string(),
  invoiceCode: z.string(),
  tableCode: z.string(),
  tableName: z.string(),
  cashierName: z.string(),
  closedAt: z.string().datetime(),
  total: moneyVndSchema,
  paidAmount: moneyVndSchema,
  paymentMethods: z.array(z.enum(['CASH', 'BANK_TRANSFER', 'OTHER'])),
});
export type BillHistoryRow = z.infer<typeof billHistoryRowSchema>;

export const billHistoryListResponseSchema = z.object({
  items: z.array(billHistoryRowSchema),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});
export type BillHistoryListResponse = z.infer<typeof billHistoryListResponseSchema>;

export const billHistoryDetailSchema = billHistoryRowSchema.extend({
  tableSessionId: z.string().nullable(),
  source: z.enum(['STAFF', 'GUEST']),
  openedAt: z.string().datetime(),
  subtotal: moneyVndSchema,
  payments: z.array(
    z.object({
      method: z.enum(['CASH', 'BANK_TRANSFER', 'OTHER']),
      amount: moneyVndSchema,
      paidAt: z.string().datetime(),
    }),
  ),
  orders: z.array(
    z.object({
      ...benefitBreakdownSchema.shape,
      _id: z.string(),
      code: z.string(),
      status: orderStatusSchema,
      paymentStatus: paymentStatusSchema,
      total: moneyVndSchema,
      createdAt: z.string().datetime(),
      participantId: z.string().nullable().optional(),
      items: z.array(
        z
          .object({
            nameSnapshot: z.string(),
            variantNameSnapshot: z.string().optional().default(''),
            quantity: z.number().int().positive(),
            lineTotal: moneyVndSchema,
          })
          .passthrough(),
      ),
    }),
  ),
});
export type BillHistoryDetail = z.infer<typeof billHistoryDetailSchema>;

export const billSchema = z.object({
  tableSessionId: z.string().nullable(),
  tableCode: z.string(),
  status: tableSessionStatusSchema,
  openedAt: z.string(),
  closedAt: z.string().nullable(),
  subtotal: moneyVndSchema,
  total: moneyVndSchema,
  paidAmount: moneyVndSchema,
  orders: z.array(orderSchema),
});

export const dashboardOverviewSchema = z.object({
  totalRevenue: z.number().int(),
  grossCollected: moneyVndSchema.default(0),
  totalRefunded: moneyVndSchema.default(0),
  adjustmentAmount: z.number().int().default(0),
  orderCount: z.number().int(),
  averageOrderValue: moneyVndSchema,
  topProducts: z.array(
    z.object({
      productId: z.string(),
      name: z.string(),
      quantity: z.number().int(),
      revenue: moneyVndSchema,
    }),
  ),
  revenueByDay: z.array(
    z.object({
      date: z.string(),
      revenue: z.number().int(),
      orders: z.number().int(),
    }),
  ),
  revenueByHour: z.array(
    z.object({
      hour: z.number().int().min(0).max(23),
      revenue: z.number().int(),
    }),
  ),
});
export type DashboardOverview = z.infer<typeof dashboardOverviewSchema>;

export * from './schemas.js';
