import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { createHmac, randomUUID } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  FREESTYLE_OPTIONS,
  type FreestyleSettings,
  type FreestyleRecommendation,
} from '@may-cafe/contracts';
import { buildApp } from '../../app.js';
import { config } from '../../config/index.js';
import { FreestyleSettingsModel, FreestyleSaveModel } from '../../models/Freestyle.js';
import { IngredientModel } from '../../models/Ingredient.js';
import { TableModel } from '../../models/Table.js';
import { TableSessionModel } from '../../models/TableSession.js';
import { GuestSessionModel } from '../../models/GuestSession.js';
import { UserModel } from '../../models/User.js';
import { MemberModel, MemberSessionModel } from '../../models/Member.js';
import { CategoryModel } from '../../models/Category.js';
import { ProductModel } from '../../models/Product.js';
import { RecipeModel } from '../../models/Recipe.js';
import { OrderModel } from '../../models/Order.js';
import { StockMovementModel } from '../../models/StockMovement.js';
import { AuditLogModel } from '../../models/AuditLog.js';
import { OutboxEventModel } from '../../models/OutboxEvent.js';
import { sha256, signAccessToken } from '../../utils/crypto.js';
import {
  FreestyleAdvisor,
  freestyleSettings,
  saveFreestyleSettings,
  validateFreestyle,
  assertFreestyleScope,
} from '../../services/freestyleService.js';
import { createOrderQuote, priceOrderItems } from '../../services/orderPricingService.js';
import {
  placeOrder,
  cancelOrderByGuest,
  transitionByStaff,
  type PlaceOrderItemInput,
} from '../../services/orderService.js';
import { createPickup, quotePickup } from '../../services/pickupService.js';
import { createGift, decideGift } from '../../services/giftService.js';
import { toGuestOrder } from '../../services/orderDto.js';
import { photoOwner } from '../../services/cupPhotoService.js';
import { auditRepository } from '../../repositories/auditRepository.js';

let repl: MongoMemoryReplSet, app: ReturnType<typeof buildApp>;
let admin: string,
  staff: string,
  adminToken: string,
  staffToken: string,
  sid: string,
  targetSid: string,
  targetTable: string;
let baseIngredient: string, flavorIngredient: string, memberId: string;
let settings: FreestyleSettings;
const advisor = new FreestyleAdvisor(null, 'fallback');
const askBody = { context: 'TABLE', prompt: 'trái cây' };
const owner = () => photoOwner(sid, 'guest-a');
const save = (value = settings, expectedVersion = 0, requestId: string = randomUUID()) =>
  saveFreestyleSettings(admin, { requestId, expectedVersion, settings: value });
