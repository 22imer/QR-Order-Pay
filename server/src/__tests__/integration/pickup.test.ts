import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { buildApp } from '../../app.js';
import { OrderModel } from '../../models/Order.js';
import { PaymentModel } from '../../models/Payment.js';
import { BillModel } from '../../models/Bill.js';
import { MemberModel, PointEntryModel } from '../../models/Member.js';
import { TableModel } from '../../models/Table.js';
import { TableSessionModel } from '../../models/TableSession.js';
import { ProductModel } from '../../models/Product.js';
import { CategoryModel } from '../../models/Category.js';
import { IngredientModel } from '../../models/Ingredient.js';
import { RecipeModel } from '../../models/Recipe.js';
import { UserModel } from '../../models/User.js';
import { OutboxEventModel } from '../../models/OutboxEvent.js';
import { AuditLogModel } from '../../models/AuditLog.js';
import { WorkActivityModel } from '../../models/WorkShift.js';
import {
  createPickup,
  quotePickup,
  closePickup,
  pickupDto,
  listPickups,
  getPickupBill,
  type PickupActor,
} from '../../services/pickupService.js';
import { registerMember } from '../../services/memberService.js';
import { confirmOrderPayment } from '../../services/paymentService.js';
import { transitionByStaff, listOrdersForStaff } from '../../services/orderService.js';
import { refundAndCancelOrder } from '../../services/orderRefundService.js';
import {
  requestPaymentCorrection,
  decidePaymentCorrection,
} from '../../services/paymentCorrectionService.js';
import { saveVoucher } from '../../services/promotionService.js';
import { VoucherModel, VoucherUseModel } from '../../models/Voucher.js';
import { auditRepository } from '../../repositories/auditRepository.js';
import { outboxRepository } from '../../repositories/outboxRepository.js';
import { hashPassword, signAccessToken } from '../../utils/crypto.js';
import { migratePickupIndexes } from '../../infrastructure/pickupIndexes.js';
import { operationsSummary } from '../../services/operationsService.js';
import { runAnomalyDetection } from '../../services/anomalyService.js';
import type { PickupCreate } from '@may-cafe/contracts';
import { AIService } from '../../services/aiService.js';

let repl: MongoMemoryReplSet,
  app: ReturnType<typeof buildApp>,
  actor: PickupActor,
  counter: PickupActor,
  other: PickupActor;
let cookie: string,
  staffAuth: Record<string, string>,
  adminId: string,
  productId: string,
  ingredientId: string;
