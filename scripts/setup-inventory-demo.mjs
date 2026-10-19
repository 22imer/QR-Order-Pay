// Additive API-based setup. Default: validate/preview. Never resets a database.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ingredientCreateSchema,
  inventoryQuantitySchema,
  recipeSaveSchema,
} from '@may-cafe/contracts';

const plan = JSON.parse(
  await readFile(new URL('../docs/data/inventory-demo.json', import.meta.url), 'utf8'),
);
const apply = process.argv.includes('--apply');
const base = (process.env.INVENTORY_API_URL ?? 'http://localhost:8082/api/v1').replace(/\/$/, '');
const email = process.env.INVENTORY_ADMIN_EMAIL ?? 'admin@maycafe.vn';
const password = process.env.INVENTORY_ADMIN_PASSWORD;
if (!password)
  throw new Error(
    'Set INVENTORY_ADMIN_PASSWORD in the process environment; it is never written to files.',
  );
const normalizeLines = (lines) =>
  [...lines]
    .map((c) => ({ ingredientId: c.ingredientId, quantity: c.quantity }))
    .sort((a, b) => a.ingredientId.localeCompare(b.ingredientId));
const normalizeRecipe = (r) =>
  JSON.stringify({
    enabled: r.enabled,
    components: normalizeLines(r.components),
    variants: [...r.variants]
      .map((v) => ({ variantId: v.variantId, components: normalizeLines(v.components) }))
      .sort((a, b) => a.variantId.localeCompare(b.variantId)),
  });
const businessProduct = (p) =>
  JSON.stringify({
    id: p._id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    categoryId: p.categoryId,
    basePrice: p.basePrice,
    image: p.image,
    variants: p.variants,
    allowedOptions: p.allowedOptions,
    tags: p.tags,
    isAvailable: p.isAvailable,
    isArchived: p.isArchived,
  });
const businessTopping = (t) =>
  JSON.stringify({
    id: t._id,
    name: t.name,
    price: t.price,
    isAvailable: t.isAvailable,
    isArchived: t.isArchived,
  });

let token = '',
  cookies = '';