async function suggest(o = owner()) {
  return (await advisor.recommend(o, askBody)).recommendations[0]!;
}
const item = (r: FreestyleRecommendation, extra = {}): PlaceOrderItemInput => ({
  productId: r.productId,
  freestyleToken: r.token,
  variantId: null,
  sugarLevel: FREESTYLE_OPTIONS,
  iceLevel: FREESTYLE_OPTIONS,
  toppingIds: [],
  quantity: 1,
  ...extra,
});
async function command(items: PlaceOrderItemInput[], idempotencyKey: string = randomUUID()) {
  const quote = await createOrderQuote({ tableSessionId: sid, participantId: 'guest-a', items });
  return {
    tableSessionId: sid,
    participantId: 'guest-a',
    items,
    idempotencyKey,
    quoteToken: quote.quoteToken,
  };
}
function signedChange(token: string, patch: object) {
  const payload = Buffer.from(
    JSON.stringify({
      ...JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString()),
      ...patch,
    }),
  ).toString('base64url');
  return `${payload}.${createHmac('sha256', `freestyle:${config.jwtAccessSecret}`).update(payload).digest('base64url')}`;
}
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(repl.getUri());
  app = buildApp();
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
}, 120000);
beforeEach(async () => {
  vi.restoreAllMocks();
  for (const c of Object.values(mongoose.connection.collections)) await c.deleteMany({});
  const a = await UserModel.create({
    name: 'Admin',
    email: 'admin@freestyle.test',
    role: 'ADMIN',
    passwordHash: 'unused',
  });
  const s = await UserModel.create({
    name: 'Staff',
    email: 'staff@freestyle.test',
    role: 'STAFF',
    passwordHash: 'unused',
  });
  admin = a.id;
  staff = s.id;
  adminToken = signAccessToken({ sub: admin, role: 'ADMIN', name: a.name });
  staffToken = signAccessToken({ sub: staff, role: 'STAFF', name: s.name });
  const table = await TableModel.create({
    code: 'F1',
    name: 'Bàn 1',
    capacity: 4,
    publicTokenHash: 'f1',
  });
  sid = (await TableSessionModel.create({ tableId: table._id })).id;
  const target = await TableModel.create({
    code: 'F2',
    name: 'Bàn 2',
    capacity: 4,
    publicTokenHash: 'f2',
  });
  targetTable = target.id;
  targetSid = (await TableSessionModel.create({ tableId: target._id })).id;
  for (const [tableSessionId, participantId, token] of [
    [sid, 'guest-a', 'freestyle-guest'],
    [targetSid, 'receiver', 'freestyle-receiver'],
  ])
    await GuestSessionModel.create({
      tableSessionId,
      participantId,
      tokenHash: sha256(token!),
      expiresAt: new Date(Date.now() + 3600000),
    });
  const m = await MemberModel.create({ name: 'Lan', phone: '0901234567', passwordHash: 'unused' });
  memberId = m.id;
  await MemberSessionModel.create({
    memberId,
    tokenHash: sha256('freestyle-member'),
    authVersion: 0,
    expiresAt: new Date(Date.now() + 3600000),
  });
  baseIngredient = (
    await IngredientModel.create({
      code: 'JUICE',
      name: 'Nước trái cây',
      unit: 'ml',
      onHand: 1000000,
    })
  ).id;
  flavorIngredient = (
    await IngredientModel.create({ code: 'SYRUP', name: 'Siro đào', unit: 'ml', onHand: 100000 })
  ).id;
  const flavorId = randomUUID();
  const common = {
    instructions: 'Lắc đều và phục vụ lạnh.',
    caffeine: false,
    dairy: false,
    tags: ['trái cây'],
    enabled: true,
  };
  settings = {
    enabled: true,
    price: 45000,
    sizeName: 'M',
    sizeMl: 350,
    bases: [
      {
        ...common,
        id: randomUUID(),
        name: 'Nước quả',
        components: [{ ingredientId: baseIngredient, unit: 'ml', quantity: 200 }],
        allowedFlavorIds: [flavorId],
        maxFlavors: 2,
      },
    ],
    flavors: [
      {
        ...common,
        id: flavorId,
        name: 'Đào',
        components: [{ ingredientId: flavorIngredient, unit: 'ml', quantity: 10 }],
        conflictsWith: [],
      },
    ],
  };
});
afterAll(async () => {
  await mongoose.disconnect();
  await repl.stop();
});

