import type { Request, Response, NextFunction } from 'express';
import { overview } from '../services/dashboardService.js';
import {
  listAdminCategories,
  listAdminProducts,
  listAdminToppings,
} from '../services/menuService.js';
import { tableRepository } from '../repositories/tableRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { AppError, NotFoundError, ValidationError } from '../errors/AppError.js';
import * as catalogMutation from '../services/catalogMutationService.js';
import { reviewRepository } from '../repositories/reviewRepository.js';
import { hashPassword } from '../utils/crypto.js';
import { operationsSummary } from '../services/operationsService.js';
import { anomalyDashboard, updateAnomalyStatus } from '../services/anomalyService.js';
import {
  availabilityRequestSchema,
  billHistoryDetailSchema,
  billHistoryListResponseSchema,
  billHistoryQuerySchema,
  updateAnomalyStatusRequestSchema,
} from '@may-cafe/contracts';
import { auditRepository } from '../repositories/auditRepository.js';
import {
  enqueueReportJob,
  getReportJobState,
  listDeadLetters,
  replayDeadLetter,
} from '../infrastructure/backgroundQueue.js';
import { outboxRepository } from '../repositories/outboxRepository.js';
import { getBillHistory, listBillHistory } from '../services/billHistoryService.js';

export async function reportsOverview(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    const data = await overview(from, to);
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
}

export async function bills(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const filters = billHistoryQuerySchema.parse(req.query);
    const data = billHistoryListResponseSchema.parse(await listBillHistory(filters));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function billDetail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({
      success: true,
      data: billHistoryDetailSchema.parse(await getBillHistory(String(req.params['id'] ?? ''))),
    });
  } catch (error) {
    next(error);
  }
}

export async function createOverviewJob(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const from = parseDate(req.body?.from);
    const to = parseDate(req.body?.to);
    const requestedFormat = req.body?.format;
    if (requestedFormat !== 'json' && requestedFormat !== 'csv') {
      throw new ValidationError('Định dạng báo cáo phải là json hoặc csv.');
    }
    const state = await enqueueReportJob({
      from: from?.toISOString() ?? null,
      to: to?.toISOString() ?? null,
      format: requestedFormat,
    });
    res.status(202).json({ success: true, data: state });
  } catch (error) {
    if ((error as Error).message === 'BACKGROUND_QUEUE_UNAVAILABLE') {
      next(
        new AppError(
          'BACKGROUND_QUEUE_UNAVAILABLE',
          'Worker báo cáo tạm thời không khả dụng.',
          503,
        ),
      );
      return;
    }
    next(error);
  }
}

export async function reportJobStatus(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = String(req.params['id'] ?? '');
    const state = await getReportJobState(id);
    if (!state) throw new NotFoundError('Không tìm thấy tác vụ báo cáo hoặc kết quả đã hết hạn.');
    res.json({ success: true, data: state });
  } catch (error) {
    next(error);
  }
}

export async function operations(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await operationsSummary();
    req.log.info(
      { requestId: req.id, operation: 'admin.operations.read' },
      'operations summary viewed',
    );
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
}

export async function operationFailures(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const [outbox, deadLetters] = await Promise.all([
      outboxRepository.listFailed(),
      listDeadLetters(),
    ]);
    res.json({ success: true, data: { outbox, deadLetters } });
  } catch (error) {
    next(error);
  }
}

export async function replayOutbox(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const eventId = String(req.params['id'] ?? '');
    if (!(await outboxRepository.replayFailed(eventId)))
      throw new NotFoundError('Không tìm thấy sự kiện outbox lỗi.');
    await auditRepository.log({
      actorType: 'USER',
      actorId: req.user!.id,
      action: 'outbox.replayed',
      entityType: 'OutboxEvent',
      entityId: eventId,
    });
    res.json({ success: true, data: { eventId, status: 'PENDING' } });
  } catch (error) {
    next(error);
  }
}

export async function replayQueueJob(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const jobId = String(req.params['id'] ?? '');
    if (!(await replayDeadLetter(jobId)))
      throw new NotFoundError('Không tìm thấy dead-letter job.');
    await auditRepository.log({
      actorType: 'USER',
      actorId: req.user!.id,
      action: 'queueJob.replayed',
      entityType: 'BackgroundJob',
      entityId: jobId,
    });
    res.json({ success: true, data: { jobId, status: 'QUEUED' } });
  } catch (error) {
    next(error);
  }
}

