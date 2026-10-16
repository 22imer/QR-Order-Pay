import { Router, type RequestHandler } from 'express';
import * as auth from '../controllers/authController.js';
import * as menu from '../controllers/menuController.js';
import * as tableSession from '../controllers/tableSessionController.js';
import * as order from '../controllers/orderController.js';
import * as payment from '../controllers/paymentController.js';
import * as tableDisplay from '../controllers/tableDisplayController.js';
import * as ai from '../controllers/aiController.js';
import * as serviceRequest from '../controllers/serviceRequestController.js';
import * as admin from '../controllers/adminController.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import { loadGuest, loadReceiptGuest, requireGuest, guestCsrfGuard } from '../middlewares/guest.js';
import { currentReceipt } from '../controllers/receiptController.js';
import * as cancelRequest from '../controllers/cancelRequestController.js';
import * as cashShift from '../controllers/cashShiftController.js';
import { rateLimit as expressRateLimit } from 'express-rate-limit';
import { config } from '../config/index.js';
import { createRateLimitStore } from '../infrastructure/redis.js';
import { sha256 } from '../utils/crypto.js';
import { NotFoundError } from '../errors/AppError.js';

export const apiRouter = Router();

apiRouter.use((req, _res, next) => {
  if (config.trafficClass === 'unified') return next();
  if (/^\/health(?:\/|$)/.test(req.path)) return next();
  const internalRoute = /^\/(?:auth|staff|admin)(?:\/|$)/.test(req.path);
  if (config.trafficClass === 'guest' && internalRoute) return next(new NotFoundError());
  if (config.trafficClass === 'internal' && !internalRoute) return next(new NotFoundError());
  next();
});

// Rate limit là biện pháp bảo vệ production; trong test (NODE_ENV=test) nó bị vô hiệu theo cùng cách
// morgan bị tắt ở app.ts, vì mọi request của bộ test đến từ cùng một IP và sẽ chạm trần một cách giả tạo.
const rateLimitOrPassthrough = (
  max: number,
  prefix: string,
  keyGenerator?: (req: Parameters<RequestHandler>[0]) => string,
): RequestHandler => {
  if (config.env === 'test') return (_req, _res, next) => next();
  let limiter: RequestHandler | null = null;
  return (req, res, next) => {
    try {
      limiter ??= expressRateLimit({
        windowMs: 60_000,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        store: createRateLimitStore(prefix),
        passOnStoreError: false,
        keyGenerator,
      });
      limiter(req, res, next);
    } catch (error) {
      next(error);
    }
  };
};

const authLimiter = rateLimitOrPassthrough(config.rateLimits.authPerMinute, 'auth');
const guestMutationLimiter = rateLimitOrPassthrough(
  config.rateLimits.guestMutationPerMinute,
  'guest-mutation',
);
const clientIpKey = (req: Parameters<RequestHandler>[0]): string =>
  `ip:${sha256(req.ip ?? 'unknown')}`;
const tableKey = (req: Parameters<RequestHandler>[0]): string =>
  req.guest?.tableSessionId ? `table:${req.guest.tableSessionId}` : clientIpKey(req);
const joinKey = (req: Parameters<RequestHandler>[0]): string => {
  const tableToken = (req.body as { tableToken?: unknown } | undefined)?.tableToken;
  return typeof tableToken === 'string' && tableToken.length > 0
    ? `table-token:${sha256(tableToken)}`
    : clientIpKey(req);
};
const guestJoinLimiter = rateLimitOrPassthrough(
  config.rateLimits.guestJoinPerMinute,
  'guest-join',
  joinKey,
);
const guestOrderLimiter = rateLimitOrPassthrough(
  config.rateLimits.guestOrderPerMinute,
  'guest-order',
  tableKey,
);
const guestServiceLimiter = rateLimitOrPassthrough(
  config.rateLimits.guestServicePerMinute,
  'guest-service',
  tableKey,
);
const aiLimiter = rateLimitOrPassthrough(config.rateLimits.aiPerMinute, 'ai');

