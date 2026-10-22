import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import { randomUUID, createHash } from 'node:crypto';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { buildApp } from '../../app.js';
import { config } from '../../config/index.js';
import { GiftModel } from '../../models/Gift.js';
import { TableModel } from '../../models/Table.js';
import { TableSessionModel } from '../../models/TableSession.js';
import { GuestSessionModel } from '../../models/GuestSession.js';
import { CategoryModel } from '../../models/Category.js';
import { ProductModel } from '../../models/Product.js';
import { OrderModel } from '../../models/Order.js';
import { IngredientModel } from '../../models/Ingredient.js';
import { RecipeModel } from '../../models/Recipe.js';
import { BillModel } from '../../models/Bill.js';
import { PaymentModel } from '../../models/Payment.js';
import { UserModel } from '../../models/User.js';
import { OutboxEventModel } from '../../models/OutboxEvent.js';
import { MemberModel, PointEntryModel } from '../../models/Member.js';
import { registerMember } from '../../services/memberService.js';
import { saveVoucher } from '../../services/promotionService.js';
import { AuditLogModel } from '../../models/AuditLog.js';
import {
  createGift,
  decideGift,
  expireGifts,
  giftTables,
  listGifts,
  type GiftActor,
} from '../../services/giftService.js';
import {
  placeOrder,
  cancelOrderByGuest,
  transitionByStaff,
  type PlaceOrderInput,
} from '../../services/orderService.js';
import { createOrderQuote } from '../../services/orderPricingService.js';
import { transition, transferSession } from '../../services/tableSessionService.js';
import { confirmOrderPayment, buildBill } from '../../services/paymentService.js';
import { claimPayment } from '../../services/paymentClaimService.js';
import { refundAndCancelOrder } from '../../services/orderRefundService.js';
import { sweepIdleSessions } from '../../services/idleSessionSweeper.js';
import { submitReview } from '../../services/reviewService.js';
import { buildParticipantReceipt } from '../../services/receiptService.js';
import { outboxRepository } from '../../repositories/outboxRepository.js';
import { sha256 } from '../../utils/crypto.js';
import { giftCreateSchema, type GiftCreate } from '@may-cafe/contracts';

let repl: MongoMemoryReplSet, app: ReturnType<typeof buildApp>;
let a: GiftActor,
  b: GiftActor,
  c: GiftActor,
  recipientTableId: string,
  emptyTableId: string,
  staffId: string,
  ingredientId: string,
  cookie: string,
  items: GiftCreate['items'];
const input = (extra: Partial<GiftCreate> = {}): GiftCreate => ({
  requestId: randomUUID(),
  recipientTableId,
  recipientSessionId: b.tableSessionId,
  message: 'Chúc vui!',
  showSenderTable: false,
  items,
  ...extra,
});
const send = () => createGift(a, input());
const accept = async () => {
  const g = await send();
  return decideGift(b, g.id, { expectedVersion: 0, decision: 'ACCEPT' });
};
const current = (id: string) => TableSessionModel.findById(id).orFail();
async function orderInput(giftId: string, key = randomUUID()): Promise<PlaceOrderInput> {
  const quote = await createOrderQuote({ ...a, items });
  return { ...a, giftId, items, idempotencyKey: key, quoteToken: quote.quoteToken };
}
async function order() {
  return placeOrder(await orderInput((await accept()).id));
}
async function pay(id: string, amount?: number) {
  const o = await OrderModel.findById(id).orFail();
  const token = randomUUID();
  await claimPayment(a.tableSessionId, staffId, token);
  return confirmOrderPayment({
    orderId: id,
    expectedVersion: o.version,
    staffId,
    amount: amount ?? o.total,
    method: 'CASH',
    idempotencyKey: randomUUID(),
    claimToken: token,
  });
}
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(repl.getUri());
  app = buildApp();
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
}, 120000);
beforeEach(async () => {
  vi.restoreAllMocks();
  for (const col of Object.values(mongoose.connection.collections)) await col.deleteMany({});
  const actors: GiftActor[] = [];
  for (const name of ['A', 'B', 'C']) {
    const table = await TableModel.create({
      code: name,
      name: `Bàn ${name}`,
      capacity: 4,
      publicTokenHash: name,
    });
    const session = await TableSessionModel.create({ tableId: table._id, source: 'GUEST' });
    actors.push({ tableSessionId: session.id, participantId: `private-participant-${name}` });
    await GuestSessionModel.create({
      tableSessionId: session._id,
      participantId: `private-participant-${name}`,
      tokenHash: sha256(`cookie-${name}`),
      expiresAt: new Date(Date.now() + 3600000),
    });
    if (name === 'B') recipientTableId = table.id;
  }
  [a, b, c] = actors as [GiftActor, GiftActor, GiftActor];
  cookie = 'mc_guest=cookie-A';
  emptyTableId = (
    await TableModel.create({ code: 'E', name: 'Bàn trống', capacity: 4, publicTokenHash: 'E' })
  ).id;
  staffId = (
    await UserModel.create({
      name: 'Staff',
      email: 'staff@gift.test',
      role: 'ADMIN',
      passwordHash: 'unused',
    })
  ).id;
  const cat = await CategoryModel.create({ name: 'Trà', slug: 'tea' });
  const product = await ProductModel.create({
    categoryId: cat._id,
    name: 'Trà đào',
    slug: 'tra-dao',
    image: '/favicon.svg',
    basePrice: 30000,
    allowedOptions: { sizes: [], sugarLevels: ['50%'], iceLevels: ['normal-ice'], toppingIds: [] },
  });
  const ingredient = await IngredientModel.create({
    code: 'TEA',
    name: 'Trà',
    unit: 'g',
    onHand: 100000,
    reserved: 0,
    isActive: true,
  });
  ingredientId = ingredient.id;
  await RecipeModel.create({
    targetType: 'PRODUCT',
    targetId: product._id,
    enabled: true,
    components: [{ ingredientId: ingredient._id, quantity: 10000 }],
  });
  items = [
    {
      productId: product.id,
      variantId: null,
      sugarLevel: '50%',
      iceLevel: 'normal-ice',
      toppingIds: [],
      quantity: 1,
      note: '',
    },
  ];
});
afterAll(async () => {
  await mongoose.disconnect();
  await repl.stop();
});