export async function anomalies(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await anomalyDashboard();
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
}

export async function setAnomalyStatus(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = updateAnomalyStatusRequestSchema.parse(req.body);
    const id = String(req.params['id'] ?? '');
    const alert = await updateAnomalyStatus(id, input.status, req.user!.id);
    if (!alert) throw new NotFoundError('Không tìm thấy cảnh báo.');
    await auditRepository.log({
      actorType: 'USER',
      actorId: req.user!.id,
      action: input.status === 'ACKNOWLEDGED' ? 'anomaly.acknowledged' : 'anomaly.closed',
      entityType: 'AnomalyAlert',
      entityId: id,
      metadata: { detector: alert.detector, previousWindowEnd: alert.windowEnd },
    });
    res.json({ success: true, data: { alert } });
  } catch (e) {
    next(e);
  }
}

export async function listProducts(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const products = await listAdminProducts();
    res.json({ success: true, data: { products } });
  } catch (e) {
    next(e);
  }
}

export async function listCategories(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const categories = await listAdminCategories();
    res.json({ success: true, data: { categories } });
  } catch (e) {
    next(e);
  }
}

export async function listToppings(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const toppings = await listAdminToppings();
    res.json({ success: true, data: { toppings } });
  } catch (e) {
    next(e);
  }
}

export async function staffAvailabilityCatalog(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const [products, toppings] = await Promise.all([listAdminProducts(), listAdminToppings()]);
    res.json({ success: true, data: { products, toppings } });
  } catch (error) {
    next(error);
  }
}

export async function setProductAvailability(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = availabilityRequestSchema.parse(req.body);
    const product = await catalogMutation.setProductAvailability(
      String(req.params['id'] ?? ''),
      input.isAvailable,
      req.user!.id,
    );
    res.json({ success: true, data: { product } });
  } catch (error) {
    next(error);
  }
}

export async function setVariantAvailability(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = availabilityRequestSchema.parse(req.body);
    const product = await catalogMutation.setVariantAvailability(
      String(req.params['id'] ?? ''),
      String(req.params['variantId'] ?? ''),
      input.isAvailable,
      req.user!.id,
    );
    res.json({ success: true, data: { product } });
  } catch (error) {
    next(error);
  }
}

export async function setToppingAvailability(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = availabilityRequestSchema.parse(req.body);
    const topping = await catalogMutation.setToppingAvailability(
      String(req.params['id'] ?? ''),
      input.isAvailable,
      req.user!.id,
    );
    res.json({ success: true, data: { topping } });
  } catch (error) {
    next(error);
  }
}

export async function listTables(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tables = await tableRepository.list();
    res.json({ success: true, data: { tables } });
  } catch (e) {
    next(e);
  }
}

export async function listUsers(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const users = await userRepository.list();
    res.json({
      success: true,
      data: {
        users: users.map((u) => ({
          id: u._id.toString(),
          name: u.name,
          email: u.email,
          role: u.role,
          isActive: u.isActive,
          createdAt: u.createdAt,
        })),
      },
    });
  } catch (e) {
    next(e);
  }
}

export async function listReviews(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rating = parseRating(req.query.rating);
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to, true);
    const page = parsePositiveInt(req.query.page) ?? 1;
    const data = await reviewRepository.listForAdmin({ rating, from, to, page, limit: 20 });
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
}

export async function createProduct(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = req.body as Record<string, unknown>;
    if (!body.name || !body.categoryId || !body.image)
      throw new ValidationError('Thiếu trường bắt buộc.');
    const product = await catalogMutation.createProduct(
      {
        ...body,
        variants: body.variants ?? [],
        allowedOptions: body.allowedOptions ?? {
          sizes: [],
          sugarLevels: [],
          iceLevels: [],
          toppingIds: [],
        },
        tags: body.tags ?? [],
        toppingIds: body.toppingIds ?? [],
        ingredientMetadata: body.ingredientMetadata ?? {},
        isAvailable: body.isAvailable ?? true,
        isArchived: false,
        isFeatured: body.isFeatured ?? false,
        sortOrder: body.sortOrder ?? 0,
      },
      req.user!.id,
    );
    res.status(201).json({ success: true, data: { product } });
  } catch (e) {
    next(e);
  }
}

export async function updateProduct(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = String(req.params['id'] ?? '');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const product = await catalogMutation.updateProduct(id, body, req.user!.id);
    if (!product) {
      res
        .status(404)
        .json({ success: false, error: { code: 'NOT_FOUND', message: 'Không tìm thấy món.' } });
      return;
    }
    res.json({ success: true, data: { product } });
  } catch (e) {
    next(e);
  }
}

