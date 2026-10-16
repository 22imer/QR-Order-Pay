import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { buildApp } from '../../app.js';
import { UserModel } from '../../models/User.js';
import { CategoryModel } from '../../models/Category.js';
import { ProductModel } from '../../models/Product.js';
import { ToppingModel } from '../../models/Topping.js';
import { OrderModel } from '../../models/Order.js';
import { PaymentModel } from '../../models/Payment.js';
import { AuditLogModel } from '../../models/AuditLog.js';
import { OutboxEventModel } from '../../models/OutboxEvent.js';
import { hashPassword } from '../../utils/crypto.js';
import { AIService, validateRecommendedConfiguration } from '../../services/aiService.js';
import { priceOrderItems } from '../../services/orderPricingService.js';

let repl: MongoMemoryReplSet;
let app: ReturnType<typeof buildApp>;
let admin: Record<string, string>;
let staff: Record<string, string>;
let adminId: string;
let source: string;
let target: string;
let product: string;
const freshId = () => new mongoose.Types.ObjectId();
const payload = (categoryId: string, slug = 'tra-chanh') => ({
  categoryId,
  name: 'Trà chanh',
  slug,
  image: '/menu-images/test.webp',
  basePrice: 35000,
  isFeatured: true,
  ingredientMetadata: { caffeine: false, dairy: false, flavorProfile: ['chua'] },
  allowedOptions: { sizes: [], sugarLevels: ['50%'], iceLevels: ['normal-ice'], toppingIds: [] },
});
const line = () => ({
  productId: product,
  variantId: null,
  sugarLevel: '50%',
  iceLevel: 'normal-ice',
  toppingIds: [],
  quantity: 1,
});
const remove = (id = source, reassignTo?: string) =>
  request(app)
    .delete(`/api/v1/admin/categories/${id}`)
    .set(admin)
    .send(reassignTo ? { reassignTo } : {});

beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(repl.getUri());
  app = buildApp();
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  for (const role of ['ADMIN', 'STAFF'] as const) {
    const user = await UserModel.create({
      name: role,
      email: `${role}@test.vn`,
      role,
      isActive: true,
      passwordHash: await hashPassword('Password@123'),
    });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'Password@123' });
    expect(login.status).toBe(200);
    const headers = { Authorization: `Bearer ${login.body.data.accessToken}` };
    if (role === 'ADMIN') {
      admin = headers;
      adminId = user.id;
    } else staff = headers;
  }
}, 120000);
beforeEach(async () => {
  await Promise.all(
    [
      CategoryModel,
      ProductModel,
      ToppingModel,
      OrderModel,
      PaymentModel,
      AuditLogModel,
      OutboxEventModel,
    ].map((model) => model.collection.deleteMany({})),
  );
  source = (await CategoryModel.create({ name: 'Trà', slug: 'tra' })).id;
  target = (await CategoryModel.create({ name: 'Trái cây', slug: 'trai-cay' })).id;
  product = (await ProductModel.create(payload(source))).id;
});
afterAll(async () => {
  await mongoose.disconnect();
  await repl.stop();
});

