import { unitOfWork } from '../infrastructure/unitOfWork.js';
import { auditRepository } from '../repositories/auditRepository.js';
import { categoryRepository } from '../repositories/categoryRepository.js';
import { outboxRepository } from '../repositories/outboxRepository.js';
import { productRepository } from '../repositories/productRepository.js';
import { toppingRepository } from '../repositories/toppingRepository.js';
import type { ClientSession } from 'mongoose';
import { Types } from 'mongoose';
import { NotFoundError, ConflictError, ValidationError } from '../errors/AppError.js';
import { CategoryModel } from '../models/Category.js';
import { ProductModel } from '../models/Product.js';
import { invalidatePublicMenuCache } from './menuService.js';

type CatalogKind = 'Product' | 'Category' | 'Topping';

async function mutation<T>(
  actorId: string,
  kind: CatalogKind,
  action: string,
  work: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const result = await unitOfWork.withTransaction(async (session) => {
    const result = await work(session);
    if (result === null || result === undefined)
      throw new NotFoundError('Không tìm thấy dữ liệu catalog.');
    const id = entityId(result);
    const version =
      'version' in (result as object) &&
      typeof (result as { version?: unknown }).version === 'number'
        ? (result as unknown as { version: number }).version
        : 0;
    await auditRepository.log(
      { actorType: 'USER', actorId, action, entityType: kind, entityId: id },
      session,
    );
    await outboxRepository.createRealtimeEvents(
      [
        {
          eventType: 'menu.availabilityChanged',
          aggregateType: kind,
          aggregateId: id,
          aggregateVersion: version,
          target: { scope: 'all' },
          payload: { entityType: kind, entityId: id, action, version },
        },
      ],
      session,
    );
    return result;
  });
  await invalidatePublicMenuCache();
  return result;
}

// Product assignment and category deletion write the same category document.
// Mongo retries conflicting transactions, preventing an orphan from concurrent edits.
async function guardCategory(id: unknown, session: ClientSession) {
  if (typeof id !== 'string' || !Types.ObjectId.isValid(id))
    throw new ValidationError('Danh mục không hợp lệ.');
  const category = await CategoryModel.findByIdAndUpdate(
    id,
    { $inc: { version: 1 } },
    { new: true, session },
  );
  if (!category) throw new NotFoundError('Danh mục không tồn tại.');
  return category;
}

export function createProduct(data: Record<string, unknown>, actorId: string) {
  return mutation(actorId, 'Product', 'product.created', async (session) => {
    await guardCategory(data.categoryId, session);
    return productRepository.create(data, session);
  });
}

export function updateProduct(id: string, data: Record<string, unknown>, actorId: string) {
  return mutation(actorId, 'Product', 'product.updated', async (session) => {
    if (data.categoryId !== undefined) await guardCategory(data.categoryId, session);
    return productRepository.update(id, data, session);
  });
}

export function archiveProduct(id: string, actorId: string) {
  return mutation(actorId, 'Product', 'product.archived', (session) =>
    productRepository.archive(id, session),
  );
}

export function createCategory(
  data: { name: string; slug: string; sortOrder?: number },
  actorId: string,
) {
  return mutation(actorId, 'Category', 'category.created', (session) =>
    categoryRepository.create(data, session),
  );
}

export function updateCategory(
  id: string,
  data: Partial<{ name: string; sortOrder: number; isActive: boolean }>,
  actorId: string,
) {
  return mutation(actorId, 'Category', 'category.updated', (session) =>
    categoryRepository.update(id, data, session),
  );
}

export function deleteCategory(id: string, reassignTo: unknown, actorId: string) {
  return mutation(actorId, 'Category', 'category.deleted', async (session) => {
    const category = await guardCategory(id, session);
    if (reassignTo === id) throw new ValidationError('Danh mục nhận phải khác danh mục bị xóa.');
    if (reassignTo !== undefined) await guardCategory(reassignTo, session);
    const count = await ProductModel.countDocuments({ categoryId: id }).session(session);
    if (count > 0 && reassignTo === undefined)
      throw new ConflictError(
        'CATEGORY_NOT_EMPTY',
        'Danh mục còn món. Hãy chọn danh mục nhận để chuyển toàn bộ món trước khi xóa.',
        { productCount: count },
      );
    if (count > 0) {
      await ProductModel.updateMany(
        { categoryId: id },
        { $set: { categoryId: reassignTo }, $inc: { version: 1 } },
        { session },
      );
      await auditRepository.log(
        {
          actorType: 'USER',
          actorId,
          action: 'category.productsMoved',
          entityType: 'Category',
          entityId: id,
          metadata: { targetCategoryId: reassignTo, productCount: count },
        },
        session,
      );
    }
    await categoryRepository.delete(id, session);
    return { ...category.toObject(), movedProductCount: count };
  });
}

export function createTopping(
  data: { name: string; price: number; isAvailable?: boolean },
  actorId: string,
) {
  return mutation(actorId, 'Topping', 'topping.created', (session) =>
    toppingRepository.create(data, session),
  );
}

export function updateTopping(
  id: string,
  data: Partial<{ name: string; price: number; isAvailable: boolean; isArchived: boolean }>,
  actorId: string,
) {
  return mutation(actorId, 'Topping', 'topping.updated', (session) =>
    toppingRepository.update(id, data, session),
  );
}

export function archiveTopping(id: string, actorId: string) {
  if (!Types.ObjectId.isValid(id)) throw new ValidationError('Topping không hợp lệ.');
  return mutation(actorId, 'Topping', 'topping.archived', (session) =>
    toppingRepository.update(id, { isArchived: true }, session),
  );
}

export function setProductAvailability(id: string, isAvailable: boolean, actorId: string) {
  return mutation(actorId, 'Product', 'product.availabilityChanged', (session) =>
    productRepository.update(id, { isAvailable }, session),
  );
}

export function setVariantAvailability(
  productId: string,
  variantId: string,
  isAvailable: boolean,
  actorId: string,
) {
  return mutation(actorId, 'Product', 'productVariant.availabilityChanged', (session) =>
    productRepository.setVariantAvailability(productId, variantId, isAvailable, session),
  );
}

export function setToppingAvailability(id: string, isAvailable: boolean, actorId: string) {
  return mutation(actorId, 'Topping', 'topping.availabilityChanged', (session) =>
    toppingRepository.update(id, { isAvailable }, session),
  );
}

function entityId(value: unknown): string {
  if (!value || typeof value !== 'object' || !('_id' in value)) return 'unknown';
  return String((value as { _id: unknown })._id);
}
