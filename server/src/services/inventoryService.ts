import { createHash } from 'node:crypto';
import { Types, type ClientSession } from 'mongoose';
import type {
  IngredientCreateInput,
  IngredientUpdateInput,
  RecipeSaveInput,
  StockMovementInput,
  IngredientDto,
  RecipeDto,
} from '@may-cafe/contracts';
import { IngredientModel, type IngredientDoc } from '../models/Ingredient.js';
import { RecipeModel } from '../models/Recipe.js';
import { StockMovementModel } from '../models/StockMovement.js';
import { ProductModel } from '../models/Product.js';
import { ToppingModel } from '../models/Topping.js';
import { unitOfWork } from '../infrastructure/unitOfWork.js';
import { auditRepository } from '../repositories/auditRepository.js';
import { outboxRepository } from '../repositories/outboxRepository.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/AppError.js';
import {
  displayUnits,
  stockUnits,
  applyInventoryAvailability,
} from './inventoryAvailabilityService.js';
import { invalidatePublicMenuCache } from './menuService.js';

export function ingredientDto(i: IngredientDoc): IngredientDto {
  return {
    id: i.id,
    code: i.code,
    name: i.name,
    unit: i.unit,
    onHand: displayUnits(i.onHand),
    reserved: displayUnits(i.reserved),
    available: displayUnits(i.onHand - i.reserved),
    lowStockThreshold: displayUnits(i.lowStockThreshold),
    isLowStock: i.onHand - i.reserved <= i.lowStockThreshold,
    isActive: i.isActive,
    version: i.version,
  };
}
export async function inventoryChanged(id: string, version: number, session: ClientSession) {
  await outboxRepository.createRealtimeEvents(
    [
      {
        eventType: 'menu.availabilityChanged',
        aggregateType: 'Inventory',
        aggregateId: id,
        aggregateVersion: version,
        target: { scope: 'all' },
        payload: { action: 'inventory.changed' },
      },
    ],
    session,
  );
}
async function log(
  actorId: string,
  action: string,
  entityId: string,
  metadata: Record<string, unknown>,
  session: ClientSession,
) {
  await auditRepository.log(
    { actorType: 'USER', actorId, action, entityType: 'Inventory', entityId, metadata },
    session,
  );
}
function duplicate(error: unknown): boolean {
  return (error as { code?: number })?.code === 11000;
}

export async function inventoryOverview() {
  const ingredients = await IngredientModel.find().sort({ name: 1 });
  const recipes = await RecipeModel.find().sort({ updatedAt: -1 });
  const products = await ProductModel.find({ isArchived: false });
  const toppings = await ToppingModel.find({ isArchived: false });
  // Separate response copies allow showing manual and ingredient-based status side by side.
  const effective = await applyInventoryAvailability(
    products.map((p) => p.toObject()),
    toppings.map((t) => t.toObject()),
  );
  return {
    ingredients: ingredients.map(ingredientDto),
    recipes: recipes.map((r): RecipeDto => ({
      id: r.id,
      targetType: r.targetType,
      targetId: String(r.targetId),
      enabled: r.enabled,
      version: r.version,
      components: r.components.map((c) => ({
        ingredientId: String(c.ingredientId),
        quantity: displayUnits(c.quantity),
      })),
      variants: r.variants.map((v) => ({
        variantId: String(v.variantId),
        components: v.components.map((c) => ({
          ingredientId: String(c.ingredientId),
          quantity: displayUnits(c.quantity),
        })),
      })),
    })),
    products: products.map((p, index) => ({
      id: p.id,
      name: p.name,
      isAvailable: p.isAvailable,
      effectiveAvailable: effective.products[index]!.isAvailable,
      variants: p.variants.map((v, vi) => ({
        id: String(v._id),
        name: v.name,
        isAvailable: v.isAvailable,
        effectiveAvailable: effective.products[index]!.variants[vi]!.isAvailable,
      })),
    })),
    toppings: toppings.map((t, index) => ({
      id: t.id,
      name: t.name,
      isAvailable: t.isAvailable,
      effectiveAvailable: effective.toppings[index]!.isAvailable,
    })),
  };
}