describe('catalog lifecycle and visibility', () => {
  it('archives and restores toppings, rejects stale options and preserves order snapshots', async () => {
    const topping = await ToppingModel.create({ name: 'Trân châu', price: 8000 });
    await ProductModel.findByIdAndUpdate(product, {
      $set: { 'allowedOptions.toppingIds': [topping._id] },
    });
    const configured = { ...line(), toppingIds: [topping.id] };
    const priced = await priceOrderItems([configured]);
    expect(priced.total).toBe(43000);
    const order = await OrderModel.create({
      code: 'TOPTEST',
      tableSessionId: freshId(),
      tableId: freshId(),
      participantId: 'guest',
      status: 'SERVED',
      paymentStatus: 'PAID',
      paidAmount: priced.total,
      total: priced.total,
      idempotencyKey: 'top-order',
      requestHash: 'top-hash',
      items: priced.items,
    });
    const before = order.toObject();
    const endpoint = `/api/v1/admin/toppings/${topping.id}`;
    expect((await request(app).delete(endpoint).set(staff)).status).toBe(403);
    expect((await request(app).delete('/api/v1/admin/toppings/invalid').set(admin)).status).toBe(
      422,
    );
    expect((await request(app).delete(endpoint).set(admin)).status).toBe(200);
    expect((await ToppingModel.findById(topping.id))?.isArchived).toBe(true);
    expect((await request(app).get('/api/v1/categories')).body.data.toppings).toHaveLength(0);
    await expect(priceOrderItems([configured])).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(
      (
        await validateRecommendedConfiguration({
          productId: product,
          variantId: null,
          toppingIds: [topping.id],
          constraints: {},
        })
      ).valid,
    ).toBe(false);
    expect((await OrderModel.findById(order.id))?.toObject()).toEqual(before);
    expect(
      await AuditLogModel.exists({ action: 'topping.archived', entityId: topping.id }),
    ).toBeTruthy();
    expect(await OutboxEventModel.exists({ aggregateId: topping.id })).toBeTruthy();
    expect((await request(app).patch(endpoint).set(admin).send({ isArchived: false })).status).toBe(
      200,
    );
    expect((await request(app).get('/api/v1/categories')).body.data.toppings).toHaveLength(1);
    expect((await priceOrderItems([configured])).total).toBe(43000);
  });

  it('soft deletes/restores products while preserving paid order/payment history', async () => {
    const order = await OrderModel.create({
      code: 'MCTEST',
      tableSessionId: freshId(),
      tableId: freshId(),
      participantId: 'guest',
      status: 'SERVED',
      paymentStatus: 'PAID',
      paidAmount: 35000,
      total: 35000,
      idempotencyKey: 'order-test',
      requestHash: 'hash',
      items: [{ ...line(), unitPrice: 35000, lineTotal: 35000, nameSnapshot: 'Trà chanh' }],
    });
    const payment = await PaymentModel.create({
      tableSessionId: order.tableSessionId,
      orderIds: [order._id],
      amount: 35000,
      confirmedBy: adminId,
      idempotencyKey: 'payment-test',
    });
    const beforeOrder = order.toObject();
    const beforePayment = payment.toObject();
    expect((await request(app).delete(`/api/v1/admin/products/${product}`).set(admin)).status).toBe(
      200,
    );
    expect((await ProductModel.findById(product))?.isArchived).toBe(true);
    expect((await request(app).get('/api/v1/categories')).body.data.products).toHaveLength(0);
    await expect(priceOrderItems([line()])).rejects.toMatchObject({ code: 'PRODUCT_UNAVAILABLE' });
    expect((await OrderModel.findById(order.id))?.toObject()).toEqual(beforeOrder);
    expect((await PaymentModel.findById(payment.id))?.toObject()).toEqual(beforePayment);
    expect(
      (
        await request(app)
          .patch(`/api/v1/admin/products/${product}`)
          .set(admin)
          .send({ isArchived: false })
      ).status,
    ).toBe(200);
    expect((await request(app).get('/api/v1/categories')).body.data.products).toHaveLength(1);
  });

  it('hides category products from catalog, featured, search, AI and old carts, then restores them', async () => {
    expect(
      (
        await request(app)
          .patch(`/api/v1/admin/categories/${source}`)
          .set(admin)
          .send({ isActive: false })
      ).status,
    ).toBe(200);
    const menu = (await request(app).get('/api/v1/categories')).body.data;
    expect(menu.categories.map((item: { _id: string }) => item._id)).not.toContain(source);
    expect(menu.products).toHaveLength(0);
    expect((await request(app).get('/api/v1/products/featured')).body.data.items).toHaveLength(0);
    expect(
      (await request(app).post('/api/v1/menu/search').send({ query: 'trà chanh' })).body.data.items,
    ).toHaveLength(0);
    expect(
      (await new AIService(null, 'fallback').recommend({ prompt: 'trà chanh' })).recommendations,
    ).toHaveLength(0);
    expect(
      (
        await validateRecommendedConfiguration({
          productId: product,
          variantId: null,
          toppingIds: [],
          constraints: {},
        })
      ).valid,
    ).toBe(false);
    await expect(priceOrderItems([line()])).rejects.toMatchObject({ code: 'PRODUCT_UNAVAILABLE' });
    await request(app)
      .patch(`/api/v1/admin/categories/${source}`)
      .set(admin)
      .send({ isActive: true });
    expect((await request(app).get('/api/v1/categories')).body.data.products).toHaveLength(1);
    expect((await priceOrderItems([line()])).total).toBe(35000);
  });

  it('rejects deletion without reassignment, including archived products', async () => {
    await ProductModel.findByIdAndUpdate(product, { isArchived: true });
    const response = await remove();
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CATEGORY_NOT_EMPTY');
    expect(await CategoryModel.findById(source)).not.toBeNull();
    const categories = (await request(app).get('/api/v1/admin/categories').set(admin)).body.data
      .categories;
    expect(categories.find((item: { _id: string }) => item._id === source).productCount).toBe(1);
  });

  it('atomically reassigns active and archived products and records audit/realtime events', async () => {
    const archived = await ProductModel.create({ ...payload(source, 'tra-cu'), isArchived: true });
    const before = (await ProductModel.findById(product))!;
    const response = await remove(source, target);
    expect(response.status).toBe(200);
    expect(response.body.data.category.movedProductCount).toBe(2);
    expect(await CategoryModel.findById(source)).toBeNull();
    const moved = (await ProductModel.findById(product))!;
    expect(String(moved.categoryId)).toBe(target);
    expect(moved.toObject().ingredientMetadata).toEqual(before.toObject().ingredientMetadata);
    expect(moved.basePrice).toBe(before.basePrice);
    expect((await ProductModel.findById(archived.id))?.isArchived).toBe(true);
    expect(await ProductModel.countDocuments({ categoryId: target })).toBe(2);
    expect(
      await AuditLogModel.exists({
        action: 'category.productsMoved',
        'metadata.targetCategoryId': target,
      }),
    ).not.toBeNull();
    expect(await OutboxEventModel.exists({ 'payload.action': 'category.deleted' })).not.toBeNull();
  });

  it('rolls back invalid and self reassignment without changing products', async () => {
    expect((await remove(source, source)).status).toBe(422);
    expect((await remove(source, String(freshId()))).status).toBe(404);
    expect((await remove(source, 'invalid')).status).toBe(422);
    expect(String((await ProductModel.findById(product))?.categoryId)).toBe(source);
    expect((await CategoryModel.findById(source))?.version).toBe(0);
  });

  it('requires ADMIN for deletion and deletes an empty category', async () => {
    expect((await request(app).delete(`/api/v1/admin/categories/${target}`)).status).toBe(401);
    expect(
      (await request(app).delete(`/api/v1/admin/categories/${target}`).set(staff)).status,
    ).toBe(403);
    expect((await request(app).delete(`/api/v1/admin/products/${product}`).set(staff)).status).toBe(
      403,
    );
    expect((await remove(target)).status).toBe(200);
    expect((await remove(target)).status).toBe(404);
    expect((await remove('invalid')).status).toBe(422);
  });

  it('serializes category deletion and simultaneous product creation without orphans', async () => {
    const [deletion, creation] = await Promise.all([
      remove(source, target),
      request(app).post('/api/v1/admin/products').set(admin).send(payload(source, 'tra-moi')),
    ]);
    expect(deletion.status).toBe(200);
    expect([201, 404]).toContain(creation.status);
    const products = await ProductModel.find();
    for (const item of products) expect(String(item.categoryId)).toBe(target);
    expect(await CategoryModel.findById(source)).toBeNull();
  });

  it('rejects assigning products to a deleted category', async () => {
    await remove(source, target);
    const update = await request(app)
      .patch(`/api/v1/admin/products/${product}`)
      .set(admin)
      .send({ categoryId: source });
    expect(update.status).toBe(404);
    expect(String((await ProductModel.findById(product))?.categoryId)).toBe(target);
  });
});
