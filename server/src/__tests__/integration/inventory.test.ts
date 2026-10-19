import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { buildApp } from '../../app.js';
import { UserModel } from '../../models/User.js';
import { CategoryModel } from '../../models/Category.js';
import { ProductModel } from '../../models/Product.js';
import { ToppingModel } from '../../models/Topping.js';
import { IngredientModel } from '../../models/Ingredient.js';
import { RecipeModel } from '../../models/Recipe.js';
import { StockMovementModel } from '../../models/StockMovement.js';
import { OrderModel } from '../../models/Order.js';
import { TableModel } from '../../models/Table.js';
import { TableSessionModel } from '../../models/TableSession.js';
import { AuditLogModel } from '../../models/AuditLog.js';
import { OutboxEventModel } from '../../models/OutboxEvent.js';
import {
  createIngredient,
  moveStock,
  saveRecipe,
  updateIngredient,
} from '../../services/inventoryService.js';
import { createOrderQuote, priceOrderItems } from '../../services/orderPricingService.js';
import {
  cancelOrderByGuest,
  placeOrder,
  transitionByStaff,
  type PlaceOrderItemInput,
} from '../../services/orderService.js';
import { refundAndCancelOrder } from '../../services/orderRefundService.js';
import { confirmOrderPayment } from '../../services/paymentService.js';
import { claimPayment } from '../../services/paymentClaimService.js';
import { AIService, validateRecommendedConfiguration } from '../../services/aiService.js';
import { outboxRepository } from '../../repositories/outboxRepository.js';
import { hashPassword, randomToken } from '../../utils/crypto.js';
import { recipeSaveSchema } from '@may-cafe/contracts';

let repl: MongoMemoryReplSet;
let app: ReturnType<typeof buildApp>;
let admin: Record<string, string>;
let staff: Record<string, string>;
let actorId: string;
let ingredientId: string;
let productId: string;
let small: string;
let large: string;
let toppingId: string;
let tableSessionId: string;
const base = '/api/v1/admin/inventory';
const key = () => randomToken(16);
const ingredient = () => IngredientModel.findById(ingredientId).orFail();
const line = (overrides: Partial<PlaceOrderItemInput> = {}): PlaceOrderItemInput => ({
  productId,
  variantId: small,
  sugarLevel: '0%',
  iceLevel: 'normal-ice',
  toppingIds: [],
  quantity: 1,
  ...overrides,
});
async function stock(quantity: number, type: 'RECEIPT' | 'ISSUE' | 'ADJUSTMENT' = 'RECEIPT') {
  return moveStock(
    ingredientId,
    {
      type,
      quantity,
      reason: 'Kiểm tra kho cô lập',
      expectedVersion: (await ingredient()).version,
      idempotencyKey: key(),
    },
    actorId,
  );
}
async function recipe(quantity = 10, extra = {}) {
  return saveRecipe(
    'PRODUCT',
    productId,
    recipeSaveSchema.parse({
      enabled: true,
      components: [{ ingredientId, quantity }],
      variants: [],
      expectedVersion: 0,
      ...extra,
    }),
    actorId,
  );
}
async function session() {
  const table = await TableModel.create({
    code: key(),
    name: 'Bàn kho',
    capacity: 4,
    publicTokenHash: key(),
  });
  return (await TableSessionModel.create({ tableId: table._id })).id;
}
async function order(
  items = [line()],
  sid = tableSessionId,
  idempotencyKey = key(),
  participantId = key(),
) {
  const quote = await createOrderQuote({ tableSessionId: sid, participantId, items });
  return placeOrder({
    tableSessionId: sid,
    participantId,
    items,
    idempotencyKey,
    quoteToken: quote.quoteToken,
  });
}
async function pay(orderId: string, amount?: number) {
  const current = await OrderModel.findById(orderId).orFail();
  const token = key();
  await claimPayment(current.tableSessionId.toString(), actorId, token);
  return confirmOrderPayment({
    orderId,
    expectedVersion: current.version,
    staffId: actorId,
    amount: amount ?? current.total,
    method: 'CASH',
    idempotencyKey: key(),
    claimToken: token,
  });
}
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(repl.getUri());
  app = buildApp();
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  for (const role of ['ADMIN', 'STAFF'] as const) {
    const user = await UserModel.create({
      name: role,
      role,
      email: `${role}@inventory.test`,
      passwordHash: await hashPassword('Password@123'),
    });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'Password@123' });
    expect(login.status).toBe(200);
    if (role === 'ADMIN') {
      admin = { Authorization: `Bearer ${login.body.data.accessToken}` };
      actorId = user.id;
    } else staff = { Authorization: `Bearer ${login.body.data.accessToken}` };
  }
}, 120000);
beforeEach(async () => {
  for (const collection of Object.values(mongoose.connection.collections)) {
    if (!['users', 'refreshsessions'].includes(collection.collectionName))
      await collection.deleteMany({});
  }
  const category = await CategoryModel.create({ name: 'Trà', slug: 'tra' });
  const topping = await ToppingModel.create({ name: 'Trân châu', price: 5000 });
  toppingId = topping.id;
  const product = await ProductModel.create({
    categoryId: category._id,
    name: 'Trà đào',
    slug: 'tra-dao',
    image: '/menu-images/test.webp',
    basePrice: 30000,
    isFeatured: true,
    ingredientMetadata: { caffeine: false, dairy: false },
    variants: [
      { name: 'S', price: 30000 },
      { name: 'L', price: 40000 },
    ],
    allowedOptions: {
      sizes: ['S', 'L'],
      sugarLevels: ['0%'],
      iceLevels: ['normal-ice'],
      toppingIds: [topping._id],
    },
  });
  productId = product.id;
  small = String(product.variants[0]!._id);
  large = String(product.variants[1]!._id);
  ingredientId = (
    await createIngredient(
      { code: 'TEA', name: 'Trà khô', unit: 'g', lowStockThreshold: 5 },
      actorId,
    )
  ).id;
  tableSessionId = await session();
});
afterAll(async () => {
  await mongoose.disconnect();
  await repl.stop();
});

