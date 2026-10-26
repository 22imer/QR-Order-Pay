import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { randomUUID, createHash } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ingredientUpdateSchema } from '@may-cafe/contracts';
import { buildApp } from '../../app.js';
import { config } from '../../config/index.js';
import { UserModel } from '../../models/User.js';
import { CategoryModel } from '../../models/Category.js';
import { ProductModel } from '../../models/Product.js';
import { IngredientModel } from '../../models/Ingredient.js';
import { RecipeModel } from '../../models/Recipe.js';
import { TableModel } from '../../models/Table.js';
import { TableSessionModel } from '../../models/TableSession.js';
import { OrderModel } from '../../models/Order.js';
import { PaymentModel } from '../../models/Payment.js';
import { BillModel } from '../../models/Bill.js';
import { signAccessToken } from '../../utils/crypto.js';
import { smartInsights, companions } from '../../services/insightsService.js';
import { updateIngredient } from '../../services/inventoryService.js';
let repl: MongoMemoryReplSet, app: ReturnType<typeof buildApp>;
let admin: string,
  token: string,
  staffToken: string,
  a: string,
  b: string,
  c: string,
  ingredient: string,
  sid: string,
  tableId: string,
  categoryId: string;
const now = new Date('2026-10-23T12:00:00+07:00'),
  range = { from: '2026-10-01', to: '2026-10-22', channel: 'ALL' };
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
function row(ids: string[], index: number, extra = {}) {
  return {
    tableId,
    tableSessionId: sid,
    participantId: `private-guest-${index}`,
    code: `TEST${randomUUID()}`,
    idempotencyKey: randomUUID(),
    requestHash: 'fixture',
    status: 'SERVED',
    paymentStatus: 'PAID',
    paidAmount: ids.length * 30000,
    total: ids.length * 30000,
    createdAt: new Date(`2026-10-${20 + (index % 3)}T09:00:00+07:00`),
    items: ids.map((id) => ({
      productId: id,
      variantId: null,
      sugarLevel: '0%',
      iceLevel: 'no-ice',
      toppingIds: [],
      quantity: 1,
      unitPrice: 30000,
      lineTotal: 30000,
      nameSnapshot: id === a ? 'Trà A' : id === b ? 'Bánh B' : 'Món C',
    })),
    ...extra,
  };
}
async function patterns() {
  const rows = Array.from({ length: 50 }, (_, i) =>
    row(i < 10 ? [a, b] : i < 20 ? [a] : i < 30 ? [b] : [c], i),
  );
  await OrderModel.insertMany(rows);
}
const publicQuery = () => ({ context: 'TABLE', productIds: a });
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(repl.getUri());
  app = buildApp();
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
}, 120000);
beforeEach(async () => {
  for (const collection of Object.values(mongoose.connection.collections))
    await collection.deleteMany({});
  const u = await UserModel.create({
    name: 'Admin',
    role: 'ADMIN',
    email: 'insights@admin.test',
    passwordHash: 'unused',
  });
  admin = u.id;
  token = signAccessToken({ sub: u.id, role: 'ADMIN', name: u.name });
  const staff = await UserModel.create({
    name: 'Staff',
    role: 'STAFF',
    email: 'insights@staff.test',
    passwordHash: 'unused',
  });
  staffToken = signAccessToken({ sub: staff.id, role: 'STAFF', name: staff.name });
  const table = await TableModel.create({
    code: 'I1',
    name: 'Bàn mẫu',
    capacity: 4,
    publicTokenHash: 'isolated',
  });
  tableId = table.id;
  sid = (await TableSessionModel.create({ tableId })).id;
  categoryId = (await CategoryModel.create({ name: 'Menu', slug: 'menu' })).id;
  const products = await ProductModel.insertMany(
    ['Trà A', 'Bánh B', 'Món C'].map((name, i) => ({
      categoryId,
      name,
      slug: `item-${i}`,
      image: '/favicon.svg',
      basePrice: 30000,
      allowedOptions: { sizes: [], sugarLevels: ['0%'], iceLevels: ['no-ice'], toppingIds: [] },
    })),
  );
  [a, b, c] = products.map((p) => p.id) as [string, string, string];
  ingredient = (
    await IngredientModel.create({
      code: 'TEA',
      name: 'Trà nguyên liệu',
      unit: 'g',
      onHand: 1000000,
    })
  ).id;
  await RecipeModel.create({
    targetType: 'PRODUCT',
    targetId: a,
    enabled: true,
    components: [{ ingredientId: ingredient, quantity: 10000 }],
  });
});
afterAll(async () => {
  await mongoose.disconnect();
  await repl.stop();
});
describe('Smart Insights and companions', () => {
  it('requires ADMIN, validates ranges and keeps internal/guest portals separated', async () => {
    expect((await request(app).get('/api/v1/admin/insights').query(range)).status).toBe(401);
    expect(
      (
        await request(app)
          .get('/api/v1/admin/insights')
          .query(range)
          .auth(staffToken, { type: 'bearer' })
      ).status,
    ).toBe(403);
    const good = await request(app)
      .get('/api/v1/admin/insights')
      .query(range)
      .auth(token, { type: 'bearer' });
    expect(good.status).toBe(200);
    expect(good.headers['cache-control']).toBe('no-store');
    for (const query of [
      { ...range, from: '2026-02-30' },
      { ...range, from: '2026-01-01' },
      { ...range, from: '2026-10-23' },
      { ...range, injected: 'x' },
    ])
      expect(
        (
          await request(app)
            .get('/api/v1/admin/insights')
            .query(query)
            .auth(token, { type: 'bearer' })
        ).status,
      ).toBe(422);
    const old = config.trafficClass;
    try {
      Object.assign(config, { trafficClass: 'guest' });
      expect(
        (await request(app).get('/api/v1/admin/insights').auth(token, { type: 'bearer' })).status,
      ).toBe(404);
      Object.assign(config, { trafficClass: 'internal' });
      expect(
        (await request(app).get('/api/v1/recommendations/companions').query(publicQuery())).status,
      ).toBe(404);
    } finally {
      Object.assign(config, { trafficClass: old });
    }
  });
  it('returns empty reports with honest cost gaps and never invents pairs or margins', async () => {
    const result = await smartInsights(range, now);
    expect(result.summary).toEqual({ orderValue: 0, cups: 0, averageOrderValue: 0 });
    expect(result.pairs).toEqual([]);
    expect(result.comparison.orderChangePct).toBeNull();
    expect(result.advice.map((x) => x.code)).toContain('LOW_SAMPLE');
    expect(result.margins).toMatchObject({ totalVariants: 3, completeVariants: 0 });
    expect(
      result.margins.items.every((i) => i.ingredientCost === null && i.grossMargin === null),
    ).toBe(true);
    expect(await companions(publicQuery(), now)).toEqual({ items: [] });
    expect((await IngredientModel.findById(ingredient)?.lean())?.unitCost).toBeUndefined();
  });
  it('counts only served fully paid orders, excluding refund, unpaid, pending, cancellation and no-show', async () => {
    await OrderModel.insertMany([
      row([a], 0),
      row([a], 1, { status: 'CANCELLED' }),
      row([a], 2, { paymentStatus: 'REFUNDED' }),
      row([a], 3, { paymentStatus: 'UNPAID' }),
      row([a], 4, { status: 'PREPARING' }),
      row([a], 5, {
        fulfillmentType: 'TAKEAWAY',
        tableId: null,
        tableSessionId: null,
        pickup: { name: 'Private', phone: '0901234567', outcome: 'NO_SHOW' },
      }),
    ]);
    const r = await smartInsights(range, now);
    expect(r.sample.orders).toBe(1);
    expect(r.summary.orderValue).toBe(30000);
    expect(r.topProducts[0]?.orders).toBe(1);
    const serialized = JSON.stringify(r);
    expect(serialized).not.toContain('private-guest');
    expect(serialized).not.toContain('0901234567');
    expect(serialized).not.toContain(sid);
  });
  it('uses VN day boundaries and created hour, total after discounts but line value before discounts', async () => {
    await OrderModel.insertMany([
      row([a], 0, { createdAt: new Date('2026-09-30T17:00:00Z'), total: 25000, paidAmount: 25000 }),
      row([a], 1, { createdAt: new Date('2026-09-30T16:59:59Z') }),
      row([a], 2, { createdAt: new Date('2026-10-22T17:00:00Z') }),
    ]);
    const r = await smartInsights(range, now);
    expect(r.sample.orders).toBe(1);
    expect(r.hours[0]?.orders).toBe(1);
    expect(r.summary.orderValue).toBe(25000);
    expect(r.topProducts[0]?.grossValue).toBe(30000);
  });
  it('deduplicates variants and quantities per basket, produces support/confidence/lift and stable recommendations', async () => {
    await patterns();
    const r = await smartInsights(range, now);
    expect(r.sample).toMatchObject({ orders: 50, activeDays: 3, patternOrders: 50 });
    expect(r.pairs[0]).toMatchObject({
      orders: 10,
      ordersA: 20,
      ordersB: 20,
      confidenceAB: 50,
      confidenceBA: 50,
      lift: 1.25,
    });
    expect(r.advice.map((v) => v.code)).toEqual(
      expect.arrayContaining(['PEAK', 'BESTSELLER', 'PAIR']),
    );
    const before = (await companions(publicQuery(), now)).items;
    expect(before.map((i) => i.productId)).toEqual([b]);
    await OrderModel.create(
      row([a, a, b], 50, {
        items: [
          row([a], 0).items[0],
          { ...row([a], 0).items[0], quantity: 5, lineTotal: 150000 },
          row([b], 0).items[0],
        ],
      }),
    );
    const next = await smartInsights(range, now);
    expect(next.pairs[0]?.orders).toBe(11);
    expect(next.pairs[0]?.ordersA).toBe(21);
    expect(next.topProducts.find((p) => p.productId === a)?.quantity).toBe(26);
    expect(await companions({ ...publicQuery(), productIds: `${a},${b},${a}` }, now)).toEqual({
      items: [],
    });
  });
  it('does not qualify merely popular independent pairs or small samples', async () => {
    await OrderModel.insertMany(Array.from({ length: 20 }, (_, i) => row([a, b], i)));
    expect((await smartInsights(range, now)).pairs).toEqual([]);
    expect(await companions(publicQuery(), now)).toEqual({ items: [] });
  });
  it('excludes Freestyle from association baskets while counting its sales', async () => {
    const virtual = new mongoose.Types.ObjectId();
    const r = row([a], 0);
    r.items[0] = { ...r.items[0]!, productId: virtual.toString(), nameSnapshot: 'Freestyle' };
    await OrderModel.collection.insertOne({
      ...r,
      items: [{ ...r.items[0], freestyle: { name: 'Freestyle' } }],
    });
    const result = await smartInsights(range, now);
    expect(result.sample.patternOrders).toBe(0);
    expect(result.topProducts[0]).toMatchObject({
      freestyle: true,
      name: 'Freestyle',
      quantity: 1,
    });
  });
  it('separates dining/takeaway/pickup patterns and exact channel filtering', async () => {
    await patterns();
    const rows = await OrderModel.find().lean();
    await OrderModel.updateMany(
      {},
      {
        fulfillmentType: 'TAKEAWAY',
        tableId: null,
        tableSessionId: null,
        pickup: { name: 'Member', phone: '0901234567', outcome: 'COLLECTED' },
      },
    );
    expect(rows).toHaveLength(50);
    expect((await smartInsights({ ...range, channel: 'DINE_IN' }, now)).sample.orders).toBe(0);
    expect((await smartInsights({ ...range, channel: 'TAKEAWAY' }, now)).sample.orders).toBe(50);
    expect(
      (await companions({ ...publicQuery(), context: 'PICKUP' }, now)).items[0]?.productId,
    ).toBe(b);
    expect(await companions(publicQuery(), now)).toEqual({ items: [] });
  });
  it('checks current stock, category, archive, variants and prices before recommending', async () => {
    await patterns();
    await ProductModel.updateOne(
      { _id: b },
      {
        basePrice: 1,
        variants: [
          { name: 'M', price: 39000, isAvailable: true },
          { name: 'L', price: 45000, isAvailable: false },
        ],
        'allowedOptions.sizes': ['M', 'L'],
      },
    );
    expect((await companions(publicQuery(), now)).items[0]?.unitPrice).toBe(39000);
    await RecipeModel.create({
      targetType: 'PRODUCT',
      targetId: b,
      enabled: true,
      components: [{ ingredientId: ingredient, quantity: 2000000 }],
    });
    expect(await companions(publicQuery(), now)).toEqual({ items: [] });
    await RecipeModel.deleteOne({ targetId: b });
    await ProductModel.updateOne({ _id: b }, { isArchived: true });
    expect(await companions(publicQuery(), now)).toEqual({ items: [] });
    await ProductModel.updateOne({ _id: b }, { isArchived: false });
    await CategoryModel.updateOne({ _id: categoryId }, { isActive: false });
    expect(await companions(publicQuery(), now)).toEqual({ items: [] });
  });
  it('public DTO contains only catalog fields, has no cost/counts/customer history, validates IDs and context', async () => {
    await patterns();
    const r = await request(app).get('/api/v1/recommendations/companions').query(publicQuery());
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(Object.keys(r.body.data.items[0]).sort()).toEqual([
      'image',
      'name',
      'productId',
      'unitPrice',
    ]);
    for (const q of [
      { context: 'TABLE', productIds: 'bad' },
      { ...publicQuery(), extra: 'private' },
      { ...publicQuery(), context: 'ADMIN' },
      { ...publicQuery(), productIds: Array(11).fill(a).join(',') },
    ])
      expect((await request(app).get('/api/v1/recommendations/companions').query(q)).status).toBe(
        422,
      );
    expect(
      (
        await companions(
          { ...publicQuery(), productIds: new mongoose.Types.ObjectId().toString() },
          now,
        )
      ).items,
    ).toEqual([]);
  });
  it('computes current ingredient cost by base unit/variant and supports explicit zero, missing and negative margin', async () => {
    await IngredientModel.updateOne({ _id: ingredient }, { unitCost: 100 });
    let result = await smartInsights(range, now);
    expect(result.margins.items.find((i) => i.productId === a)).toMatchObject({
      ingredientCost: 1000,
      grossMargin: 29000,
      marginPct: 96.7,
    });
    await ProductModel.updateOne(
      { _id: a },
      { variants: [{ name: 'M', price: 5000 }], 'allowedOptions.sizes': ['M'] },
    );
    const p = await ProductModel.findById(a).orFail();
    await RecipeModel.updateOne(
      { targetId: a },
      {
        variants: [
          {
            variantId: p.variants[0]!._id,
            components: [{ ingredientId: ingredient, quantity: 100000 }],
          },
        ],
      },
    );
    result = await smartInsights(range, now);
    expect(result.margins.items.find((i) => i.productId === a)).toMatchObject({
      ingredientCost: 10000,
      grossMargin: -5000,
      marginPct: -100,
    });
    await IngredientModel.updateOne({ _id: ingredient }, { unitCost: 0 });
    expect(
      (await smartInsights(range, now)).margins.items.find((i) => i.productId === a)
        ?.ingredientCost,
    ).toBe(0);
    await IngredientModel.updateOne({ _id: ingredient }, { unitCost: null });
    expect(
      (await smartInsights(range, now)).margins.items.find((i) => i.productId === a)?.grossMargin,
    ).toBeNull();
  });
  it('ADMIN cost edits are validated/versioned and never rewrite historical orders, payments or stock', async () => {
    await patterns();
    const before = hash(await OrderModel.find().sort({ _id: 1 }).lean()),
      stock = (await IngredientModel.findById(ingredient))!.onHand;
    const body = {
      name: 'Trà nguyên liệu',
      lowStockThreshold: 0,
      isActive: true,
      expectedVersion: 0,
      unitCost: 123.456,
    };
    expect(
      (
        await request(app)
          .patch(`/api/v1/admin/inventory/ingredients/${ingredient}`)
          .auth(staffToken, { type: 'bearer' })
          .send(body)
      ).status,
    ).toBe(403);
    const result = await updateIngredient(ingredient, ingredientUpdateSchema.parse(body), admin);
    expect(result.unitCost).toBe(123.456);
    await expect(
      updateIngredient(ingredient, ingredientUpdateSchema.parse(body), admin),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    for (const value of [-1, 0.0001, 10000001, Infinity])
      expect(ingredientUpdateSchema.safeParse({ ...body, unitCost: value }).success).toBe(false);
    await updateIngredient(
      ingredient,
      ingredientUpdateSchema.parse({ ...body, expectedVersion: 1, unitCost: null }),
      admin,
    );
    expect((await IngredientModel.findById(ingredient))?.unitCost).toBeNull();
    expect((await IngredientModel.findById(ingredient))?.onHand).toBe(stock);
    expect(hash(await OrderModel.find().sort({ _id: 1 }).lean())).toBe(before);
    expect(await PaymentModel.countDocuments()).toBe(0);
    expect(await BillModel.countDocuments()).toBe(0);
  });
  it('compares only complete uncapped periods with at least 20 orders each', async () => {
    await patterns();
    const prev = Array.from({ length: 25 }, (_, i) =>
      row([a], i, { createdAt: new Date('2026-09-25T10:00:00+07:00') }),
    );
    await OrderModel.insertMany(prev);
    expect((await smartInsights(range, now)).comparison).toMatchObject({
      from: '2026-09-09',
      to: '2026-09-30',
      orders: 25,
      orderChangePct: 100,
    });
    expect(
      (await smartInsights({ ...range, to: '2026-10-23' }, now)).comparison.orderChangePct,
    ).toBeNull();
  });
  it('caps large samples explicitly, disables comparisons and companion conclusions', async () => {
    await OrderModel.collection.insertMany(
      Array.from({ length: 2001 }, (_, i) => ({
        ...row([a], i),
        _id: new mongoose.Types.ObjectId(),
      })),
    );
    const r = await smartInsights(range, now);
    expect(r.sample).toMatchObject({ orders: 2000, capped: true, limit: 2000 });
    expect(r.pairs).toEqual([]);
    expect(r.comparison.orderChangePct).toBeNull();
    expect(r.advice.map((x) => x.code)).toContain('CAPPED');
    expect(await companions(publicQuery(), now)).toEqual({ items: [] });
  });
});