const input = (extra: Partial<PickupCreate> = {}): PickupCreate => ({
  requestId: randomUUID(),
  pickup: {
    fulfillmentType: 'TAKEAWAY',
    name: 'Khách thử',
    phone: '0901234567',
    scheduledAt: null,
  },
  items: [
    {
      productId,
      variantId: null,
      sugarLevel: '0%',
      iceLevel: 'normal-ice',
      toppingIds: [],
      quantity: 1,
    },
  ],
  ...extra,
});
async function quoted(a = actor, extra: Partial<PickupCreate> = {}) {
  const body = input(extra),
    quote = await quotePickup(a, body);
  return { ...body, quoteToken: quote.quoteToken };
}
async function place(a = actor, extra: Partial<PickupCreate> = {}) {
  return (await createPickup(a, await quoted(a, extra))).order;
}
async function pay(id: string, amount?: number, key = randomUUID()) {
  const o = await OrderModel.findById(id).orFail();
  return confirmOrderPayment({
    orderId: id,
    staffId: counter.id,
    expectedVersion: o.version,
    amount: amount ?? o.total - (o.paidAmount ?? 0),
    method: 'CASH',
    idempotencyKey: key,
  });
}
async function serve(id: string) {
  for (const status of ['CONFIRMED', 'PREPARING', 'READY', 'SERVED'] as const)
    await transitionByStaff(id, status, counter);
}
const stock = () => IngredientModel.findById(ingredientId).orFail();
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(repl.getUri());
  app = buildApp();
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
}, 120000);
beforeEach(async () => {
  vi.restoreAllMocks();
  for (const c of Object.values(mongoose.connection.collections)) await c.deleteMany({});
  const member = await registerMember({
    name: 'Khách thử',
    phone: '0901234567',
    password: 'Password@123',
  });
  actor = { id: member.member.id, staff: false };
  cookie = `mc_member=${member.token}`;
  other = {
    id: (await registerMember({ name: 'Khác', phone: '0901234568', password: 'Password@123' }))
      .member.id,
    staff: false,
  };
  const passwordHash = await hashPassword('Password@123');
  const staff = await UserModel.create({
    name: 'Thu ngân',
    email: 'counter@pickup.test',
    role: 'STAFF',
    passwordHash,
  });
  adminId = (
    await UserModel.create({
      name: 'Quản lý',
      email: 'admin@pickup.test',
      role: 'ADMIN',
      passwordHash,
    })
  ).id;
  counter = { id: staff.id, staff: true };
  staffAuth = {
    Authorization: `Bearer ${signAccessToken({ sub: staff.id, role: 'STAFF', name: staff.name })}`,
  };
  const category = await CategoryModel.create({ name: 'Trà', slug: 'tra' });
  productId = (
    await ProductModel.create({
      categoryId: category._id,
      name: 'Trà thử',
      slug: 'tra-thu',
      image: '/favicon.svg',
      basePrice: 30000,
      allowedOptions: { sizes: [], sugarLevels: ['0%'], iceLevels: ['normal-ice'], toppingIds: [] },
    })
  ).id;
  ingredientId = (
    await IngredientModel.create({
      code: 'TEA',
      name: 'Trà',
      unit: 'g',
      onHand: 100000,
      reserved: 0,
    })
  ).id;
  await RecipeModel.create({
    targetType: 'PRODUCT',
    targetId: productId,
    enabled: true,
    components: [{ ingredientId, quantity: 10000 }],
  });
});
afterAll(async () => {
  await mongoose.disconnect();
  await repl.stop();
});