export async function createIngredient(input: IngredientCreateInput, actorId: string) {
  try {
    return await unitOfWork.withTransaction(async (session) => {
      const [ingredient] = await IngredientModel.create(
        [{ ...input, lowStockThreshold: stockUnits(input.lowStockThreshold) }],
        { session },
      );
      if (!ingredient) throw new Error('Failed to create ingredient');
      await log(
        actorId,
        'inventory.ingredientCreated',
        ingredient.id,
        { code: input.code, unit: input.unit },
        session,
      );
      return ingredientDto(ingredient);
    });
  } catch (error) {
    if (duplicate(error))
      throw new ConflictError('INGREDIENT_CODE_EXISTS', 'Mã nguyên liệu đã tồn tại.');
    throw error;
  }
}

export async function updateIngredient(id: string, input: IngredientUpdateInput, actorId: string) {
  const result = await unitOfWork.withTransaction(async (session) => {
    const ingredient = await IngredientModel.findOneAndUpdate(
      { _id: id, version: input.expectedVersion, ...(!input.isActive ? { reserved: 0 } : {}) },
      {
        $set: {
          name: input.name,
          isActive: input.isActive,
          lowStockThreshold: stockUnits(input.lowStockThreshold),
        },
        $inc: { version: 1 },
      },
      { new: true, session },
    );
    if (!ingredient)
      throw new ConflictError(
        'CONFLICT',
        'Nguyên liệu đã thay đổi hoặc đang giữ cho đơn chưa pha chế. Hãy tải lại.',
      );
    await log(actorId, 'inventory.ingredientUpdated', id, { isActive: input.isActive }, session);
    await inventoryChanged(id, ingredient.version, session);
    return ingredientDto(ingredient);
  });
  await invalidatePublicMenuCache();
  return result;
}

export async function moveStock(id: string, input: StockMovementInput, actorId: string) {
  const requestHash = createHash('sha256')
    .update(
      JSON.stringify({
        id,
        actorId,
        type: input.type,
        quantity: input.quantity,
        reason: input.reason,
      }),
    )
    .digest('hex');
  const replay = async () => {
    const movement = await StockMovementModel.findOne({ idempotencyKey: input.idempotencyKey });
    if (!movement) return null;
    if (movement.requestHash !== requestHash)
      throw new ConflictError('IDEMPOTENCY_CONFLICT', 'Mã thao tác kho đã dùng cho nội dung khác.');
    return { id: movement.id, replayed: true };
  };
  const existing = await replay();
  if (existing) return existing;
  try {
    const result = await unitOfWork.withTransaction(async (session) => {
      const current = await IngredientModel.findById(id).session(session);
      if (!current) throw new NotFoundError('Nguyên liệu không tồn tại.');
      if (current.version !== input.expectedVersion)
        throw new ConflictError(
          'CONFLICT',
          'Tồn kho vừa thay đổi. Hãy tải lại trước khi ghi nhận.',
        );
      const amount = stockUnits(input.quantity);
      const onHand =
        input.type === 'ADJUSTMENT'
          ? amount
          : current.onHand + (input.type === 'RECEIPT' ? amount : -amount);
      if (
        !current.isActive ||
        onHand < current.reserved ||
        onHand < 0 ||
        onHand > stockUnits(1_000_000_000)
      )
        throw new ConflictError(
          'INSUFFICIENT_STOCK',
          'Nguyên liệu đã ngừng dùng hoặc tồn sau thao tác thấp hơn lượng đang giữ cho đơn.',
        );
      const ingredient = await IngredientModel.findOneAndUpdate(
        { _id: id, version: current.version },
        { $set: { onHand }, $inc: { version: 1 } },
        { new: true, session },
      );
      if (!ingredient) throw new ConflictError('CONFLICT', 'Tồn kho vừa thay đổi.');
      const [movement] = await StockMovementModel.create(
        [
          {
            ingredientId: id,
            ingredientName: current.name,
            unit: current.unit,
            type: input.type,
            quantity: onHand - current.onHand,
            onHandAfter: onHand,
            reservedAfter: current.reserved,
            actorId,
            reason: input.reason,
            idempotencyKey: input.idempotencyKey,
            requestHash,
          },
        ],
        { session },
      );
      await log(
        actorId,
        'inventory.stockMoved',
        id,
        {
          movementId: movement!.id,
          type: input.type,
          quantity: input.quantity,
          reason: input.reason,
        },
        session,
      );
      await inventoryChanged(id, ingredient.version, session);
      return { id: movement!.id, replayed: false };
    });
    await invalidatePublicMenuCache();
    return result;
  } catch (error) {
    const raced = await replay();
    if (raced) return raced;
    throw error;
  }
}

