import type { ClientSession } from 'mongoose';
import { IngredientModel } from '../models/Ingredient.js';
import { RecipeModel, type RecipeData } from '../models/Recipe.js';
import { ConflictError } from '../errors/AppError.js';

export interface InventoryItem {
  freestyle?: { components: { ingredientId: { toString(): string }; quantity: number }[] };
  productId: { toString(): string };
  variantId?: { toString(): string } | null;
  toppingIds: Array<{ toString(): string }>;
  quantity: number;
}
export interface InventoryRequirement {
  ingredientId: string;
  quantity: number;
}
export const stockUnits = (quantity: number): number => Math.round(quantity * 1000);
export const displayUnits = (quantity: number): number => quantity / 1000;
export const recipeKey = (type: string, id: { toString(): string }): string => `${type}:${id}`;

export async function inventoryContext(session?: ClientSession | null) {
  const recipes = await RecipeModel.find({ enabled: true })
    .session(session ?? null)
    .lean();
  const ingredients = await IngredientModel.find({})
    .session(session ?? null)
    .lean();
  return {
    recipes: new Map(recipes.map((r) => [recipeKey(r.targetType, r.targetId), r])),
    ingredients: new Map(ingredients.map((i) => [String(i._id), i])),
  };
}
type InventoryContext = Awaited<ReturnType<typeof inventoryContext>>;

function components(recipe: RecipeData | undefined, variantId?: { toString(): string } | null) {
  if (!recipe) return [];
  return (
    recipe.variants.find((v) => String(v.variantId) === String(variantId))?.components ??
    recipe.components
  );
}
export function inventoryRequirements(
  items: InventoryItem[],
  context: InventoryContext,
): InventoryRequirement[] {
  const totals = new Map<string, number>();
  for (const item of items) {
    const lines = [
      ...(item.freestyle
        ? item.freestyle.components
        : components(context.recipes.get(recipeKey('PRODUCT', item.productId)), item.variantId)),
      ...item.toppingIds.flatMap((id) => components(context.recipes.get(recipeKey('TOPPING', id)))),
    ];
    for (const line of lines) {
      const id = String(line.ingredientId);
      totals.set(id, (totals.get(id) ?? 0) + line.quantity * item.quantity);
    }
  }
  return [...totals]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ingredientId, quantity]) => ({ ingredientId, quantity }));
}
function enough(requirements: InventoryRequirement[], context: InventoryContext) {
  return requirements.every(({ ingredientId, quantity }) => {
    const ingredient = context.ingredients.get(ingredientId);
    return ingredient?.isActive && ingredient.onHand - ingredient.reserved >= quantity;
  });
}
export async function assertInventoryAvailable(
  items: InventoryItem[],
  session?: ClientSession | null,
) {
  const context = await inventoryContext(session);
  const requirements = inventoryRequirements(items, context);
  if (!enough(requirements, context))
    throw new ConflictError(
      'INSUFFICIENT_STOCK',
      'Không đủ nguyên liệu cho số lượng hoặc tùy chọn đã chọn. Vui lòng cập nhật giỏ hàng.',
    );
  return requirements;
}

interface StockProduct {
  _id: { toString(): string };
  isAvailable: boolean;
  variants: Array<{ _id?: { toString(): string } | null; isAvailable?: boolean | null }>;
  allowedOptions?: { sizes?: string[] };
}
interface StockTopping {
  _id: { toString(): string };
  isAvailable: boolean;
}
// Mutate only response documents (never save); manual availability stays intact in DB.
export async function applyInventoryAvailability<P extends StockProduct, T extends StockTopping>(
  products: P[],
  toppings: T[],
) {
  const context = await inventoryContext();
  for (const product of products) {
    const check = (variantId?: { toString(): string } | null) =>
      enough(
        inventoryRequirements(
          [{ productId: product._id, variantId, toppingIds: [], quantity: 1 }],
          context,
        ),
        context,
      );
    for (const variant of product.variants)
      variant.isAvailable = variant.isAvailable !== false && check(variant._id);
    const hasSize = product.variants.length
      ? product.variants.some((v) => v.isAvailable !== false)
      : check();
    product.isAvailable = product.isAvailable && hasSize;
  }
  for (const topping of toppings) {
    const requirements = components(context.recipes.get(recipeKey('TOPPING', topping._id))).map(
      (c) => ({ ingredientId: String(c.ingredientId), quantity: c.quantity }),
    );
    topping.isAvailable = topping.isAvailable && enough(requirements, context);
  }
  return { products, toppings };
}