// auth
apiRouter.post('/auth/login', authLimiter, auth.login);
apiRouter.post('/auth/refresh', authLimiter, auth.refresh);
apiRouter.post('/auth/logout', authLimiter, auth.logout);
apiRouter.post('/auth/logout-all', authLimiter, requireAuth, auth.logoutAll);
apiRouter.get('/auth/me', requireAuth, auth.me);
apiRouter.patch('/auth/me', authLimiter, requireAuth, auth.profile);
apiRouter.post('/auth/password', authLimiter, requireAuth, auth.password);

// public menu
apiRouter.get('/categories', menu.listMenu);
apiRouter.get('/products', menu.listMenu);
apiRouter.get('/products/featured', menu.listFeaturedMenu);
apiRouter.post(
  '/menu/search',
  rateLimitOrPassthrough(config.rateLimits.menuSearchPerMinute, 'menu-search'),
  menu.search,
);

// table session public + guest
apiRouter.get(
  '/table-displays/qr',
  rateLimitOrPassthrough(120, 'table-display'),
  tableDisplay.currentQr,
);
apiRouter.post(
  '/table-sessions/join',
  loadGuest,
  guestCsrfGuard,
  guestJoinLimiter,
  tableSession.join,
);
apiRouter.get('/table-sessions/current', loadGuest, tableSession.current);
apiRouter.post('/table-sessions/leave', loadGuest, guestCsrfGuard, tableSession.leave);

// guest orders
apiRouter.post(
  '/orders/quote',
  loadGuest,
  guestCsrfGuard,
  guestOrderLimiter,
  requireGuest,
  order.quote,
);
apiRouter.post('/orders', loadGuest, guestCsrfGuard, guestOrderLimiter, requireGuest, order.place);
apiRouter.get('/orders/mine', loadGuest, requireGuest, order.listMine);
apiRouter.get('/orders/:id', loadGuest, requireGuest, order.detail);
apiRouter.post(
  '/orders/:id/cancel',
  loadGuest,
  guestCsrfGuard,
  guestMutationLimiter,
  requireGuest,
  order.cancel,
);
apiRouter.post(
  '/orders/:id/review',
  loadGuest,
  guestCsrfGuard,
  guestMutationLimiter,
  requireGuest,
  order.review,
);
apiRouter.post(
  '/orders/:id/cancel-requests',
  loadGuest,
  guestCsrfGuard,
  guestMutationLimiter,
  requireGuest,
  cancelRequest.create,
);
apiRouter.get('/receipts/current', loadReceiptGuest, currentReceipt);
apiRouter.post(
  '/receipts/orders/:id/review',
  guestCsrfGuard,
  guestMutationLimiter,
  loadReceiptGuest,
  order.review,
);

// guest service requests
apiRouter.post(
  '/service-requests',
  loadGuest,
  guestCsrfGuard,
  guestServiceLimiter,
  requireGuest,
  serviceRequest.create,
);

// AI
apiRouter.post(
  '/ai/recommendations',
  aiLimiter,
  loadGuest,
  guestCsrfGuard,
  requireGuest,
  ai.recommend,
);
apiRouter.post(
  '/ai/recommendations/validate',
  aiLimiter,
  loadGuest,
  guestCsrfGuard,
  requireGuest,
  ai.validateConfiguration,
);