describe('inventory and recipes', () => {
  it('restricts management to ADMIN and rejects invalid bodies, IDs and duplicate ingredient codes', async () => {
    expect((await request(app).get(base)).status).toBe(401);
    expect((await request(app).get(base).set(staff)).status).toBe(403);
    expect((await request(app).post(`${base}/ingredients`).set(staff).send({})).status).toBe(403);
    expect(
      (
        await request(app)
          .post(`${base}/ingredients`)
          .set(admin)
          .send({ code: 'TEA', name: 'Trà', unit: 'g' })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .post(`${base}/ingredients`)
          .set(admin)
          .send({ code: 'NEW', name: 'Mới', unit: 'kg', onHand: 999 })
      ).status,
    ).toBe(422);
    expect(
      (await request(app).post(`${base}/ingredients/nope/movements`).set(admin).send({})).status,
    ).toBe(422);
    expect(
      (await request(app).put(`${base}/recipes/PRODUCT/${productId}`).set(staff).send({})).status,
    ).toBe(403);
    expect((await request(app).get(`${base}/movements?page=-1`).set(admin)).status).toBe(422);
  });

  it('records receipts, issues and absolute counts with audit, history and idempotent retry', async () => {
    const input = {
      type: 'RECEIPT' as const,
      quantity: 20.125,
      reason: 'Nhập tồn đầu',
      expectedVersion: 0,
      idempotencyKey: key(),
    };
    const response = await request(app)
      .post(`${base}/ingredients/${ingredientId}/movements`)
      .set(admin)
      .send(input);
    expect(response.status).toBe(200);
    expect((await moveStock(ingredientId, input, actorId)).replayed).toBe(true);
    expect((await ingredient()).onHand).toBe(20125);
    expect(await StockMovementModel.countDocuments()).toBe(1);
    await expect(moveStock(ingredientId, { ...input, quantity: 3 }, actorId)).rejects.toMatchObject(
      { code: 'IDEMPOTENCY_CONFLICT' },
    );
    await stock(0.125, 'ISSUE');
    await stock(15, 'ADJUSTMENT');
    expect((await ingredient()).onHand).toBe(15000);
    const history = await request(app)
      .get(`${base}/movements?ingredientId=${ingredientId}`)
      .set(admin);
    expect(history.body.data.total).toBe(3);
    expect(history.body.data.items[0]).toMatchObject({
      type: 'ADJUSTMENT',
      quantity: -5,
      onHandAfter: 15,
      actorName: 'ADMIN',
    });
    expect(await AuditLogModel.countDocuments({ action: 'inventory.stockMoved' })).toBe(3);
    expect(await OutboxEventModel.countDocuments({ aggregateType: 'Inventory' })).toBe(3);
  });

  it('rejects stale versions and duplicate concurrent receipt keys without double counting', async () => {
    const input = {
      type: 'RECEIPT' as const,
      quantity: 10,
      reason: 'Nhập đồng thời',
      expectedVersion: 0,
      idempotencyKey: key(),
    };
    const results = await Promise.all([
      moveStock(ingredientId, input, actorId),
      moveStock(ingredientId, input, actorId),
    ]);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect((await ingredient()).onHand).toBe(10000);
    await expect(
      moveStock(ingredientId, { ...input, idempotencyKey: key() }, actorId),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(stock(11, 'ISSUE')).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
  });

  it('validates recipe ingredients, variants, duplicates and optimistic version', async () => {
    const send = (body: object) =>
      request(app)
        .put(`${base}/recipes/PRODUCT/${productId}`)
        .set(admin)
        .send({
          enabled: true,
          components: [{ ingredientId, quantity: 10 }],
          variants: [],
          expectedVersion: 0,
          ...body,
        });
    expect((await send({ components: [] })).status).toBe(422);
    expect(
      (
        await send({
          components: [
            { ingredientId, quantity: 1 },
            { ingredientId, quantity: 2 },
          ],
        })
      ).status,
    ).toBe(422);
    expect((await send({ components: [{ ingredientId, quantity: 0.0001 }] })).status).toBe(422);
    expect(
      (
        await send({
          variants: [
            {
              variantId: String(new mongoose.Types.ObjectId()),
              components: [{ ingredientId, quantity: 2 }],
            },
          ],
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await send({
          components: [{ ingredientId: String(new mongoose.Types.ObjectId()), quantity: 1 }],
        })
      ).status,
    ).toBe(422);
    expect((await send({})).status).toBe(200);
    expect((await send({})).status).toBe(409);
    expect(await RecipeModel.countDocuments()).toBe(1);
  });

  it('keeps existing unconfigured products and legacy orders working without stock changes', async () => {
    const placed = await order();
    expect(placed.order.inventoryState).toBe('NONE');
    await pay(placed.order.id);
    await transitionByStaff(placed.order.id, 'CONFIRMED', { id: actorId });
    await transitionByStaff(placed.order.id, 'PREPARING', { id: actorId });
    expect((await ingredient()).onHand).toBe(0);
    expect(await StockMovementModel.countDocuments()).toBe(0);
  });

  it('hides shortages across menu, featured, search and AI, rejects old carts and restores after receipt', async () => {
    await recipe();
    expect((await request(app).get('/api/v1/categories')).body.data.products).toHaveLength(0);
    expect((await request(app).get('/api/v1/products/featured')).body.data.items).toHaveLength(0);
    expect(
      (await request(app).post('/api/v1/menu/search').send({ query: 'trà đào' })).body.data.items,
    ).toHaveLength(0);
    expect(
      (await new AIService(null, 'fallback').recommend({ prompt: 'trà đào' })).recommendations,
    ).toHaveLength(0);
    expect(
      (
        await validateRecommendedConfiguration({
          productId,
          variantId: small,
          toppingIds: [],
          constraints: {},
        })
      ).valid,
    ).toBe(false);
    await expect(priceOrderItems([line()])).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    await stock(10);
    expect((await request(app).get('/api/v1/categories')).body.data.products).toHaveLength(1);
    expect((await request(app).get('/api/v1/products/featured')).body.data.items).toHaveLength(1);
    expect((await priceOrderItems([line()])).total).toBe(30000);
    expect((await ProductModel.findById(productId))?.isAvailable).toBe(true);
  });

  it('combines duplicate cart lines, size replacement and topping quantities against the same ingredient', async () => {
    await stock(100);
    await recipe(10, {
      variants: [{ variantId: large, components: [{ ingredientId, quantity: 20 }] }],
    });
    await saveRecipe(
      'TOPPING',
      toppingId,
      {
        enabled: true,
        components: [{ ingredientId, quantity: 2.5 }],
        variants: [],
        expectedVersion: 0,
      },
      actorId,
    );
    const placed = await order([
      line({ quantity: 2 }),
      line({ variantId: large, quantity: 2, toppingIds: [toppingId] }),
    ]);
    expect((await ingredient()).reserved).toBe(65000);
    expect(placed.order.inventorySnapshot).toHaveLength(1);
    expect(placed.order.inventorySnapshot[0]!.quantity).toBe(65000);
    await expect(priceOrderItems([line({ quantity: 2, variantId: large })])).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
    });
  });

  it('allows only one of two tables to reserve the last portion', async () => {
    await stock(10);
    await recipe();
    const sid2 = await session();
    const items = [line()];
    const [q1, q2] = await Promise.all([
      createOrderQuote({ tableSessionId, participantId: 'one', items }),
      createOrderQuote({ tableSessionId: sid2, participantId: 'two', items }),
    ]);
    const results = await Promise.allSettled([
      placeOrder({
        tableSessionId,
        participantId: 'one',
        items,
        idempotencyKey: key(),
        quoteToken: q1.quoteToken,
      }),
      placeOrder({
        tableSessionId: sid2,
        participantId: 'two',
        items,
        idempotencyKey: key(),
        quoteToken: q2.quoteToken,
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await OrderModel.countDocuments()).toBe(1);
    expect((await ingredient()).reserved).toBe(10000);
    expect((await ingredient()).onHand).toBe(10000);
  });

  it('does not reserve twice on order replay and releases on guest cancellation', async () => {
    await stock(10);
    await recipe();
    const items = [line()];
    const participantId = key();
    const idempotencyKey = key();
    const q = await createOrderQuote({ tableSessionId, participantId, items });
    const input = {
      tableSessionId,
      participantId,
      items,
      idempotencyKey,
      quoteToken: q.quoteToken,
    };
    const created = await placeOrder(input);
    expect((await placeOrder(input)).created).toBe(false);
    expect((await ingredient()).reserved).toBe(10000);
    expect((await request(app).get('/api/v1/products')).body.data.products).toHaveLength(0);
    await cancelOrderByGuest(created.order.id, participantId);
    expect((await ingredient()).reserved).toBe(0);
    expect((await ingredient()).onHand).toBe(10000);
    expect((await OrderModel.findById(created.order.id))?.inventoryState).toBe('RELEASED');
    expect((await request(app).get('/api/v1/products')).body.data.products).toHaveLength(1);
    expect(await StockMovementModel.countDocuments({ type: 'RELEASE' })).toBe(1);
  });

  it('retains the original reservation after recipe changes and consumes only on PREPARING', async () => {
    await stock(100);
    await recipe();
    const placed = await order();
    await recipe(30, { expectedVersion: 1 });
    await pay(placed.order.id);
    expect((await ingredient()).reserved).toBe(10000);
    await transitionByStaff(placed.order.id, 'CONFIRMED', { id: actorId });
    expect((await ingredient()).onHand).toBe(100000);
    await transitionByStaff(placed.order.id, 'PREPARING', { id: actorId });
    expect((await ingredient()).onHand).toBe(90000);
    expect((await ingredient()).reserved).toBe(0);
    await transitionByStaff(placed.order.id, 'READY', { id: actorId });
    await transitionByStaff(placed.order.id, 'SERVED', { id: actorId });
    expect(await StockMovementModel.countDocuments({ type: 'CONSUME' })).toBe(1);
    expect((await OrderModel.findById(placed.order.id))?.inventoryState).toBe('CONSUMED');
  });

  it('releases a partially paid reservation when money is refunded before preparation', async () => {
    await stock(10);
    await recipe();
    const placed = await order();
    await pay(placed.order.id, 10000);
    const current = await OrderModel.findById(placed.order.id).orFail();
    await refundAndCancelOrder(
      current.id,
      actorId,
      current.version,
      10000,
      'CASH',
      'Khách đổi ý trước pha chế',
    );
    expect((await ingredient()).onHand).toBe(10000);
    expect((await ingredient()).reserved).toBe(0);
    expect((await OrderModel.findById(current.id))?.inventoryState).toBe('RELEASED');
  });

  it('blocks counts below reservations and deactivation until held orders are cancelled', async () => {
    await stock(20);
    await recipe();
    const placed = await order();
    await expect(stock(5, 'ADJUSTMENT')).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    await expect(stock(11, 'ISSUE')).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    const current = await ingredient();
    await expect(
      updateIngredient(
        ingredientId,
        {
          name: current.name,
          lowStockThreshold: 0,
          isActive: false,
          expectedVersion: current.version,
        },
        actorId,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await cancelOrderByGuest(placed.order.id, placed.order.participantId);
    await updateIngredient(
      ingredientId,
      {
        name: current.name,
        lowStockThreshold: 0,
        isActive: false,
        expectedVersion: (await ingredient()).version,
      },
      actorId,
    );
    await expect(priceOrderItems([line()])).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
  });

  it('rolls back the order, reservation, ledger and outbox together on failure', async () => {
    await stock(20);
    await recipe();
    const beforeMovements = await StockMovementModel.countDocuments();
    const beforeEvents = await OutboxEventModel.countDocuments();
    const fail = vi
      .spyOn(outboxRepository, 'createRealtimeEvents')
      .mockRejectedValueOnce(new Error('forced outbox failure'));
    try {
      await expect(order()).rejects.toThrow('forced outbox failure');
    } finally {
      fail.mockRestore();
    }
    expect(await OrderModel.countDocuments()).toBe(0);
    expect((await ingredient()).reserved).toBe(0);
    expect(await StockMovementModel.countDocuments()).toBe(beforeMovements);
    expect(await OutboxEventModel.countDocuments()).toBe(beforeEvents);
  });

  it('never overrides a manual stop when ingredients are restocked', async () => {
    await recipe();
    await ProductModel.findByIdAndUpdate(productId, { isAvailable: false });
    await stock(100);
    expect((await request(app).get('/api/v1/products')).body.data.products).toHaveLength(0);
    const availability = (await request(app).get('/api/v1/staff/catalog/availability').set(staff))
      .body.data;
    expect(availability.products[0]).toMatchObject({
      isAvailable: false,
      effectiveAvailable: false,
    });
  });
});