describe('anonymous gifts between serving sessions', () => {
  it('discloses only the real sender table snapshot when explicitly selected', async () => {
    const data = input({ showSenderTable: true });
    const g = await createGift(a, data);
    expect(g.senderTable).toEqual({ name: 'Bàn A', code: 'A' });
    await TableModel.updateOne(
      { _id: (await current(a.tableSessionId)).tableId },
      { name: 'Tên mới' },
    );
    const received = (await listGifts(b, {})).items[0]!;
    expect(received.showSenderTable).toBe(true);
    expect(received.senderTable).toEqual({ name: 'Bàn A', code: 'A' });
    for (const secret of [
      a.tableSessionId,
      a.participantId,
      'senderSessionId',
      'senderParticipantId',
      'requestHash',
    ])
      expect(JSON.stringify(received)).not.toContain(secret);
    expect(
      (await decideGift(b, g.id, { decision: 'ACCEPT', expectedVersion: 0 })).senderTable,
    ).toEqual(received.senderTable);
    expect((await createGift(a, data)).senderTable).toEqual(received.senderTable);
    expect((await listGifts(c, {})).items).toHaveLength(0);
    expect(
      (await OutboxEventModel.find({ eventType: 'gift.changed' })).every(
        (e) => JSON.stringify(e.payload) === '{"refresh":true}',
      ),
    ).toBe(true);
  });
  it('keeps legacy anonymous invitations and pending request hashes private and replayable without backfill', async () => {
    const { showSenderTable: _choice, ...legacy } = giftCreateSchema.parse(input());
    void _choice;
    const g = await createGift(a, legacy);
    await GiftModel.updateOne(
      { _id: g.id },
      {
        $unset: { showSenderTable: 1, senderTableName: 1, senderTableCode: 1 },
        $set: { requestHash: createHash('sha256').update(JSON.stringify(legacy)).digest('hex') },
      },
    );
    const replay = await createGift(a, { ...legacy, showSenderTable: false });
    expect(replay.id).toBe(g.id);
    expect(replay.showSenderTable).toBe(false);
    expect(replay).not.toHaveProperty('senderTable');
    expect((await listGifts(b, {})).items[0]).not.toHaveProperty('senderTable');
    expect(
      await GiftModel.collection.findOne({ _id: new mongoose.Types.ObjectId(g.id) }),
    ).not.toHaveProperty('showSenderTable');
    expect(await GiftModel.countDocuments()).toBe(1);
  });
  it('binds visibility to the original request and refuses spoofed sender details or invalid flags', async () => {
    const data = input();
    await createGift(a, data);
    await expect(createGift(a, { ...data, showSenderTable: true })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
    await expect(createGift(a, { ...input(), showSenderTable: 'true' })).rejects.toThrow();
    await expect(
      createGift(a, {
        ...input({ showSenderTable: true }),
        senderTable: { name: 'Bàn giả', code: 'FAKE' },
      }),
    ).rejects.toThrow();
  });
  it('requires QR auth, validates input, blocks cross-origin and disables cache', async () => {
    expect((await request(app).get('/api/v1/gifts')).status).toBe(401);
    expect(
      (
        await request(app)
          .post('/api/v1/gifts')
          .set('Cookie', cookie)
          .set('Origin', 'https://evil.test')
          .send(input())
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/v1/gifts')
          .set('Cookie', cookie)
          .send(input({ message: 'x'.repeat(141) }))
      ).status,
    ).toBe(422);
    const result = await request(app).get('/api/v1/gifts/tables').set('Cookie', cookie);
    expect(result.status).toBe(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(
      result.body.data.items.find((t: { tableId: string }) => t.tableId === emptyTableId).available,
    ).toBe(false);
  });
  it('replays a raced send once, keeps stock/money unchanged and protects anonymous recipient DTO/events', async () => {
    const data = input();
    const [one, two] = await Promise.all([createGift(a, data), createGift(a, data)]);
    expect(one.id).toBe(two.id);
    expect(await GiftModel.countDocuments()).toBe(1);
    expect(await OrderModel.countDocuments()).toBe(0);
    expect(await PaymentModel.countDocuments()).toBe(0);
    expect((await IngredientModel.findById(ingredientId).orFail()).reserved).toBe(0);
    const received = await listGifts(b, {}),
      third = await listGifts(c, {});
    expect(received.incomingCount).toBe(1);
    expect(third.items).toHaveLength(0);
    expect(received.items[0]).not.toHaveProperty('orderId');
    const payload = JSON.stringify(received);
    for (const secret of [
      a.participantId,
      a.tableSessionId,
      'requestHash',
      'requestId',
      'sender',
      'unitPrice',
    ])
      expect(payload).not.toContain(secret);
    const events = await OutboxEventModel.find({ eventType: 'gift.changed' });
    expect(events).toHaveLength(2);
    expect(events.every((e) => JSON.stringify(e.payload) === '{"refresh":true}')).toBe(true);
    expect(events.some((e) => e.target.scope === 'staff')).toBe(false);
  });
  it('rejects changing request payload and refuses self/empty/stale recipient sessions', async () => {
    const data = input();
    await createGift(a, data);
    await expect(createGift(a, { ...data, message: 'Khác' })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
    await expect(createGift(a, input({ recipientSessionId: a.tableSessionId }))).rejects.toThrow();
    await expect(createGift(a, input({ recipientTableId: emptyTableId }))).rejects.toThrow();
    await GuestSessionModel.updateMany(
      { tableSessionId: b.tableSessionId },
      { revokedAt: new Date() },
    );
    await expect(createGift(a, input())).rejects.toThrow();
    expect((await giftTables(a)).items.find((t) => t.tableId === recipientTableId)?.available).toBe(
      false,
    );
  });
  it('allows only the recipient table to decide and only the sender participant to cancel', async () => {
    const g = await send();
    await expect(decideGift(a, g.id, { expectedVersion: 0, decision: 'ACCEPT' })).rejects.toThrow();
    await expect(
      decideGift(c, g.id, { expectedVersion: 0, decision: 'DECLINE' }),
    ).rejects.toThrow();
    await expect(
      decideGift({ ...a, participantId: 'another' }, g.id, {
        expectedVersion: 0,
        decision: 'CANCEL',
      }),
    ).rejects.toThrow();
    await decideGift(b, g.id, { expectedVersion: 0, decision: 'DECLINE' });
    await expect(placeOrder(await orderInput(g.id))).rejects.toThrow();
  });
  it('serializes two recipient decisions, and same actor can safely replay acceptance', async () => {
    const g = await send();
    const decisions = await Promise.allSettled([
      decideGift(b, g.id, { expectedVersion: 0, decision: 'ACCEPT' }),
      decideGift({ ...b, participantId: 'second-device' }, g.id, {
        expectedVersion: 0,
        decision: 'DECLINE',
      }),
    ]);
    expect(decisions.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const updated = await GiftModel.findById(g.id).orFail();
    if (updated.status === 'ACCEPTED')
      expect((await decideGift(b, g.id, { expectedVersion: 0, decision: 'ACCEPT' })).version).toBe(
        1,
      );
    expect(await OrderModel.countDocuments()).toBe(0);
  });
  it('expires invitations and accepted gifts without creating orders or releasing unrelated stock', async () => {
    const g = await accept();
    await GiftModel.updateOne({ _id: g.id }, { expiresAt: new Date(Date.now() - 1) });
    await Promise.all([expireGifts(), expireGifts()]);
    expect((await GiftModel.findById(g.id).orFail()).status).toBe('EXPIRED');
    await expect(placeOrder(await orderInput(g.id))).rejects.toThrow();
    expect(await OrderModel.countDocuments()).toBe(0);
    expect((await IngredientModel.findById(ingredientId).orFail()).reserved).toBe(0);
  });
  it('expires invitations if either session ends and never carries gifts into a new session', async () => {
    const g = await send();
    await transition(
      b.tableSessionId,
      (await current(b.tableSessionId)).version,
      'CLOSED',
      staffId,
    );
    await expireGifts();
    expect((await GiftModel.findById(g.id).orFail()).status).toBe('EXPIRED');
    const fresh = await TableSessionModel.create({ tableId: recipientTableId });
    expect((await listGifts({ ...b, tableSessionId: fresh.id }, {})).items).toHaveLength(0);
  });
  it('caps active sends under concurrency and protects recipient capacity across senders', async () => {
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => send()));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    const attempts = await Promise.allSettled(
      Array.from({ length: 4 }, () => createGift(c, input())),
    );
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(await GiftModel.countDocuments({ status: 'PENDING' })).toBe(5);
  });
  it('checks accepted items, ownership, fresh stock/price and rolls claim back on invalid quote', async () => {
    const g = await accept();
    const payload = await orderInput(g.id);
    await expect(placeOrder({ ...payload, participantId: c.participantId })).rejects.toThrow();
    await expect(
      placeOrder({ ...payload, items: [{ ...items[0]!, quantity: 2 }] }),
    ).rejects.toMatchObject({ code: 'GIFT_ITEMS_CHANGED' });
    await ProductModel.updateOne({ _id: items[0]!.productId }, { basePrice: 35000 });
    await expect(placeOrder(payload)).rejects.toMatchObject({ code: 'QUOTE_CHANGED' });
    expect((await GiftModel.findById(g.id).orFail()).status).toBe('ACCEPTED');
    const fresh = await orderInput(g.id);
    await IngredientModel.updateOne({ _id: ingredientId }, { onHand: 0 });
    await expect(placeOrder(fresh)).rejects.toThrow();
    expect(await OrderModel.countDocuments()).toBe(0);
  });
  it('creates exactly one payer order under retry/race, reserves once, and hides it from recipient order APIs', async () => {
    const g = await accept();
    const payload = await orderInput(g.id);
    const [one, two] = await Promise.all([placeOrder(payload), placeOrder(payload)]);
    expect(one.order.id).toBe(two.order.id);
    expect(await OrderModel.countDocuments()).toBe(1);
    expect(String(one.order.tableSessionId)).toBe(a.tableSessionId);
    expect(String(one.order.gift?.recipientSessionId)).toBe(b.tableSessionId);
    expect((await IngredientModel.findById(ingredientId).orFail()).reserved).toBe(10000);
    expect(
      (await request(app).get('/api/v1/orders/mine').set('Cookie', 'mc_guest=cookie-B')).body.data
        .orders,
    ).toHaveLength(0);
    expect(
      (await request(app).get(`/api/v1/orders/${one.order.id}`).set('Cookie', 'mc_guest=cookie-B'))
        .status,
    ).toBe(403);
    const received = (await listGifts(b, {})).items[0]!;
    expect(received.orderStatus).toBe('AWAITING_PAYMENT');
    expect(received).not.toHaveProperty('orderId');
    const recipientEvents = await OutboxEventModel.find({
      'target.tableSessionId': b.tableSessionId,
    });
    expect(
      recipientEvents.every(
        (e) => e.aggregateId !== one.order.id && !JSON.stringify(e.payload).includes(one.order.id),
      ),
    ).toBe(true);
    await expect(placeOrder(await orderInput(g.id))).rejects.toThrow();
  });
  it('rolls back invitation and order/stock/audit together on outbox failure', async () => {
    vi.spyOn(outboxRepository, 'createRealtimeEvents').mockRejectedValueOnce(
      new Error('outbox down'),
    );
    await expect(send()).rejects.toThrow('outbox down');
    expect(await GiftModel.countDocuments()).toBe(0);
    expect(await AuditLogModel.countDocuments({ entityType: 'Gift' })).toBe(0);
    vi.restoreAllMocks();
    const g = await accept();
    const writeEvents = outboxRepository.createRealtimeEvents.bind(outboxRepository);
    vi.spyOn(outboxRepository, 'createRealtimeEvents')
      .mockImplementationOnce(writeEvents)
      .mockRejectedValueOnce(new Error('outbox down'));
    await expect(placeOrder(await orderInput(g.id))).rejects.toThrow('outbox down');
    expect((await GiftModel.findById(g.id).orFail()).status).toBe('ACCEPTED');
    expect(await OrderModel.countDocuments()).toBe(0);
    expect((await IngredientModel.findById(ingredientId).orFail()).reserved).toBe(0);
  });
  it('blocks transfer while invitations exist and after ordering, and releases locks after cancellation', async () => {
    const g = await send();
    await expect(
      transferSession(
        a.tableSessionId,
        emptyTableId,
        (await current(a.tableSessionId)).version,
        staffId,
      ),
    ).rejects.toMatchObject({ code: 'GIFT_IN_PROGRESS' });
    await decideGift(a, g.id, { expectedVersion: 0, decision: 'CANCEL' });
    const o = (await order()).order;
    await expect(
      transferSession(
        b.tableSessionId,
        emptyTableId,
        (await current(b.tableSessionId)).version,
        staffId,
      ),
    ).rejects.toMatchObject({ code: 'GIFT_IN_PROGRESS' });
    await expect(
      transition(b.tableSessionId, (await current(b.tableSessionId)).version, 'CLOSED', staffId),
    ).rejects.toMatchObject({ code: 'GIFT_IN_PROGRESS' });
    await cancelOrderByGuest(o.id, a.participantId);
    expect((await IngredientModel.findById(ingredientId).orFail()).reserved).toBe(0);
    await transferSession(
      b.tableSessionId,
      emptyTableId,
      (await current(b.tableSessionId)).version,
      staffId,
    );
  });
  it('never lets idle sweep close a recipient with an outstanding gift order', async () => {
    await order();
    await TableSessionModel.updateOne(
      { _id: b.tableSessionId },
      { startedAt: new Date(Date.now() - 2 * 3600000) },
    );
    await sweepIdleSessions();
    expect((await current(b.tableSessionId)).status).toBe('OPEN');
  });
  it('serializes sender confirm against recipient closing so a committed order always has a live destination', async () => {
    const g = await accept(),
      payload = await orderInput(g.id),
      version = (await current(b.tableSessionId)).version;
    await Promise.allSettled([
      placeOrder(payload),
      transition(b.tableSessionId, version, 'CLOSED', staffId),
    ]);
    const o = await OrderModel.findOne();
    expect(o ? (await current(b.tableSessionId)).status : 'CLOSED').toBe(o ? 'OPEN' : 'CLOSED');
  });
  it('charges the sender, serves the recipient, snapshots only the sender bill, and preserves review ownership', async () => {
    const o = (await order()).order;
    await expect(transitionByStaff(o.id, 'CONFIRMED', { id: staffId })).rejects.toThrow();
    await pay(o.id, 10000);
    await expect(cancelOrderByGuest(o.id, a.participantId)).rejects.toThrow();
    await pay(o.id, 20000);
    for (const next of ['CONFIRMED', 'PREPARING', 'READY', 'SERVED'] as const)
      await transitionByStaff(o.id, next, { id: staffId });
    const ingredient = await IngredientModel.findById(ingredientId).orFail();
    expect(ingredient.onHand).toBe(90000);
    expect(ingredient.reserved).toBe(0);
    await expect(submitReview({ ...b, orderId: o.id, rating: 5 })).rejects.toThrow();
    await submitReview({ ...a, orderId: o.id, rating: 5 });
    await transition(
      b.tableSessionId,
      (await current(b.tableSessionId)).version,
      'CLOSED',
      staffId,
    );
    await transition(
      a.tableSessionId,
      (await current(a.tableSessionId)).version,
      'CLOSED',
      staffId,
    );
    const senderBill = await BillModel.findOne({ tableSessionId: a.tableSessionId }).orFail();
    const recipientBill = await BillModel.findOne({ tableSessionId: b.tableSessionId }).orFail();
    expect(senderBill.total).toBe(30000);
    expect(senderBill.orders[0]!.gift?.recipientTableName).toBe('Bàn B');
    expect(recipientBill.total).toBe(0);
    expect(recipientBill.orders).toHaveLength(0);
    await TableModel.updateOne({ _id: recipientTableId }, { name: 'Đổi tên' });
    const receipt = await buildParticipantReceipt(a.tableSessionId, a.participantId);
    expect(receipt.orders[0]!.gift?.recipientTableName).toBe('Bàn B');
    expect((await buildBill(a.tableSessionId)).orders[0]).toHaveProperty(
      'gift.recipientTableName',
      'Bàn B',
    );
  });
  it('refunds partially paid gifts before preparation and returns reservations once', async () => {
    const o = (await order()).order;
    await pay(o.id, 10000);
    const paid = await OrderModel.findById(o.id).orFail();
    await refundAndCancelOrder(o.id, staffId, paid.version, 10000, 'CASH', 'Khách đổi ý');
    expect((await OrderModel.findById(o.id).orFail()).status).toBe('CANCELLED');
    expect((await IngredientModel.findById(ingredientId).orFail()).reserved).toBe(0);
    expect((await listGifts(b, {})).items[0]!.orderStatus).toBe('CANCELLED');
  });
  it('keeps API pools isolated for gifts', async () => {
    const old = config.trafficClass;
    try {
      Object.assign(config, { trafficClass: 'internal' });
      expect((await request(app).get('/api/v1/gifts').set('Cookie', cookie)).status).toBe(404);
    } finally {
      Object.assign(config, { trafficClass: old });
    }
  });
  it('keeps voucher/points and earned rewards with the authenticated sender', async () => {
    const member = await registerMember({
      name: 'Người gửi',
      phone: '0901234567',
      password: 'Password@123',
    });
    await MemberModel.updateOne({ _id: member.member.id }, { points: 20 });
    await saveVoucher(
      null,
      {
        code: 'GIFT5',
        name: 'Ưu đãi quà',
        type: 'FIXED',
        value: 5000,
        minSubtotal: 0,
        maxDiscount: null,
        startsAt: new Date(Date.now() - 60000).toISOString(),
        endsAt: new Date(Date.now() + 86400000).toISOString(),
        maxUses: 10,
        perMemberLimit: null,
        memberRequired: true,
        isActive: true,
        allowPointRedemption: true,
      },
      staffId,
    );
    const g = await accept();
    const selection = { memberId: member.member.id, voucherCode: 'GIFT5', redeemPoints: 5 };
    const quoted = await createOrderQuote({ ...a, items, ...selection });
    const o = (
      await placeOrder({
        ...a,
        items,
        ...selection,
        giftId: g.id,
        quoteToken: quoted.quoteToken,
        idempotencyKey: randomUUID(),
      })
    ).order;
    expect(o.total).toBe(20000);
    expect((await MemberModel.findById(member.member.id).orFail()).points).toBe(15);
    await pay(o.id);
    for (const next of ['CONFIRMED', 'PREPARING', 'READY', 'SERVED'] as const)
      await transitionByStaff(o.id, next, { id: staffId });
    expect((await MemberModel.findById(member.member.id).orFail()).points).toBe(17);
    const ledger = await PointEntryModel.find({ orderId: o.id });
    expect(ledger).toHaveLength(2);
    expect(ledger.every((e) => String(e.memberId) === member.member.id)).toBe(true);
    expect((await listGifts(b, {})).items[0]).not.toHaveProperty('memberId');
  });
  it('paginates historical gifts and hides other senders on the same table', async () => {
    const g = await send();
    const stored = (await GiftModel.findById(g.id).orFail()).toObject();
    const { _id: _ignored, ...fields } = stored;
    void _ignored;
    await GiftModel.insertMany(
      Array.from({ length: 32 }, () => ({
        ...fields,
        requestId: randomUUID(),
        status: 'DECLINED',
      })),
    );
    const one = await listGifts(a, { page: 1 }),
      two = await listGifts(a, { page: 2 });
    expect(one.total).toBe(33);
    expect(one.items).toHaveLength(30);
    expect(two.items).toHaveLength(3);
    expect(new Set([...one.items, ...two.items].map((i) => i.id)).size).toBe(33);
    expect((await listGifts({ ...a, participantId: 'someone-else' }, {})).items).toHaveLength(0);
  });
});