// staff/admin
apiRouter.get('/staff/payments', requireAuth, requireRole('STAFF', 'ADMIN'), payment.accounting);
apiRouter.post(
  '/staff/payments/:id/corrections',
  requireAuth,
  requireRole('STAFF', 'ADMIN'),
  payment.requestCorrection,
);
apiRouter.get('/admin/payments', requireAuth, requireRole('ADMIN'), payment.accounting);
apiRouter.post(
  '/admin/payments/:id/corrections',
  requireAuth,
  requireRole('ADMIN'),
  payment.requestCorrection,
);
apiRouter.post(
  '/admin/payment-corrections/:id/decision',
  requireAuth,
  requireRole('ADMIN'),
  payment.decideCorrection,
);
apiRouter.post(
  '/staff/table-sessions/:id/payment-claim',
  requireAuth,
  requireRole('STAFF', 'ADMIN'),
  payment.claim,
);
apiRouter.post(
  '/staff/table-sessions/:id/payment-claim/release',
  requireAuth,
  requireRole('STAFF', 'ADMIN'),
  payment.releaseClaim,
);
apiRouter.get(
  '/staff/awaiting-payments',
  requireAuth,
  requireRole('STAFF', 'ADMIN'),
  payment.awaiting,
);
apiRouter.post(
  '/staff/orders/:id/payments',
  requireAuth,
  requireRole('STAFF', 'ADMIN'),
  payment.confirmOrder,
);
apiRouter.post(
  '/staff/orders/:id/refund',
  requireAuth,
  requireRole('STAFF', 'ADMIN'),
  payment.refundOrder,
);
apiRouter.post(
  '/staff/tables/:id/display',
  requireAuth,
  requireRole('STAFF', 'ADMIN'),
  tableDisplay.provision,
);
apiRouter.post(
  '/admin/tables/:id/display',
  requireAuth,
  requireRole('ADMIN'),
  tableDisplay.provision,
);
apiRouter.get(
  '/staff/tables',
  requireAuth,
  requireRole('STAFF', 'ADMIN'),
  tableSession.staffTables,
);
apiRouter.get('/staff/orders', requireAuth, requireRole('STAFF', 'ADMIN'), order.staffList);
apiRouter.get('/staff/orders/:id', requireAuth, requireRole('STAFF', 'ADMIN'), order.staffGetOne);
apiRouter.patch(
  '/staff/orders/:id/status',
  requireAuth,
  requireRole('STAFF', 'ADMIN'),
  order.staffTransition,
);
apiRouter.post(
  '/staff/orders/:id/confirm',
  requireAuth,
  requireRole('STAFF', 'ADMIN'),
  order.staffConfirmReceipt,
);

apiRouter.get(
  '/staff/table-sessions',
  requireAuth,
  requireRole('STAFF', 'ADMIN'),
  tableSession.staffList,
);
apiRouter.post(
  '/staff/tables/:tableId/sessions',
  requireAuth,
  requireRole('STAFF', 'ADMIN'),
  tableSession.staffOpen,
);
apiRouter.patch(
  '/staff/table-sessions/:id/status',
  requireAuth,
  requireRole('STAFF', 'ADMIN'),
  tableSession.staffTransition,
);
apiRouter.post(
  '/staff/table-sessions/:id/transfer',
  requireAuth,
  requireRole('STAFF', 'ADMIN'),
  tableSession.staffTransfer,
);
apiRouter.get(
  '/staff/table-sessions/:id/bill',
  requireAuth,
  requireRole('STAFF', 'ADMIN'),
  tableSession.staffBill,
);

apiRouter.post(
  '/staff/table-sessions/:id/payments',
  requireAuth,
  requireRole('STAFF', 'ADMIN'),
  payment.confirm,
);
apiRouter.get(
  '/staff/service-requests',
  requireAuth,
  requireRole('STAFF', 'ADMIN'),
  serviceRequest.list,
);
apiRouter.post(
  '/staff/service-requests/:id/resolve',
  requireAuth,
  requireRole('STAFF', 'ADMIN'),
  serviceRequest.resolveOne,
);
apiRouter.get(
  '/staff/cancel-requests',
  requireAuth,
  requireRole('STAFF', 'ADMIN'),
  cancelRequest.list,
);
apiRouter.patch(
  '/staff/cancel-requests/:id',
  requireAuth,
  requireRole('STAFF', 'ADMIN'),
  cancelRequest.decide,
);
apiRouter.get(
  '/staff/cash-shifts/current',
  requireAuth,
  requireRole('STAFF', 'ADMIN'),
  cashShift.current,
);
apiRouter.post('/staff/cash-shifts', requireAuth, requireRole('STAFF', 'ADMIN'), cashShift.open);
apiRouter.post(
  '/staff/cash-shifts/:id/close',
  requireAuth,
  requireRole('STAFF', 'ADMIN'),
  cashShift.close,
);
apiRouter.get(
  '/staff/catalog/availability',
  requireAuth,
  requireRole('STAFF', 'ADMIN'),
  admin.staffAvailabilityCatalog,
);
apiRouter.patch(
  '/staff/catalog/products/:id/availability',
  requireAuth,
  requireRole('STAFF', 'ADMIN'),
  admin.setProductAvailability,
);
apiRouter.patch(
  '/staff/catalog/products/:id/variants/:variantId/availability',
  requireAuth,
  requireRole('STAFF', 'ADMIN'),
  admin.setVariantAvailability,
);
apiRouter.patch(
  '/staff/catalog/toppings/:id/availability',
  requireAuth,
  requireRole('STAFF', 'ADMIN'),
  admin.setToppingAvailability,
);