async function api(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  const json = await response.json();
  if (!response.ok)
    throw new Error(
      `${method} ${path}: ${response.status} ${json.error?.code ?? ''} ${json.error?.message ?? ''}`,
    );
  return json.data;
}
async function overview() {
  return api('/admin/inventory');
}
async function run() {
  const login = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(15000),
  });
  if (!login.ok) throw new Error(`Admin login failed: HTTP ${login.status}`);
  cookies = login.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const auth = (await login.json()).data;
  token = auth.accessToken;
  if (auth.user.role !== 'ADMIN') throw new Error('An ADMIN account is required.');
  const allProducts = (await api('/admin/products')).products;
  const allToppings = (await api('/admin/toppings')).toppings;
  const initial = await overview();
  const ingredientCodes = new Set();
  for (const i of plan.ingredients) {
    ingredientCreateSchema.parse({
      code: i.code,
      name: i.name,
      unit: i.unit,
      lowStockThreshold: i.lowStockThreshold,
    });
    inventoryQuantitySchema.parse(i.openingStock);
    if (i.openingStock <= 0 || ingredientCodes.has(i.code))
      throw new Error(`Invalid/duplicate ingredient: ${i.code}`);
    ingredientCodes.add(i.code);
    const existing = initial.ingredients.find((e) => e.code === i.code);
    if (existing && (existing.name !== i.name || existing.unit !== i.unit || !existing.isActive))
      throw new Error(
        `Existing ingredient differs or is inactive: ${i.code}. Refusing to overwrite.`,
      );
  }
  const recipePlans = [];
  function target(type, row) {
    const candidates =
      type === 'PRODUCT'
        ? allProducts.filter((p) => p.slug === row.slug && !p.isArchived)
        : allToppings.filter((t) => t.name === row.name && !t.isArchived);
    if (candidates.length !== 1)
      throw new Error(`Expected one active catalog target: ${row.slug ?? row.name}`);
    const entity = candidates[0];
    const variants = Object.entries(row.sizes ?? {}).map(([name, lines]) => {
      const matches = entity.variants.filter((v) => v.name === name);
      if (matches.length !== 1) throw new Error(`Missing/ambiguous size ${name} on ${entity.name}`);
      return { variantId: matches[0]._id, lines };
    });
    for (const lines of [row.base, ...variants.map((v) => v.lines)]) {
      if (!Object.keys(lines).length) throw new Error(`Empty recipe: ${entity.name}`);
      for (const [code, quantity] of Object.entries(lines)) {
        if (!ingredientCodes.has(code) || inventoryQuantitySchema.parse(quantity) <= 0)
          throw new Error(`Invalid recipe component ${code} on ${entity.name}`);
      }
    }
    recipePlans.push({ type, entity, base: row.base, variants });
  }
  plan.products.forEach((p) => target('PRODUCT', p));
  plan.toppings.forEach((t) => target('TOPPING', t));
  if (new Set(recipePlans.map((r) => `${r.type}:${r.entity._id}`)).size !== recipePlans.length)
    throw new Error('Duplicate recipe target in plan.');
  for (const entity of allProducts.filter((p) => !p.isArchived))
    if (!recipePlans.some((r) => r.type === 'PRODUCT' && r.entity._id === entity._id))
      throw new Error(`Uncovered product: ${entity.name}`);
  for (const entity of allToppings.filter((t) => !t.isArchived))
    if (!recipePlans.some((r) => r.type === 'TOPPING' && r.entity._id === entity._id))
      throw new Error(`Uncovered topping: ${entity.name}`);
  const ids = new Map(initial.ingredients.map((i) => [i.code, i.id]));
  function payload(r, version = 0, preview = false) {
    const lines = (items) =>
      Object.entries(items).map(([code, quantity], index) => {
        if (!ids.has(code) && !preview) throw new Error(`Ingredient has not been created: ${code}`);
        return { ingredientId: ids.get(code) ?? String(index + 1).padStart(24, '0'), quantity };
      });
    return recipeSaveSchema.parse({
      enabled: true,
      components: lines(r.base),
      variants: r.variants.map((v) => ({ variantId: v.variantId, components: lines(v.lines) })),
      expectedVersion: version,
    });
  }
  for (const r of recipePlans) {
    payload(r, 0, true);
    const existing = initial.recipes.find(
      (e) => e.targetType === r.type && e.targetId === r.entity._id,
    );
    if (existing && normalizeRecipe(existing) !== normalizeRecipe(payload(r)))
      throw new Error(`Existing recipe differs: ${r.entity.name}. Refusing to overwrite.`);
  }
  const summary = {
    dataset: plan.dataset,
    mode: apply ? 'apply' : 'preview',
    ingredientCount: plan.ingredients.length,
    productRecipes: plan.products.length,
    toppingRecipes: plan.toppings.length,
    existingIngredients: initial.ingredients.length,
    existingRecipes: initial.recipes.length,
  };
  console.log(JSON.stringify(summary));
  if (!apply) {
    console.log(
      'Preview validated; rerun with --apply to create missing records and replay fixed-key opening receipts.',
    );
    return;
  }
  const output =
    process.env.INVENTORY_SETUP_REPORT ??
    resolve(
      fileURLToPath(new URL('../.cache', import.meta.url)),
      'inventory-demo-setup-report.json',
    );
  await mkdir(dirname(output), { recursive: true });
  const createdIngredients = [],
    receiptIds = [],
    savedRecipes = [];
  const reason = `Nhập tồn mẫu BTL Fantastic cafe (${plan.dataset})`;
  for (const i of plan.ingredients) {
    if (!ids.has(i.code)) {
      const result = await api('/admin/inventory/ingredients', 'POST', {
        code: i.code,
        name: i.name,
        unit: i.unit,
        lowStockThreshold: i.lowStockThreshold,
      });
      ids.set(i.code, result.ingredient.id);
      createdIngredients.push(i.code);
    }
    const id = ids.get(i.code);
    const current = (await overview()).ingredients.find((e) => e.id === id);
    const idempotencyKey = `inv-demo-v1:${i.code}`;
    const receipt = await api(`/admin/inventory/ingredients/${id}/movements`, 'POST', {
      type: 'RECEIPT',
      quantity: i.openingStock,
      reason,
      expectedVersion: current.version,
      idempotencyKey,
    });
    receiptIds.push({ code: i.code, id: receipt.id, replayed: receipt.replayed });
  }
  for (const r of recipePlans) {
    const current = (await overview()).recipes.find(
      (e) => e.targetType === r.type && e.targetId === r.entity._id,
    );
    const desired = payload(r, current?.version ?? 0);
    if (current) {
      if (normalizeRecipe(current) !== normalizeRecipe(desired))
        throw new Error(`Recipe changed during setup: ${r.entity.name}`);
      continue;
    }
    const result = await api(`/admin/inventory/recipes/${r.type}/${r.entity._id}`, 'PUT', desired);
    savedRecipes.push({
      type: r.type,
      id: r.entity._id,
      name: r.entity.name,
      version: result.version,
    });
  }
  const final = await overview();
  const afterProducts = (await api('/admin/products')).products;
  const afterToppings = (await api('/admin/toppings')).toppings;
  if (
    allProducts.map(businessProduct).sort().join('\n') !==
    afterProducts.map(businessProduct).sort().join('\n')
  )
    throw new Error(
      'Catalog product business fields changed during setup; inspect before continuing.',
    );
  if (
    allToppings.map(businessTopping).sort().join('\n') !==
    afterToppings.map(businessTopping).sort().join('\n')
  )
    throw new Error('Topping business fields changed during setup; inspect before continuing.');
  if (final.recipes.filter((r) => r.enabled).length < recipePlans.length)
    throw new Error('Not all recipes were enabled.');
  const report = {
    ...summary,
    createdIngredients,
    receiptIds,
    savedRecipes,
    ingredients: final.ingredients,
    recipes: final.recipes,
    catalogBusinessFieldsPreserved: true,
    verifiedAt: new Date().toISOString(),
  };
  await writeFile(output, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      completed: true,
      createdIngredients: createdIngredients.length,
      newReceipts: receiptIds.filter((r) => !r.replayed).length,
      replayedReceipts: receiptIds.filter((r) => r.replayed).length,
      savedRecipes: savedRecipes.length,
      totalIngredients: final.ingredients.length,
      totalRecipes: final.recipes.length,
      catalogBusinessFieldsPreserved: true,
      report: output,
    }),
  );
}
try {
  await run();
} finally {
  if (cookies)
    await fetch(`${base}/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookies },
      signal: AbortSignal.timeout(15000),
    });
}
