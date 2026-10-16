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

const MENU_CACHE_GENERATION_KEY = 'maycafe:cache:menu:generation';

export async function listPublicMenu() {
  const generation = await cacheGeneration(MENU_CACHE_GENERATION_KEY);
  return cachedJson(
    `maycafe:cache:menu:${generation}:full`,
    config.menuCacheTtlSeconds,
    async () => {
      const [categories, products, toppings] = await Promise.all([
        categoryRepository.listActive(),
        productRepository.listPublic({}),
        toppingRepository.listAvailable(),
      ]);
      return { categories, products, toppings };
    },
  );
}

export async function listFeatured(limit?: number) {
  const normalizedLimit = Math.max(1, Math.min(limit ?? 6, 50));
  const generation = await cacheGeneration(MENU_CACHE_GENERATION_KEY);
  return cachedJson(
    `maycafe:cache:menu:${generation}:featured:${normalizedLimit}`,
    config.menuCacheTtlSeconds,
    () => productRepository.listFeatured(normalizedLimit),
  );
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