// admin
apiRouter.get('/admin/reports/overview', requireAuth, requireRole('ADMIN'), admin.reportsOverview);
apiRouter.post(
  '/admin/reports/overview/jobs',
  requireAuth,
  requireRole('ADMIN'),
  admin.createOverviewJob,
);
apiRouter.get('/admin/reports/jobs/:id', requireAuth, requireRole('ADMIN'), admin.reportJobStatus);
apiRouter.get('/admin/bills', requireAuth, requireRole('ADMIN'), admin.bills);
apiRouter.get('/admin/bills/:id', requireAuth, requireRole('ADMIN'), admin.billDetail);
apiRouter.get('/admin/cash-shifts', requireAuth, requireRole('ADMIN'), cashShift.history);
apiRouter.get('/admin/operations/summary', requireAuth, requireRole('ADMIN'), admin.operations);
apiRouter.get(
  '/admin/operations/failures',
  requireAuth,
  requireRole('ADMIN'),
  admin.operationFailures,
);
apiRouter.post(
  '/admin/operations/outbox/:id/replay',
  requireAuth,
  requireRole('ADMIN'),
  admin.replayOutbox,
);
apiRouter.post(
  '/admin/operations/jobs/:id/replay',
  requireAuth,
  requireRole('ADMIN'),
  admin.replayQueueJob,
);
apiRouter.get('/admin/anomalies', requireAuth, requireRole('ADMIN'), admin.anomalies);
apiRouter.patch(
  '/admin/anomalies/:id/status',
  requireAuth,
  requireRole('ADMIN'),
  admin.setAnomalyStatus,
);
apiRouter.get('/admin/products', requireAuth, requireRole('ADMIN'), admin.listProducts);
apiRouter.post('/admin/products', requireAuth, requireRole('ADMIN'), admin.createProduct);
apiRouter.patch('/admin/products/:id', requireAuth, requireRole('ADMIN'), admin.updateProduct);
apiRouter.delete('/admin/products/:id', requireAuth, requireRole('ADMIN'), admin.deleteProduct);

apiRouter.get('/admin/categories', requireAuth, requireRole('ADMIN'), admin.listCategories);
apiRouter.post('/admin/categories', requireAuth, requireRole('ADMIN'), admin.createCategory);
apiRouter.patch('/admin/categories/:id', requireAuth, requireRole('ADMIN'), admin.updateCategory);
apiRouter.delete('/admin/categories/:id', requireAuth, requireRole('ADMIN'), admin.deleteCategory);

apiRouter.get('/admin/toppings', requireAuth, requireRole('ADMIN'), admin.listToppings);
apiRouter.post('/admin/toppings', requireAuth, requireRole('ADMIN'), admin.createTopping);
apiRouter.patch('/admin/toppings/:id', requireAuth, requireRole('ADMIN'), admin.updateTopping);
apiRouter.delete('/admin/toppings/:id', requireAuth, requireRole('ADMIN'), admin.deleteTopping);

apiRouter.get('/admin/tables', requireAuth, requireRole('ADMIN'), admin.listTables);
apiRouter.post(
  '/admin/tables/:id/rotate-token',
  requireAuth,
  requireRole('ADMIN'),
  tableDisplay.provision,
);
apiRouter.get('/admin/users', requireAuth, requireRole('ADMIN'), admin.listUsers);
apiRouter.post('/admin/users', requireAuth, requireRole('ADMIN'), admin.createStaff);
apiRouter.patch('/admin/users/:id', requireAuth, requireRole('ADMIN'), admin.updateUser);
apiRouter.delete('/admin/users/:id', requireAuth, requireRole('ADMIN'), admin.deleteUser);
apiRouter.get('/admin/reviews', requireAuth, requireRole('ADMIN'), admin.listReviews);

// health
apiRouter.get('/health', (_req, res) => {
  res.json({
    success: true,
    data: {
      ok: true,
      uptime: process.uptime(),
      instanceId: config.instanceId,
      trafficClass: config.trafficClass,
    },
  });
});