export async function deleteProduct(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = String(req.params['id'] ?? '');
    const product = await catalogMutation.archiveProduct(id, req.user!.id);
    res.json({ success: true, data: { product } });
  } catch (e) {
    next(e);
  }
}

export async function createCategory(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = req.body as { name?: string; slug?: string; sortOrder?: number };
    if (!body.name || !body.slug) throw new ValidationError('Thiếu tên hoặc slug.');
    const created = await catalogMutation.createCategory(
      { name: body.name, slug: body.slug, sortOrder: body.sortOrder ?? 0 },
      req.user!.id,
    );
    res.status(201).json({ success: true, data: { category: created } });
  } catch (e) {
    next(e);
  }
}

export async function updateCategory(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = String(req.params['id'] ?? '');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const updated = await catalogMutation.updateCategory(id, body, req.user!.id);
    if (!updated) {
      res.status(404).json({
        success: false,
        error: { code: 'CATEGORY_NOT_FOUND', message: 'Không tìm thấy danh mục.' },
      });
      return;
    }
    res.json({ success: true, data: { category: updated } });
  } catch (e) {
    next(e);
  }
}

export async function createStaff(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as {
      name?: string;
      email?: string;
      password?: string;
      role?: 'STAFF' | 'ADMIN';
    };
    if (!body.name || !body.email || !body.password)
      throw new ValidationError('Thiếu tên, email hoặc mật khẩu.');
    if (body.password.length < 8) throw new ValidationError('Mật khẩu tối thiểu 8 ký tự.');
    const existing = await userRepository.findByEmail(body.email);
    if (existing) {
      res.status(409).json({
        success: false,
        error: { code: 'EMAIL_TAKEN', message: 'Email đã được sử dụng.' },
      });
      return;
    }
    const passwordHash = await hashPassword(body.password);
    const user = await userRepository.create({
      name: body.name,
      email: body.email,
      passwordHash,
      role: body.role ?? 'STAFF',
    });
    res.status(201).json({
      success: true,
      data: {
        user: {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          role: user.role,
          isActive: user.isActive,
        },
      },
    });
  } catch (e) {
    next(e);
  }
}

export async function updateUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = String(req.params['id'] ?? '');
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.password === 'string') {
      if (body.password.length < 8) throw new ValidationError('Mật khẩu tối thiểu 8 ký tự.');
      body.passwordHash = await hashPassword(body.password);
      delete body.password;
    }
    const updated = await userRepository.update(id, body);
    if (!updated) {
      res.status(404).json({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'Không tìm thấy nhân viên.' },
      });
      return;
    }
    res.json({
      success: true,
      data: {
        user: {
          id: updated._id.toString(),
          name: updated.name,
          email: updated.email,
          role: updated.role,
          isActive: updated.isActive,
        },
      },
    });
  } catch (e) {
    next(e);
  }
}

export async function createTopping(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = req.body as { name?: string; price?: number; isAvailable?: boolean };
    if (!body.name || typeof body.price !== 'number')
      throw new ValidationError('Thiếu tên hoặc giá topping.');
    const created = await catalogMutation.createTopping(
      { name: body.name, price: body.price, isAvailable: body.isAvailable ?? true },
      req.user!.id,
    );
    res.status(201).json({ success: true, data: { topping: created } });
  } catch (e) {
    next(e);
  }
}

export async function updateTopping(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = String(req.params['id'] ?? '');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const topping = await catalogMutation.updateTopping(id, body, req.user!.id);
    res.json({ success: true, data: { topping } });
  } catch (e) {
    next(e);
  }
}

function parseDate(v: unknown, nextDay = false): Date | undefined {
  if (typeof v !== 'string') return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new ValidationError('Ngày không hợp lệ.');
  if (nextDay) d.setDate(d.getDate() + 1);
  return d;
}

function parseRating(v: unknown): number | undefined {
  if (v === undefined || v === '') return undefined;
  const rating = Number(v);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5)
    throw new ValidationError('Số sao phải từ 1 đến 5.');
  return rating;
}

function parsePositiveInt(v: unknown): number | undefined {
  if (v === undefined) return undefined;
  const number = Number(v);
  if (!Number.isInteger(number) || number < 1) throw new ValidationError('Trang không hợp lệ.');
  return number;
}