describe('standalone takeaway and preorder pickup', () => {
  it('allows member AI without a table but keeps table operations, CSRF and revoked-member access protected', async () => {
    const recommend = vi.spyOn(AIService.prototype, 'recommend').mockResolvedValue({ mode: 'fallback', message: 'Menu', recommendations: [], latencyMs: 0 });
    for (const path of ['/ai/recommendations', '/ai/recommendations/validate']) {
      const body = path.endsWith('/validate') ? { productId, variantId: null, toppingIds: [], constraints: {} } : { prompt: 'trà' };
      expect((await request(app).post(`/api/v1${path}`).send(body)).status).toBe(401);
      const response = await request(app).post(`/api/v1${path}`).set('Cookie', cookie).send(body);
      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect((await request(app).post(`/api/v1${path}`).set('Cookie', cookie).set('Origin', 'https://foreign.test').send(body)).status).toBe(403);
    }
    expect(recommend).toHaveBeenCalledOnce();
    expect((await request(app).post('/api/v1/orders/quote').set('Cookie', cookie).send({ items: input().items })).status).toBe(401);
    await MemberModel.updateOne({ _id: actor.id }, { $inc: { authVersion: 1 } });
    expect((await request(app).post('/api/v1/ai/recommendations').set('Cookie', cookie).send({ prompt: 'trà' })).status).toBe(401);
  });
  it('requires member/staff auth and rejects forged owner fields, invalid ids and internal roles', async () => {
    expect((await request(app).get('/api/v1/pickups')).status).toBe(401);
    expect((await request(app).post('/api/v1/pickups').send(input())).status).toBe(401);
    expect((await request(app).get('/api/v1/staff/pickups')).status).toBe(401);
    expect((await request(app).get('/api/v1/admin/pickups').set(staffAuth)).status).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/v1/pickups')
          .set('Cookie', cookie)
          .send({ ...(await quoted()), memberId: other.id })
      ).status,
    ).toBe(422);
    expect(
      (await request(app).get('/api/v1/pickups/not-an-id/bill').set('Cookie', cookie)).status,
    ).toBe(422);
  });
  it('creates no table/session, normalizes contact, and replays concurrent identical requests', async () => {
    const body = await quoted(actor, {
      pickup: {
        fulfillmentType: 'TAKEAWAY',
        name: ' Lan ',
        phone: '+84 901 234 567',
        scheduledAt: null,
      },
    });
    const results = await Promise.all([createPickup(actor, body), createPickup(actor, body)]);
    expect(results.map((r) => r.order.id)).toEqual([results[0]!.order.id, results[0]!.order.id]);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(await TableModel.countDocuments()).toBe(0);
    expect(await TableSessionModel.countDocuments()).toBe(0);
    const o = results[0]!.order;
    expect(o.tableId).toBeNull();
    expect(o.tableSessionId).toBeNull();
    expect(o.pickup?.phone).toBe('0901234567');
    expect(o.status).toBe('AWAITING_PAYMENT');
    expect((await stock()).reserved).toBe(10000);
    await expect(
      createPickup(actor, { ...body, pickup: { ...body.pickup, name: 'Khác' } }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    const serialized = await pickupDto(o);
    expect(JSON.stringify(serialized)).not.toMatch(
      /requestHash|idempotencyKey|createdBy|inventorySnapshot/,
    );
  });
  it('scopes ownership, request keys and bills to the member and keeps contact out of shared KDS events', async () => {
    const body = await quoted(),
      a = (await createPickup(actor, body)).order;
    const b = (await createPickup(other, await quoted(other, { requestId: body.requestId }))).order;
    expect(a.id).not.toBe(b.id);
    expect((await listPickups(actor, 1, false)).items.map((o) => o._id)).toEqual([a.id]);
    await expect(
      closePickup(other, a.id, { expectedVersion: a.version, reason: 'Không phải đơn tôi' }),
    ).rejects.toMatchObject({ status: 403 });
    await pay(a.id);
    await serve(a.id);
    await expect(getPickupBill(other, a.id)).rejects.toMatchObject({ status: 404 });
    const events = await OutboxEventModel.find({ aggregateId: a.id });
    expect(events.every((e) => e.target.scope === 'staff')).toBe(true);
    expect(JSON.stringify(events.map((e) => e.payload))).not.toMatch(
      /0901234567|Khách thử|member:/,
    );
  });
  it('checks preorder time range, strict options, and quote contact/schedule/item ownership', async () => {
    const pickup = {
      fulfillmentType: 'PICKUP' as const,
      name: 'Lan',
      phone: '0901234567',
      scheduledAt: new Date(Date.now() + 3600000).toISOString(),
    };
    for (const delta of [-1, 14 * 60000, 8 * 86400000])
      await expect(
        quotePickup(
          actor,
          input({ pickup: { ...pickup, scheduledAt: new Date(Date.now() + delta).toISOString() } }),
        ),
      ).rejects.toThrow();
    await expect(
      quotePickup(actor, input({ pickup: { ...pickup, scheduledAt: null } })),
    ).rejects.toThrow();
    const body = await quoted(actor, { pickup });
    await expect(
      createPickup(actor, {
        ...body,
        pickup: { ...pickup, scheduledAt: new Date(Date.now() + 7200000).toISOString() },
      }),
    ).rejects.toMatchObject({ code: 'QUOTE_CHANGED' });
    await expect(createPickup(other, body)).rejects.toMatchObject({ code: 'QUOTE_CHANGED' });
    await expect(
      createPickup(actor, { ...body, items: [{ ...body.items[0]!, quantity: 2 }] }),
    ).rejects.toMatchObject({ code: 'QUOTE_CHANGED' });
    await expect(
      quotePickup(actor, input({ items: [{ ...input().items[0]!, sugarLevel: 'invalid' }] })),
    ).rejects.toThrow();
  });
  it('serializes the member limit at three active orders and unlocks capacity after cancel', async () => {
    const bodies = await Promise.all(Array.from({ length: 4 }, () => quoted()));
    const results = await Promise.allSettled(bodies.map((b) => createPickup(actor, b)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    const first = await OrderModel.findOne().orFail();
    await closePickup(actor, first.id, { expectedVersion: first.version, reason: 'Đổi kế hoạch' });
    await place();
    expect(await OrderModel.countDocuments()).toBe(4);
  });
  it('prevents overselling the last ingredient across customers and releases reservations on cancel', async () => {
    await IngredientModel.updateOne({ _id: ingredientId }, { $set: { onHand: 10000 } });
    const [a, b] = await Promise.all([quoted(), quoted(other)]);
    const result = await Promise.allSettled([createPickup(actor, a), createPickup(other, b)]);
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await stock()).reserved).toBe(10000);
    const winner = await OrderModel.findOne().orFail();
    await closePickup(counter, winner.id, { expectedVersion: winner.version, reason: 'Khách hủy' });
    expect((await stock()).reserved).toBe(0);
    expect((await stock()).onHand).toBe(10000);
    await place();
    expect((await stock()).reserved).toBe(10000);
  });
  it('retains stock and money integrity on changed catalog or transactional audit/outbox failure', async () => {
    const body = await quoted();
    await ProductModel.updateOne({ _id: productId }, { $set: { basePrice: 35000 } });
    await expect(createPickup(actor, body)).rejects.toMatchObject({ code: 'QUOTE_CHANGED' });
    const fresh = await quoted();
    vi.spyOn(auditRepository, 'log').mockRejectedValueOnce(new Error('audit down'));
    await expect(createPickup(actor, fresh)).rejects.toThrow('audit down');
    expect(await OrderModel.countDocuments()).toBe(0);
    expect((await stock()).reserved).toBe(0);
    vi.restoreAllMocks();
    vi.spyOn(outboxRepository, 'createRealtimeEvents').mockRejectedValueOnce(
      new Error('outbox down'),
    );
    await expect(createPickup(actor, fresh)).rejects.toThrow('outbox down');
    expect(await OrderModel.countDocuments()).toBe(0);
    expect(await OutboxEventModel.countDocuments()).toBe(0);
  });
  it('supports partial collection with replay and optimistic race protection without a table claim', async () => {
    const o = await place(),
      key = randomUUID();
    const input = {
      orderId: o.id,
      staffId: counter.id,
      expectedVersion: o.version,
      amount: 10000,
      method: 'CASH' as const,
      idempotencyKey: key,
    };
    await confirmOrderPayment(input);
    expect((await confirmOrderPayment(input)).replayed).toBe(true);
    expect((await OrderModel.findById(o.id).orFail()).status).toBe('AWAITING_PAYMENT');
    expect(await listOrdersForStaff()).toHaveLength(0);
    await expect(confirmOrderPayment({ ...input, amount: 20000 })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
    await expect(pay(o.id, 21000)).rejects.toThrow();
    const current = await OrderModel.findById(o.id).orFail();
    const raced = await Promise.allSettled([
      confirmOrderPayment({
        ...input,
        expectedVersion: current.version,
        amount: 20000,
        idempotencyKey: randomUUID(),
      }),
      confirmOrderPayment({
        ...input,
        expectedVersion: current.version,
        amount: 20000,
        idempotencyKey: randomUUID(),
      }),
    ]);
    expect(raced.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await PaymentModel.countDocuments()).toBe(2);
    expect((await listOrdersForStaff()).map((x) => x.id)).toEqual([o.id]);
  });
  it('keeps future preorders off KDS, gates early preparation, and rejects unpaid stages', async () => {
    const o = await place(actor, {
      pickup: {
        fulfillmentType: 'PICKUP',
        name: 'Lan',
        phone: '0901234567',
        scheduledAt: new Date(Date.now() + 3600000).toISOString(),
      },
    });
    await expect(transitionByStaff(o.id, 'CONFIRMED', counter)).rejects.toThrow();
    await pay(o.id);
    expect(await listOrdersForStaff()).toHaveLength(0);
    expect((await operationsSummary()).database.activeOrders).toBe(0);
    await transitionByStaff(o.id, 'CONFIRMED', counter);
    await expect(transitionByStaff(o.id, 'PREPARING', counter)).rejects.toThrow('15 phút');
    await OrderModel.updateOne(
      { _id: o.id },
      { $set: { 'pickup.scheduledAt': new Date(Date.now() + 10 * 60000) } },
    );
    expect(await listOrdersForStaff()).toHaveLength(1);
    await transitionByStaff(o.id, 'PREPARING', counter);
    expect((await stock()).onHand).toBe(90000);
    expect((await stock()).reserved).toBe(0);
  });
  it('completes two independent pickups with immutable bills and earns points only when collected', async () => {
    for (const a of [actor, other]) {
      const o = await place(a);
      await pay(o.id);
      expect(await PointEntryModel.countDocuments({ type: 'EARN' })).toBe(a === actor ? 0 : 1);
      await serve(o.id);
      const completed = await OrderModel.findById(o.id).orFail();
      expect(completed.pickup?.outcome).toBe('COLLECTED');
      expect(completed.earnedPoints).toBe(3);
      expect((await pickupDto(completed)).billId).not.toBeNull();
      const bill = await getPickupBill(a, o.id);
      expect(bill.total).toBe(30000);
      expect(JSON.stringify(bill)).not.toMatch(/confirmedBy|idempotencyKey|0901234567/);
      await expect(transitionByStaff(o.id, 'SERVED', counter)).rejects.toThrow();
      expect(await BillModel.countDocuments({ pickupOrderId: o._id })).toBe(1);
      await ProductModel.updateOne({ _id: productId }, { $set: { name: 'Tên đã đổi' } });
      expect((await getPickupBill(a, o.id)).order?.items[0]?.name).toBe(
        a === actor ? 'Trà thử' : 'Tên đã đổi',
      );
    }
    expect(await BillModel.countDocuments()).toBe(2);
    expect(await TableSessionModel.countDocuments()).toBe(0);
  });
  it('cancels and refunds partial or zero-value payments safely before preparation', async () => {
    const o = await place();
    await pay(o.id, 10000);
    let current = await OrderModel.findById(o.id).orFail();
    await expect(
      closePickup(actor, o.id, { expectedVersion: current.version, reason: 'Hủy đơn' }),
    ).rejects.toThrow('hoàn tiền');
    await refundAndCancelOrder(o.id, counter.id, current.version, 10000, 'CASH', 'Đã hoàn tiền');
    await refundAndCancelOrder(o.id, counter.id, current.version, 10000, 'CASH', 'Đã hoàn tiền');
    expect((await stock()).reserved).toBe(0);
    expect(await PaymentModel.countDocuments({ status: 'REFUNDED' })).toBe(1);
    await ProductModel.updateOne({ _id: productId }, { $set: { basePrice: 0 } });
    const free = await place();
    await pay(free.id, 0);
    current = await OrderModel.findById(free.id).orFail();
    await refundAndCancelOrder(
      free.id,
      counter.id,
      current.version,
      0,
      'OTHER',
      'Hủy đơn miễn phí',
    );
    expect((await OrderModel.findById(free.id).orFail()).status).toBe('CANCELLED');
  });
  it('keeps voucher and point reservation/refund rules shared with dine-in', async () => {
    await MemberModel.updateOne({ _id: actor.id }, { $set: { points: 20 } });
    const voucher = await saveVoucher(
      null,
      {
        code: 'PICK10',
        name: 'Giảm',
        type: 'FIXED',
        value: 10000,
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
      adminId,
    );
    const o = await place(actor, { voucherCode: 'PICK10', redeemPoints: 5 });
    expect(o.total).toBe(15000);
    await pay(o.id);
    const current = await OrderModel.findById(o.id).orFail();
    await refundAndCancelOrder(o.id, counter.id, current.version, 15000, 'CASH', 'Đã hoàn tiền');
    expect((await MemberModel.findById(actor.id).orFail()).points).toBe(20);
    expect((await VoucherModel.findById(voucher.id).orFail()).usedCount).toBe(0);
    expect((await VoucherUseModel.findOne({ orderId: o.id }).orFail()).state).toBe('RELEASED');
    const collected = await place(actor, { voucherCode: 'PICK10', redeemPoints: 5 });
    await pay(collected.id);
    await serve(collected.id);
    const invoice = await getPickupBill(actor, collected.id);
    expect(invoice.order?.voucherCode).toBe('PICK10');
    expect(invoice.order?.redeemedPoints).toBe(5);
    expect(invoice.order?.voucherDiscount).toBe(10000);
    expect(invoice.order?.pointsDiscount).toBe(5000);
  });
  it('records unpaid no-show only after grace time, releases holds and prevents future collection', async () => {
    const o = await place();
    await expect(
      closePickup(counter, o.id, { expectedVersion: o.version, reason: 'Khách không đến' }, true),
    ).rejects.toThrow('30 phút');
    await OrderModel.collection.updateOne(
      { _id: o._id },
      { $set: { createdAt: new Date(Date.now() - 70 * 60000) } },
    );
    const closed = await closePickup(
      counter,
      o.id,
      { expectedVersion: o.version, reason: 'Gọi khách không đến' },
      true,
    );
    expect(closed.pickup?.outcome).toBe('NO_SHOW');
    expect(closed.status).toBe('CANCELLED');
    expect((await stock()).reserved).toBe(0);
    await expect(pay(o.id)).rejects.toThrow();
    expect((await listPickups(actor, 1, false)).total).toBe(0);
    const auditCount = await AuditLogModel.countDocuments();
    await closePickup(
      counter,
      o.id,
      { expectedVersion: o.version, reason: 'Gọi khách không đến' },
      true,
    );
    expect(await AuditLogModel.countDocuments()).toBe(auditCount);
  });
  it('requires refund for paid unprepared no-show and retains consumed stock for prepared uncollected drinks', async () => {
    const o = await place();
    await pay(o.id);
    await OrderModel.collection.updateOne(
      { _id: o._id },
      { $set: { createdAt: new Date(Date.now() - 70 * 60000) } },
    );
    let current = await OrderModel.findById(o.id).orFail();
    await expect(
      closePickup(
        counter,
        o.id,
        { expectedVersion: current.version, reason: 'Khách không đến' },
        true,
      ),
    ).rejects.toThrow('hoàn tiền');
    await transitionByStaff(o.id, 'CONFIRMED', counter);
    await transitionByStaff(o.id, 'PREPARING', counter);
    await transitionByStaff(o.id, 'READY', counter);
    current = await OrderModel.findById(o.id).orFail();
    await closePickup(
      counter,
      o.id,
      { expectedVersion: current.version, reason: 'Không liên hệ được' },
      true,
    );
    expect((await stock()).onHand).toBe(90000);
    expect(await PointEntryModel.countDocuments({ type: 'EARN' })).toBe(0);
    expect(await BillModel.countDocuments({ pickupOrderId: o.id })).toBe(1);
    expect(await listOrdersForStaff()).toHaveLength(0);
    expect((await operationsSummary()).database.activeOrders).toBe(0);
    expect(
      (await runAnomalyDetection()).find((e) => e.detector === 'PREPARATION_P95')?.sampleCount,
    ).toBe(0);
    await expect(transitionByStaff(o.id, 'SERVED', counter)).rejects.toThrow();
  });
  it('rolls back payment, delivery invoice, activity and no-show together with failed audit/outbox', async () => {
    const o = await place();
    vi.spyOn(outboxRepository, 'createRealtimeEvents').mockRejectedValueOnce(
      new Error('outbox fail'),
    );
    await expect(pay(o.id)).rejects.toThrow('outbox fail');
    expect(await PaymentModel.countDocuments()).toBe(0);
    expect((await OrderModel.findById(o.id).orFail()).paymentStatus).toBe('UNPAID');
    vi.restoreAllMocks();
    await pay(o.id);
    for (const status of ['CONFIRMED', 'PREPARING', 'READY'] as const)
      await transitionByStaff(o.id, status, counter);
    vi.spyOn(auditRepository, 'log').mockRejectedValueOnce(new Error('audit fail'));
    await expect(transitionByStaff(o.id, 'SERVED', counter)).rejects.toThrow('audit fail');
    expect(await BillModel.countDocuments()).toBe(0);
    expect(await WorkActivityModel.countDocuments({ orderId: o.id, stage: 'SERVED' })).toBe(0);
    expect((await OrderModel.findById(o.id).orFail()).pickup?.outcome).toBe('ACTIVE');
    expect(await PointEntryModel.countDocuments({ type: 'EARN' })).toBe(0);
  });
  it('supports supervised payment method corrections and preserves finalized invoice snapshots', async () => {
    const o = await place();
    const p = await pay(o.id);
    const c = await requestPaymentCorrection(p.payment.id, counter.id, {
      kind: 'METHOD',
      method: 'BANK_TRANSFER',
      reason: 'Ghi nhầm phương thức',
    });
    await expect(transitionByStaff(o.id, 'CONFIRMED', counter)).rejects.toThrow();
    await decidePaymentCorrection(c.id, adminId, {
      approve: true,
      expectedVersion: c.version,
      note: 'Đã kiểm tra',
    });
    await serve(o.id);
    const bill = await BillModel.findOne({ pickupOrderId: o.id }).orFail();
    expect(bill.payments[0]?.method).toBe('BANK_TRANSFER');
    const replacement = await PaymentModel.findOne({ replacesPaymentId: p.payment.id }).orFail();
    const c2 = await requestPaymentCorrection(replacement.id, counter.id, {
      kind: 'METHOD',
      method: 'OTHER',
      reason: 'Đối soát lại',
    });
    await decidePaymentCorrection(c2.id, adminId, {
      approve: true,
      expectedVersion: c2.version,
      note: 'Đã kiểm tra',
    });
    expect((await BillModel.findById(bill.id).orFail()).payments[0]?.method).toBe('BANK_TRANSFER');
  });
  it('exposes working staff/member endpoints, snapshots versions, and prevents contact leakage through shared DTO', async () => {
    const body = input();
    const q = await request(app).post('/api/v1/staff/pickups/quote').set(staffAuth).send(body);
    expect(q.status).toBe(200);
    const placed = await request(app)
      .post('/api/v1/staff/pickups')
      .set(staffAuth)
      .send({ ...body, quoteToken: q.body.data.quoteToken });
    expect(placed.status).toBe(200);
    const o = placed.body.data.order;
    expect(
      (await request(app).get('/api/v1/pickups').set('Cookie', cookie)).body.data.items,
    ).toHaveLength(0);
    expect((await request(app).get('/api/v1/staff/pickups/catalog').set(staffAuth)).status).toBe(
      200,
    );
    const payment = await request(app)
      .post(`/api/v1/staff/pickups/${o._id}/payments`)
      .set(staffAuth)
      .set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: o.version, amount: 30000, method: 'CASH' });
    expect(payment.status).toBe(200);
    const feed = await request(app).get('/api/v1/staff/orders').set(staffAuth);
    expect(feed.status).toBe(200);
    expect(feed.body.data.items).toHaveLength(1);
    expect(JSON.stringify(feed.body.data)).not.toMatch(/0901234567|Khách thử/);
    const stale = await request(app)
      .patch(`/api/v1/staff/pickups/${o._id}/status`)
      .set(staffAuth)
      .send({ status: 'CONFIRMED', expectedVersion: o.version });
    expect(stale.status).toBe(409);
  });
  it('migrates old table-only unique indexes idempotently without rewriting business documents', async () => {
    const db = mongoose.connection.db!;
    await db
      .collection('orders')
      .createIndex(
        { tableSessionId: 1, idempotencyKey: 1 },
        { unique: true, name: 'tableSessionId_1_idempotencyKey_1' },
      );
    await db
      .collection('bills')
      .createIndex({ tableSessionId: 1 }, { unique: true, name: 'tableSessionId_1' });
    const sid = new mongoose.Types.ObjectId(),
      tableId = new mongoose.Types.ObjectId();
    await OrderModel.create({
      tableSessionId: sid,
      tableId,
      code: 'OLD1',
      participantId: 'old',
      items: [],
      total: 0,
      idempotencyKey: 'legacy',
      requestHash: 'old',
    });
    const before = JSON.stringify(await db.collection('orders').find().toArray());
    await migratePickupIndexes(db);
    await migratePickupIndexes(db);
    expect(JSON.stringify(await db.collection('orders').find().toArray())).toBe(before);
    await expect(
      OrderModel.create({
        tableSessionId: sid,
        tableId,
        code: 'OLD2',
        participantId: 'old2',
        items: [],
        total: 0,
        idempotencyKey: 'legacy',
        requestHash: 'old',
      }),
    ).rejects.toMatchObject({ code: 11000 });
    const a = await place();
    const b = await place(other);
    await pay(a.id);
    await serve(a.id);
    await pay(b.id);
    await serve(b.id);
    expect(await BillModel.countDocuments()).toBe(2);
  });
});
