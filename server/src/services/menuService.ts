import { productRepository } from '../repositories/productRepository.js';
import { categoryRepository } from '../repositories/categoryRepository.js';
import { toppingRepository } from '../repositories/toppingRepository.js';
import { NotFoundError } from '../errors/AppError.js';
import { config } from '../config/index.js';
import {
  cacheGeneration,
  cachedJson,
  incrementCacheGeneration,
} from '../infrastructure/jsonCache.js';
import { applyInventoryAvailability } from './inventoryAvailabilityService.js';

const MENU_CACHE_GENERATION_KEY = 'maycafe:cache:menu:generation';

export async function listPublicMenu() {
  const generation = await cacheGeneration(MENU_CACHE_GENERATION_KEY);
  const menu = await cachedJson(
    `maycafe:cache:menu:${generation}:full`,
    config.menuCacheTtlSeconds,
    async () => {
      const [categories, products, toppings] = await Promise.all([
        categoryRepository.listActive(),
        productRepository.listPublic({ applyInventory: false }),
        toppingRepository.listAvailable(false),
      ]);
      return { categories, products, toppings };
    },
  );
  // Cache catalog only. Stock is read fresh so a delayed outbox/Redis never
  // makes sold-out ingredients appear available or a restock stay hidden.
  await applyInventoryAvailability(menu.products, menu.toppings);
  return {
    ...menu,
    products: menu.products.filter((p) => p.isAvailable),
    toppings: menu.toppings.filter((t) => t.isAvailable),
  };
}

export async function listFeatured(limit?: number) {
  const normalizedLimit = Math.max(1, Math.min(limit ?? 6, 50));
  const generation = await cacheGeneration(MENU_CACHE_GENERATION_KEY);
  const products = await cachedJson(
    `maycafe:cache:menu:${generation}:featured:${normalizedLimit}`,
    config.menuCacheTtlSeconds,
    () => productRepository.listFeatured(50, false),
  );
  await applyInventoryAvailability(products, []);
  return products.filter((p) => p.isAvailable).slice(0, normalizedLimit);
}

export async function invalidatePublicMenuCache(): Promise<void> {
  await incrementCacheGeneration(MENU_CACHE_GENERATION_KEY);
}

export async function getProductDetail(id: string) {
  const product = await productRepository.findById(id);
  if (
    !product ||
    product.isArchived ||
    !(await categoryRepository.findById(String(product.categoryId)))?.isActive
  )
    throw new NotFoundError('Món không tồn tại.');
  await applyInventoryAvailability([product], []);
  return product;
}

export async function listAdminProducts() {
  return productRepository.listAll();
}

export async function listAdminCategories() {
  const [categories, counts] = await Promise.all([
    categoryRepository.listAll(),
    productRepository.countsByCategory(),
  ]);
  return categories.map((category) => ({
    ...category.toObject(),
    productCount: counts.get(category.id) ?? 0,
  }));
}

export async function listAdminToppings() {
  return toppingRepository.listAll();
}

export async function listStaffAvailability() {
  const products = await productRepository.listAll();
  const toppings = await toppingRepository.listAll();
  const effective = await applyInventoryAvailability(
    products.map((p) => p.toObject()),
    toppings.map((t) => t.toObject()),
  );
  return {
    products: products.map((p, index) => ({
      ...p.toObject(),
      effectiveAvailable: effective.products[index]!.isAvailable,
      variants: p.variants.map((v, vi) => ({
        ...v.toObject(),
        effectiveAvailable: effective.products[index]!.variants[vi]!.isAvailable,
      })),
    })),
    toppings: toppings.map((t, index) => ({
      ...t.toObject(),
      effectiveAvailable: effective.toppings[index]!.isAvailable,
    })),
  };
}
