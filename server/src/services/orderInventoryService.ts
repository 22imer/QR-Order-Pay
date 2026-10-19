import type { ClientSession } from 'mongoose';
import { IngredientModel } from '../models/Ingredient.js';
import { OrderModel, type OrderDoc } from '../models/Order.js';
import { StockMovementModel } from '../models/StockMovement.js';
import { ConflictError } from '../errors/AppError.js';
import { assertInventoryAvailable, type InventoryItem } from './inventoryAvailabilityService.js';
import { inventoryChanged, lockInventoryTarget } from './inventoryService.js';

export async function reserveOrderInventory(
  items: InventoryItem[],
  orderId: string,
  session: ClientSession,
) {
  const targets = new Map<string, { type: 'PRODUCT' | 'TOPPING'; id: string }>();
  for (const item of items) {
    targets.set(`PRODUCT:${item.productId}`, { type: 'PRODUCT', id: String(item.productId) });
    for (const id of item.toppingIds)
      targets.set(`TOPPING:${id}`, { type: 'TOPPING', id: String(id) });
  }
  for (const [, target] of [...targets].sort(([a], [b]) => a.localeCompare(b)))
    await lockInventoryTarget(target.type, target.id, session);
  const requirements = await assertInventoryAvailable(items, session);
  for (const line of requirements) {
    const ingredient = await IngredientModel.findOneAndUpdate(
      {
        _id: line.ingredientId,
        isActive: true,
        $expr: { $gte: [{ $subtract: ['$onHand', '$reserved'] }, line.quantity] },
      },
      { $inc: { reserved: line.quantity, version: 1 } },
      { new: true, session },
    );
    if (!ingredient)
      throw new ConflictError(
        'INSUFFICIENT_STOCK',
        'Nguyên liệu vừa hết. Vui lòng cập nhật giỏ hàng.',
      );
    await StockMovementModel.create(
      [
        {
          ingredientId: ingredient._id,
          ingredientName: ingredient.name,
          unit: ingredient.unit,
          type: 'RESERVE',
          quantity: line.quantity,
          onHandAfter: ingredient.onHand,
          reservedAfter: ingredient.reserved,
          reason: 'Giữ nguyên liệu cho đơn mới',
          orderId,
        },
      ],
      { session },
    );
    await inventoryChanged(ingredient.id, ingredient.version, session);
  }
  return requirements.map((r) => ({ ...r }));
}

export async function settleOrderInventory(
  order: OrderDoc,
  next: string,
  actorId: string | null,
  session: ClientSession,
) {
  if (order.inventoryState !== 'RESERVED' || !['PREPARING', 'CANCELLED'].includes(next)) return;
  const consume = next === 'PREPARING';
  for (const line of order.inventorySnapshot) {
    const ingredient = await IngredientModel.findOneAndUpdate(
      {
        _id: line.ingredientId,
        reserved: { $gte: line.quantity },
        ...(consume ? { onHand: { $gte: line.quantity } } : {}),
      },
      { $inc: { reserved: -line.quantity, onHand: consume ? -line.quantity : 0, version: 1 } },
      { new: true, session },
    );
    if (!ingredient)
      throw new ConflictError(
        'INVENTORY_CONFLICT',
        'Không thể đối chiếu lượng nguyên liệu đã giữ. Cần quản trị viên kiểm tra kho.',
      );
    await StockMovementModel.create(
      [
        {
          ingredientId: ingredient._id,
          ingredientName: ingredient.name,
          unit: ingredient.unit,
          type: consume ? 'CONSUME' : 'RELEASE',
          quantity: consume ? -line.quantity : line.quantity,
          onHandAfter: ingredient.onHand,
          reservedAfter: ingredient.reserved,
          reason: consume
            ? 'Xuất nguyên liệu khi bắt đầu pha chế'
            : 'Trả nguyên liệu giữ do hủy đơn',
          orderId: order._id,
          actorId,
        },
      ],
      { session },
    );
    await inventoryChanged(ingredient.id, ingredient.version, session);
  }
  order.inventoryState = consume ? 'CONSUMED' : 'RELEASED';
  await OrderModel.updateOne(
    { _id: order._id },
    { $set: { inventoryState: order.inventoryState } },
    { session },
  );
}
