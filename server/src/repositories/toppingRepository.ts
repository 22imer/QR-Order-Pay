import type { ClientSession } from 'mongoose';
import { ToppingModel, type ToppingDoc } from '../models/Topping.js';
import { applyInventoryAvailability } from '../services/inventoryAvailabilityService.js';

export const toppingRepository = {
  async listAvailable(applyInventory = true): Promise<ToppingDoc[]> {
    const toppings = await ToppingModel.find({ isArchived: false, isAvailable: true }).sort({
      name: 1,
    });
    if (applyInventory) await applyInventoryAvailability([], toppings);
    return toppings.filter((t) => t.isAvailable);
  },
  async listAll(): Promise<ToppingDoc[]> {
    return ToppingModel.find().sort({ name: 1 });
  },
  async findManyByIds(ids: string[], session?: ClientSession | null): Promise<ToppingDoc[]> {
    return ToppingModel.find({ _id: { $in: ids } }, null, { session: session ?? undefined });
  },
  async findById(id: string, session?: ClientSession | null): Promise<ToppingDoc | null> {
    return ToppingModel.findById(id, null, { session: session ?? undefined });
  },
  async create(
    data: { name: string; price: number; isAvailable?: boolean },
    session?: ClientSession | null,
  ) {
    const [created] = await ToppingModel.create([data], { session: session ?? undefined });
    if (!created) throw new Error('Failed to create topping');
    return created;
  },
  async update(
    id: string,
    update: Partial<{ name: string; price: number; isAvailable: boolean; isArchived: boolean }>,
    session?: ClientSession | null,
  ) {
    return ToppingModel.findByIdAndUpdate(
      id,
      { $set: update, $inc: { version: 1 } },
      { new: true, session: session ?? undefined },
    );
  },
};
