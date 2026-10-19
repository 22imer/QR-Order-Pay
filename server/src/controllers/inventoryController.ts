import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  inventoryIdSchema,
  ingredientCreateSchema,
  ingredientUpdateSchema,
  recipeSaveSchema,
  stockMovementRequestSchema,
} from '@may-cafe/contracts';
import * as inventory from '../services/inventoryService.js';

type Work = (req: Request) => Promise<unknown>;
function handler(work: Work, status = 200) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.status(status).json({ success: true, data: await work(req) });
    } catch (error) {
      next(error);
    }
  };
}
const id = (req: Request) => inventoryIdSchema.parse(req.params['id']);
export const overview = handler(() => inventory.inventoryOverview());
export const createIngredient = handler(
  async (req) => ({
    ingredient: await inventory.createIngredient(
      ingredientCreateSchema.parse(req.body),
      req.user!.id,
    ),
  }),
  201,
);
export const updateIngredient = handler(async (req) => ({
  ingredient: await inventory.updateIngredient(
    id(req),
    ingredientUpdateSchema.parse(req.body),
    req.user!.id,
  ),
}));
export const moveStock = handler((req) =>
  inventory.moveStock(id(req), stockMovementRequestSchema.parse(req.body), req.user!.id),
);
export const saveRecipe = handler((req) =>
  inventory.saveRecipe(
    z.enum(['PRODUCT', 'TOPPING']).parse(req.params['type']),
    id(req),
    recipeSaveSchema.parse(req.body),
    req.user!.id,
  ),
);
export const movements = handler((req) => {
  const page = z.coerce.number().int().min(1).max(100000).default(1).parse(req.query.page);
  const ingredientId = inventoryIdSchema.optional().parse(req.query.ingredientId);
  return inventory.listStockMovements(page, ingredientId);
});