describe('Freestyle approved recipes, identity, pricing and inventory', () => {
  it('defaults disabled without writing configuration or menu records', async () => {
    expect(await freestyleSettings()).toMatchObject({
      version: 0,
      settings: { enabled: false, price: 0 },
    });
    expect((await advisor.recommend(owner(), askBody)).recommendations).toEqual([]);
    expect(await FreestyleSettingsModel.countDocuments()).toBe(0);
    expect(await ProductModel.countDocuments()).toBe(0);
    expect(await RecipeModel.countDocuments()).toBe(0);
  });
  it('protects auth, ADMIN role, guest CSRF and explicit TABLE/PICKUP identities', async () => {
    expect((await request(app).get('/api/v1/ai/freestyle')).status).toBe(401);
    expect((await request(app).get('/api/v1/admin/freestyle')).status).toBe(401);
    expect(
      (await request(app).get('/api/v1/admin/freestyle').auth(staffToken, { type: 'bearer' }))
        .status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/v1/ai/freestyle')
          .set('Cookie', 'mc_guest=freestyle-guest')
          .set('Origin', 'https://evil.test')
          .send(askBody)
      ).status,
    ).toBe(403);
    await save();
    const both = 'mc_guest=freestyle-guest; mc_member=freestyle-member';
    const table = await request(app).post('/api/v1/ai/freestyle').set('Cookie', both).send(askBody);
    expect(table.status).toBe(200);
    await expect(
      assertFreestyleScope([item(table.body.data.recommendations[0])], owner()),
    ).resolves.toBeUndefined();
    const pickup = await request(app)
      .post('/api/v1/ai/freestyle')
      .set('Cookie', both)
      .send({ ...askBody, context: 'PICKUP' });
    expect(pickup.status).toBe(200);
    await expect(
      assertFreestyleScope([item(pickup.body.data.recommendations[0])], `member:${memberId}`),
    ).resolves.toBeUndefined();
    expect(
      (
        await request(app)
          .post('/api/v1/ai/freestyle')
          .set('Cookie', 'mc_guest=freestyle-guest')
          .send({ ...askBody, context: 'PICKUP' })
      ).status,
    ).toBe(401);
    await TableSessionModel.updateOne({ _id: sid }, { status: 'CHECKOUT' });
    expect(
      (
        await request(app)
          .post('/api/v1/ai/freestyle')
          .set('Cookie', 'mc_guest=freestyle-guest')
          .send(askBody)
      ).status,
    ).toBe(403);
  });
  it('saves through ADMIN API, uses versions and replays one exact request', async () => {
    const body = { requestId: randomUUID(), expectedVersion: 0, settings };
    expect(
      (
        await request(app)
          .put('/api/v1/admin/freestyle')
          .auth(adminToken, { type: 'bearer' })
          .send(body)
      ).status,
    ).toBe(200);
    expect((await saveFreestyleSettings(admin, body)).version).toBe(1);
    await expect(
      saveFreestyleSettings(admin, { ...body, settings: { ...settings, price: 99000 } }),
    ).rejects.toMatchObject({ code: 'FREESTYLE_REPLAY' });
    await expect(save()).rejects.toMatchObject({ code: 'FREESTYLE_STALE' });
    expect(await FreestyleSaveModel.countDocuments()).toBe(1);
    expect(await AuditLogModel.countDocuments({ action: 'freestyle.settingsSaved' })).toBe(1);
    expect(await OutboxEventModel.countDocuments({ eventType: 'menu.availabilityChanged' })).toBe(
      1,
    );
  });
  it.each(['unknown', 'unit', 'quantity', 'volume', 'inactive', 'duplicate', 'price'] as const)(
    'rejects invalid approved configuration: %s',
    async (kind) => {
      if (kind === 'unknown')
        settings.bases[0]!.components[0]!.ingredientId = new mongoose.Types.ObjectId().toString();
      if (kind === 'unit') settings.bases[0]!.components[0]!.unit = 'g';
      if (kind === 'quantity') settings.bases[0]!.components[0]!.quantity = 0.0001;
      if (kind === 'volume') settings.bases[0]!.components[0]!.quantity = 350;
      if (kind === 'inactive')
        await IngredientModel.updateOne({ _id: baseIngredient }, { isActive: false });
      if (kind === 'duplicate')
        settings.bases[0]!.components.push({ ...settings.bases[0]!.components[0]! });
      if (kind === 'price') settings.price = 0;
      await expect(save()).rejects.toBeTruthy();
      expect(await FreestyleSettingsModel.countDocuments()).toBe(0);
      expect((await IngredientModel.findById(baseIngredient))?.version).toBe(0);
    },
  );
  it('rolls back configuration, ingredient locks and replay marker if auditing fails', async () => {
    vi.spyOn(auditRepository, 'log').mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(save()).rejects.toThrow('audit unavailable');
    expect(await FreestyleSettingsModel.countDocuments()).toBe(0);
    expect(await FreestyleSaveModel.countDocuments()).toBe(0);
    expect((await IngredientModel.findById(baseIngredient))?.version).toBe(0);
  });
  it('makes fixed-price recipes outside the menu, aggregates shared ingredients and respects pair conflicts', async () => {
    const second = {
      ...settings.flavors[0]!,
      id: randomUUID(),
      name: 'Vải',
      conflictsWith: [settings.flavors[0]!.id],
    };
    settings.flavors.push(second);
    settings.bases[0]!.allowedFlavorIds.push(second.id);
    settings.flavors[0]!.components.push({
      ingredientId: baseIngredient,
      unit: 'ml',
      quantity: 20,
    });
    await save();
    const result = await advisor.recommend(owner(), askBody);
    expect(result.recommendations).toHaveLength(2);
    expect(
      result.recommendations.every((r) => !r.name.includes('Đào + Vải') && r.unitPrice === 45000),
    ).toBe(true);
    const peach = result.recommendations.find((r) => r.name.endsWith('Đào'))!;
    expect(peach.components.find((c) => c.name === 'Nước trái cây')?.quantity).toBe(220);
    expect(await ProductModel.countDocuments()).toBe(0);
    expect(await RecipeModel.countDocuments()).toBe(0);
  });
  it('filters unknown caffeine/dairy, budget in prompt and unavailable stock; AI off is empty', async () => {
    settings.bases[0]!.caffeine = null;
    settings.flavors[0]!.dairy = true;
    await save();
    for (const prompt of ['không caffeine', 'không sữa', 'ngân sách 40k'])
      expect((await advisor.recommend(owner(), { ...askBody, prompt })).recommendations).toEqual(
        [],
      );
    expect((await new FreestyleAdvisor(null, 'off').recommend(owner(), askBody)).mode).toBe('off');
    expect(
      (await new FreestyleAdvisor(null, 'off').recommend(owner(), askBody)).recommendations,
    ).toEqual([]);
    await IngredientModel.updateOne({ _id: baseIngredient }, { reserved: 900000 });
    expect((await advisor.recommend(owner(), askBody)).recommendations).toEqual([]);
  });
  it.each(['invented', 'price', 'invalid-json', 'error'] as const)(
    'falls back to verified rules for provider %s',
    async (kind) => {
      await save();
      const expected = await suggest();
      const chat = vi.fn(async () => {
        if (kind === 'error') throw new Error('timeout');
        return kind === 'invalid-json'
          ? 'no'
          : JSON.stringify(
              kind === 'price'
                ? { choices: [expected.productId], price: 1 }
                : { choices: ['0'.repeat(24)] },
            );
      });
      const result = await new FreestyleAdvisor({ name: 'mock', chat }, 'live').recommend(
        owner(),
        askBody,
      );
      expect(chat).toHaveBeenCalledOnce();
      expect(result.mode).toBe('fallback');
      expect(result.recommendations[0]).toMatchObject({
        productId: expected.productId,
        unitPrice: 45000,
        components: expected.components,
      });
    },
  );
  it('lets a provider select verified IDs without forwarding customer identity or secrets', async () => {
    await save();
    const r = await suggest();
    const chat = vi.fn(async () => JSON.stringify({ choices: [r.productId] }));
    const result = await new FreestyleAdvisor({ name: 'mock', chat }, 'live').recommend(
      owner(),
      askBody,
    );
    expect(result.mode).toBe('llm');
    expect(result.recommendations[0]?.unitPrice).toBe(45000);
    const sent = JSON.stringify(chat.mock.calls);
    expect(sent).not.toContain(owner());
    expect(sent).not.toContain(config.jwtAccessSecret);
    expect(sent).not.toContain(baseIngredient);
  });
  it('validates signed scope and rejects forged, Unicode, expired, stale or altered options', async () => {
    await save();
    const r = await suggest();
    expect(
      await validateFreestyle(owner(), {
        context: 'TABLE',
        productId: r.productId,
        token: r.token,
      }),
    ).toMatchObject({ unitPrice: 45000, freestyle: { name: r.name } });
    await expect(assertFreestyleScope([item(r)], photoOwner(sid, 'guest-b'))).rejects.toMatchObject(
      { status: 403 },
    );
    for (const token of [`${r.token.slice(0, -1)}!`, `${r.token.split('.')[0]}.${'ế'.repeat(43)}`])
      await expect(
        assertFreestyleScope([{ freestyleToken: token }], owner()),
      ).rejects.toMatchObject({ status: 422 });
    await expect(
      assertFreestyleScope(
        [{ freestyleToken: signedChange(r.token, { exp: Date.now() - 1 }) }],
        owner(),
      ),
    ).rejects.toMatchObject({ code: 'FREESTYLE_EXPIRED' });
    for (const patch of [
      { productId: '0'.repeat(24) },
      { toppingIds: [baseIngredient] },
      { sugarLevel: '0%' },
      { variantId: baseIngredient },
    ])
      await expect(priceOrderItems([item(r, patch)])).rejects.toMatchObject({ status: 422 });
    await expect(
      priceOrderItems([{ ...item(r), freestyleToken: undefined }]),
    ).rejects.toMatchObject({ code: 'PRODUCT_UNAVAILABLE' });
    await save({ ...settings, price: 49000 }, 1);
    await expect(
      validateFreestyle(owner(), { context: 'TABLE', productId: r.productId, token: r.token }),
    ).rejects.toMatchObject({ code: 'FREESTYLE_STALE' });
  });
  it('rechecks ingredient units and stock after suggestions and before placement', async () => {
    await save();
    const r = await suggest();
    const input = await command([item(r)]);
    await IngredientModel.updateOne({ _id: baseIngredient }, { onHand: 1000 });
    await expect(placeOrder(input)).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    expect(await OrderModel.countDocuments()).toBe(0);
    await IngredientModel.updateOne({ _id: baseIngredient }, { onHand: 1000000, unit: 'g' });
    await expect(priceOrderItems([item(r)])).rejects.toMatchObject({
      code: 'FREESTYLE_UNAVAILABLE',
    });
  });
  it('reserves and releases stock, persists recipe snapshot and replays placement after token expiry', async () => {
    await save();
    const r = await suggest(),
      input = await command([item(r, { quantity: 2 })]);
    const placed = await placeOrder(input);
    expect(placed.order.total).toBe(90000);
    expect(placed.order.inventoryState).toBe('RESERVED');
    expect((await IngredientModel.findById(baseIngredient))?.reserved).toBe(400000);
    expect(placed.order.items[0]?.freestyle?.components[0]?.quantity).toBeGreaterThan(0);
    const dto = JSON.stringify(toGuestOrder(placed.order));
    expect(dto).toContain(r.name);
    expect(dto).not.toContain(r.token);
    expect(dto).not.toContain(baseIngredient);
    const date = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31 * 60000);
    expect((await placeOrder(input)).created).toBe(false);
    date.mockRestore();
    await save(
      { ...settings, price: 99000, bases: [{ ...settings.bases[0]!, name: 'Tên mới' }] },
      1,
    );
    expect((await OrderModel.findById(placed.order.id))?.items[0]?.freestyle?.name).toBe(r.name);
    await cancelOrderByGuest(placed.order.id, 'guest-a');
    expect((await IngredientModel.findById(baseIngredient))?.reserved).toBe(0);
    expect(await StockMovementModel.countDocuments({ type: 'RELEASE' })).toBe(2);
  });
  it('consumes exactly the saved quantities when paid order starts preparation', async () => {
    await save();
    const r = await suggest();
    const placed = await placeOrder(await command([item(r)]));
    await OrderModel.updateOne(
      { _id: placed.order.id },
      { paymentStatus: 'PAID', paidAmount: 45000, status: 'PENDING' },
    );
    await transitionByStaff(placed.order.id, 'CONFIRMED', { id: staff });
    await transitionByStaff(placed.order.id, 'PREPARING', { id: staff });
    expect((await IngredientModel.findById(baseIngredient))?.toObject()).toMatchObject({
      reserved: 0,
      onHand: 800000,
    });
    expect((await OrderModel.findById(placed.order.id))?.inventoryState).toBe('CONSUMED');
    expect(await StockMovementModel.countDocuments({ type: 'CONSUME' })).toBe(2);
  });
  it('aggregates normal and freestyle demand and prevents concurrent overselling', async () => {
    await save();
    const r = await suggest();
    const category = await CategoryModel.create({ name: 'Thực đơn', slug: 'menu' });
    const p = await ProductModel.create({
      categoryId: category._id,
      name: 'Nước quả menu',
      slug: 'juice',
      image: '/favicon.svg',
      basePrice: 30000,
      allowedOptions: { sizes: [], sugarLevels: ['0%'], iceLevels: ['normal-ice'], toppingIds: [] },
    });
    await RecipeModel.create({
      targetType: 'PRODUCT',
      targetId: p._id,
      enabled: true,
      components: [{ ingredientId: baseIngredient, quantity: 200000 }],
    });
    await IngredientModel.updateOne({ _id: baseIngredient }, { onHand: 300000 });
    await expect(
      priceOrderItems([
        item(r),
        {
          productId: p.id,
          variantId: null,
          sugarLevel: '0%',
          iceLevel: 'normal-ice',
          toppingIds: [],
          quantity: 1,
        },
      ]),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    const inputs = await Promise.all([command([item(r)]), command([item(r)])]);
    const results = await Promise.allSettled(inputs.map((c) => placeOrder(c)));
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await OrderModel.countDocuments()).toBe(1);
    expect((await IngredientModel.findById(baseIngredient))?.reserved).toBe(200000);
  });
  it('supports member pickup with fixed price and prevents table token reuse', async () => {
    await save();
    const actor = { id: memberId, staff: false },
      r = await suggest(`member:${memberId}`);
    const body = {
      requestId: randomUUID(),
      pickup: { fulfillmentType: 'TAKEAWAY', name: 'Lan', phone: '0901234567' },
      items: [item(r)],
    };
    const quote = await quotePickup(actor, body),
      placed = await createPickup(actor, { ...body, quoteToken: quote.quoteToken });
    expect(placed.order.total).toBe(45000);
    expect(placed.order.items[0]?.freestyle?.name).toBe(r.name);
    await expect(
      quotePickup(actor, { ...body, items: [item(await suggest())] }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('preserves accepted gift items and keeps the signed token private to sender', async () => {
    await save();
    const r = await suggest(),
      items = [item(r)];
    const gift = await createGift(
      { tableSessionId: sid, participantId: 'guest-a' },
      {
        requestId: randomUUID(),
        recipientTableId: targetTable,
        recipientSessionId: targetSid,
        items,
      },
    );
    expect(gift.items[0]?.freestyleToken).toBe(r.token);
    const received = await decideGift(
      { tableSessionId: targetSid, participantId: 'receiver' },
      gift.id,
      { expectedVersion: 0, decision: 'ACCEPT' },
    );
    expect(JSON.stringify(received)).not.toContain(r.token);
    const placed = await placeOrder({ ...(await command(items)), giftId: gift.id });
    expect(placed.order.items[0]?.freestyle?.name).toBe(r.name);
    expect(String(placed.order.gift?.recipientSessionId)).toBe(targetSid);
  });
});
