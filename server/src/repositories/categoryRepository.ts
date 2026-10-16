import type { ClientSession } from 'mongoose';
import { CategoryModel, type CategoryDoc } from '../models/Category.js';

export const categoryRepository = {
  async listActive(session?: ClientSession | null): Promise<CategoryDoc[]> {
    return CategoryModel.find({ isActive: true })
      .sort({ sortOrder: 1, name: 1 })
      .session(session ?? null);
  },
  async listAll(): Promise<CategoryDoc[]> {
    return CategoryModel.find().sort({ sortOrder: 1, name: 1 });
  },
  async findById(id: string, session?: ClientSession | null): Promise<CategoryDoc | null> {
    return CategoryModel.findById(id, null, { session: session ?? undefined });
  },
  async create(
    data: { name: string; slug: string; sortOrder?: number },
    session?: ClientSession | null,
  ): Promise<CategoryDoc> {
    const [created] = await CategoryModel.create([data], { session: session ?? undefined });
    if (!created) throw new Error('Failed to create category');
    return created;
  },
  async update(
    id: string,
    update: Partial<{ name: string; sortOrder: number; isActive: boolean }>,
    session?: ClientSession | null,
  ) {
    return CategoryModel.findByIdAndUpdate(
      id,
      { $set: update, $inc: { version: 1 } },
      { new: true, session: session ?? undefined },
    );
  },
  async delete(id: string, session: ClientSession) {
    return CategoryModel.findByIdAndDelete(id, { session });
  },
};