// Both recipe edits and order creation write the same catalog targets, including
// targets without a recipe yet, so first-time enabling cannot race past an order.
export async function lockInventoryTarget(
  type: 'PRODUCT' | 'TOPPING',
  id: string,
  session: ClientSession,
) {
  const options = { new: true, session, timestamps: false };
  const target =
    type === 'PRODUCT'
      ? await ProductModel.findOneAndUpdate(
          { _id: id, isArchived: false },
          { $inc: { inventoryVersion: 1 } },
          options,
        )
      : await ToppingModel.findOneAndUpdate(
          { _id: id, isArchived: false },
          { $inc: { inventoryVersion: 1 } },
          options,
        );
  if (!target) throw new NotFoundError('Món hoặc topping không còn tồn tại.');
  return target;
}
export async function saveRecipe(
  type: 'PRODUCT' | 'TOPPING',
  id: string,
  input: RecipeSaveInput,
  actorId: string,
) {
  const result = await unitOfWork.withTransaction(async (session) => {
    const target = await lockInventoryTarget(type, id, session);
    const variants = 'variants' in target ? target.variants.map((v) => String(v._id)) : [];
    if (input.variants.some((v) => !variants.includes(v.variantId)))
      throw new ValidationError('Size không thuộc món hoặc topping không hỗ trợ size.');
    const ids = [
      ...new Set(
        [...input.components, ...input.variants.flatMap((v) => v.components)].map(
          (c) => c.ingredientId,
        ),
      ),
    ].sort();
    for (const ingredientId of ids) {
      const ingredient = await IngredientModel.findOneAndUpdate(
        { _id: ingredientId, ...(input.enabled ? { isActive: true } : {}) },
        { $inc: { version: 1 } },
        { new: true, session },
      );
      if (!ingredient)
        throw new ValidationError('Công thức chứa nguyên liệu không tồn tại hoặc đã ngừng dùng.');
    }
    const current = await RecipeModel.findOne({ targetType: type, targetId: id }).session(session);
    if ((current?.version ?? 0) !== input.expectedVersion)
      throw new ConflictError('CONFLICT', 'Công thức vừa được thay đổi. Hãy tải lại.');
    const convert = (lines: RecipeSaveInput['components']) =>
      lines.map((c) => ({
        ingredientId: new Types.ObjectId(c.ingredientId),
        quantity: stockUnits(c.quantity),
      }));
    const data = {
      enabled: input.enabled,
      components: convert(input.components),
      variants: input.variants.map((v) => ({
        variantId: new Types.ObjectId(v.variantId),
        components: convert(v.components),
      })),
      version: input.expectedVersion + 1,
    };
    if (current) {
      current.set(data);
      await current.save({ session });
    } else await RecipeModel.create([{ ...data, targetType: type, targetId: id }], { session });
    await log(
      actorId,
      'inventory.recipeSaved',
      id,
      { targetType: type, enabled: input.enabled, version: data.version },
      session,
    );
    await inventoryChanged(id, data.version, session);
    return { version: data.version };
  });
  await invalidatePublicMenuCache();
  return result;
}

export async function listStockMovements(page: number, ingredientId?: string) {
  const filter = ingredientId ? { ingredientId } : {};
  const total = await StockMovementModel.countDocuments(filter);
  const movements = await StockMovementModel.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .skip((page - 1) * 30)
    .limit(30)
    .populate<{ actorId: { name: string } | null }>('actorId', 'name');
  return {
    total,
    page,
    limit: 30,
    items: movements.map((m) => ({
      id: m.id,
      ingredientId: String(m.ingredientId),
      ingredientName: m.ingredientName,
      unit: m.unit,
      type: m.type,
      quantity: displayUnits(m.quantity),
      onHandAfter: displayUnits(m.onHandAfter),
      reservedAfter: displayUnits(m.reservedAfter),
      reason: m.reason,
      orderId: m.orderId?.toString() ?? null,
      actorName: m.actorId?.name ?? 'Hệ thống',
      createdAt: m.createdAt,
    })),
  };
}
