import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { buildApp } from '../../app.js';
import { UserModel } from '../../models/User.js';
import { TableModel } from '../../models/Table.js';
import { CategoryModel } from '../../models/Category.js';
import { ProductModel } from '../../models/Product.js';
import { OrderModel } from '../../models/Order.js';
import { PaymentModel } from '../../models/Payment.js';
import { TableSessionModel } from '../../models/TableSession.js';
import { GuestSessionModel } from '../../models/GuestSession.js';
import { BillModel } from '../../models/Bill.js';
import { OutboxEventModel } from '../../models/OutboxEvent.js';
import { AuditLogModel } from '../../models/AuditLog.js';
import { ReviewModel } from '../../models/Review.js';
import { PaymentCorrectionModel } from '../../models/PaymentCorrection.js';
import { paymentAnalytics } from '../../services/paymentAnalyticsService.js';
import { createAdmissionTicket } from '../../services/tableQrService.js';
import { hashPassword, randomToken, sha256 } from '../../utils/crypto.js';

let repl: MongoMemoryReplSet;
let app: ReturnType<typeof buildApp>;
let access: string;
let tableId: string;
let staticToken: string;
let displayToken: string;
let payload: object;
const cookieOf = (response: request.Response) =>
  (response.headers['set-cookie'] as unknown as string[])
    .map((value) => value.split(';')[0])
    .join('; ');
const auth = () => ({ Authorization: `Bearer ${access}` });
async function person(role: 'STAFF' | 'ADMIN') {
  const email = `${randomToken(8)}@test.vn`;
  const user = await UserModel.create({
    name: `${role} thứ hai`,
    email,
    role,
    isActive: true,
    passwordHash: await hashPassword('Password@123'),
  });
  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password: 'Password@123' });
  return { id: user.id, headers: { Authorization: `Bearer ${login.body.data.accessToken}` } };
}
const claimFor = (sessionId: string, headers: Record<string, string>, token: string) =>
  request(app)
    .post(`/api/v1/staff/table-sessions/${sessionId}/payment-claim`)
    .set(headers)
    .send({ token });
const releaseFor = (sessionId: string, headers: Record<string, string>, token: string) =>
  request(app)
    .post(`/api/v1/staff/table-sessions/${sessionId}/payment-claim/release`)
    .set(headers)
    .send({ token });
async function correction(paymentId: string, kind: 'VOID' | 'METHOD' | 'TRANSFER', extra = {}) {
  return request(app)
    .post(`/api/v1/staff/payments/${paymentId}/corrections`)
    .set(auth())
    .send({ kind, reason: 'Nhân viên ghi nhầm, cần điều chỉnh', ...extra });
}
const decision = (id: string, headers: Record<string, string>, approve = true) =>
  request(app)
    .post(`/api/v1/admin/payment-corrections/${id}/decision`)
    .set(headers)
    .send({ expectedVersion: 0, approve, note: 'Đã đối chiếu khoản thu với khách' });
const collectionToken = randomToken(24);
async function provision() {
  const response = await request(app).post(`/api/v1/staff/tables/${tableId}/display`).set(auth());
  expect(response.status).toBe(200);
  return new URL(response.body.data.url).hash.slice(1);
}
async function qr(token = displayToken) {
  return request(app).get('/api/v1/table-displays/qr').set('X-Table-Display-Token', token);
}
async function join(ticket?: string) {
  const current = ticket ?? new URL((await qr()).body.data.url).pathname.split('/t/')[1]!;
  return request(app).post('/api/v1/table-sessions/join').send({ tableToken: current });
}
async function place(cookie: string, key = randomToken(16)) {
  const quote = await request(app).post('/api/v1/orders/quote').set('Cookie', cookie).send(payload);
  expect(quote.status).toBe(200);
  return request(app)
    .post('/api/v1/orders')
    .set('Cookie', cookie)
    .set('Idempotency-Key', key)
    .send({ ...payload, quoteToken: quote.body.data.quoteToken });
}
async function receive(
  orderId: string,
  key = randomToken(16),
  override: Record<string, unknown> = {},
) {
  const order = (await OrderModel.findById(orderId))!;
  await request(app)
    .post(`/api/v1/staff/table-sessions/${order.tableSessionId}/payment-claim`)
    .set(auth())
    .send({ token: collectionToken });
  const response = await request(app)
    .post(`/api/v1/staff/orders/${orderId}/payments`)
    .set(auth())
    .set('Idempotency-Key', key)
    .set('X-Payment-Claim', collectionToken)
    .send({ amount: order.total, expectedVersion: order.version, method: 'CASH', ...override });
  await request(app)
    .post(`/api/v1/staff/table-sessions/${order.tableSessionId}/payment-claim/release`)
    .set(auth())
    .send({ token: collectionToken });
  return response;
}
async function close(sessionId: string) {
  const session = (await TableSessionModel.findById(sessionId))!;
  return request(app)
    .patch(`/api/v1/staff/table-sessions/${sessionId}/status`)
    .set(auth())
    .send({ status: 'CLOSED', expectedVersion: session.version });
}
async function serve(orderId: string) {
  for (const status of ['CONFIRMED', 'PREPARING', 'READY', 'SERVED']) {
    const response = await request(app)
      .patch(`/api/v1/staff/orders/${orderId}/status`)
      .set(auth())
      .send({ status });
    expect(response.status).toBe(200);
  }
}
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(repl.getUri());
  app = buildApp();
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
}, 120_000);
afterAll(async () => {
  await mongoose.disconnect();
  await repl.stop();
});
beforeEach(async () => {
  await Promise.all(
    Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})),
  );
  await UserModel.create({
    name: 'Cashier',
    email: 'cashier@test.vn',
    role: 'STAFF',
    isActive: true,
    passwordHash: await hashPassword('Password@123'),
  });
  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'cashier@test.vn', password: 'Password@123' });
  access = login.body.data.accessToken;
  staticToken = randomToken(24);
  const table = await TableModel.create({
    code: 'B01',
    name: 'Bàn 01',
    capacity: 4,
    publicTokenHash: sha256(staticToken),
    isActive: true,
  });
  tableId = table.id;
  displayToken = await provision();
  const category = await CategoryModel.create({ name: 'Cà phê', slug: 'coffee', isActive: true });
  const product = await ProductModel.create({
    name: 'Espresso',
    slug: 'espresso',
    image: 'https://example.com/espresso.jpg',
    categoryId: category._id,
    basePrice: 35000,
    isAvailable: true,
    isArchived: false,
    allowedOptions: { sugarLevels: ['0%'], iceLevels: ['normal-ice'], sizes: [], toppingIds: [] },
  });
  payload = {
    items: [
      {
        productId: product.id,
        variantId: null,
        sugarLevel: '0%',
        iceLevel: 'normal-ice',
        toppingIds: [],
        quantity: 1,
      },
    ],
  };
});

describe('payment safeguards', () => {
  it('requires an explanation for a shift discrepancy and blocks closing while a cashier holds a table', async () => {
    const visit = await join();
    const id = (await place(cookieOf(visit))).body.data.order._id;
    await receive(id);
    let shift = (await request(app).get('/api/v1/staff/cash-shifts/current').set(auth())).body.data
      .shift;
    expect(
      (
        await request(app)
          .post(`/api/v1/staff/cash-shifts/${shift.id}/close`)
          .set(auth())
          .send({ expectedVersion: shift.version, countedCash: 34000 })
      ).status,
    ).toBe(422);
    const token = randomToken(24);
    await claimFor(visit.body.data.tableSessionId, auth(), token);
    shift = (await request(app).get('/api/v1/staff/cash-shifts/current').set(auth())).body.data
      .shift;
    expect(
      (
        await request(app)
          .post(`/api/v1/staff/cash-shifts/${shift.id}/close`)
          .set(auth())
          .send({ expectedVersion: shift.version, countedCash: 35000 })
      ).body.error.code,
    ).toBe('PAYMENT_CLAIMED');
    await releaseFor(visit.body.data.tableSessionId, auth(), token);
    const closed = await request(app)
      .post(`/api/v1/staff/cash-shifts/${shift.id}/close`)
      .set(auth())
      .send({
        expectedVersion: shift.version,
        countedCash: 34000,
        note: 'Thiếu 1000 VND khi kiểm đếm',
      });
    expect(closed.status).toBe(200);
    expect(closed.body.data.shift).toMatchObject({
      expectedCash: 35000,
      difference: -1000,
      reconciliationNote: 'Thiếu 1000 VND khi kiểm đếm',
    });
  });

  it('holds further collection during a partial-payment cancellation request and refunds before cancellation', async () => {
    const cookie = cookieOf(await join());
    const id = (await place(cookie)).body.data.order._id;
    await receive(id, randomToken(16), { amount: 10000 });
    const cancellation = await request(app)
      .post(`/api/v1/orders/${id}/cancel-requests`)
      .set('Cookie', cookie)
      .send({ reason: 'Khách muốn hủy phần đã đặt' });
    expect(cancellation.status).toBe(201);
    expect((await receive(id, randomToken(16), { amount: 25000 })).body.error.code).toBe(
      'CANCEL_REQUEST_PENDING',
    );
    const result = await request(app)
      .patch(`/api/v1/staff/cancel-requests/${cancellation.body.data.request._id}`)
      .set(auth())
      .send({
        decision: 'APPROVED',
        expectedVersion: 0,
        refundConfirmed: true,
        refundMethod: 'CASH',
      });
    expect(result.status).toBe(200);
    expect((await OrderModel.findById(id))!.toObject()).toMatchObject({
      status: 'CANCELLED',
      paymentStatus: 'REFUNDED',
      paidAmount: 0,
    });
  });
  it('serializes two different employees claiming one table and rejects the losing employee payment', async () => {
    const visit = await join();
    const order = (await place(cookieOf(visit))).body.data.order;
    const other = await person('STAFF');
    const tokens = [randomToken(24), randomToken(24)];
    const actors = [auth(), other.headers];
    const sessionId = visit.body.data.tableSessionId;
    const claims = await Promise.all(
      actors.map((headers, i) => claimFor(sessionId, headers, tokens[i]!)),
    );
    expect(claims.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = claims[0]!.status === 200 ? 0 : 1;
    const payAs = (index: number) =>
      request(app)
        .post(`/api/v1/staff/orders/${order._id}/payments`)
        .set(actors[index]!)
        .set('Idempotency-Key', randomToken(16))
        .set('X-Payment-Claim', tokens[index]!)
        .send({ amount: order.total, method: 'CASH', expectedVersion: 0 });
    expect((await payAs(1 - winner)).status).toBe(409);
    await releaseFor(sessionId, actors[1 - winner]!, tokens[1 - winner]!);
    expect((await claimFor(sessionId, actors[1 - winner]!, tokens[1 - winner]!)).status).toBe(409);
    expect((await payAs(winner)).status).toBe(201);
    expect(await PaymentModel.countDocuments()).toBe(1);
    expect((await TableSessionModel.findById(sessionId))!.collectionExpiresAt).toBeNull();
    expect((await claimFor(sessionId, actors[1 - winner]!, tokens[1 - winner]!)).status).toBe(200);
  });

  it('rejects missing and expired claims, allows takeover and never lets the old owner pay', async () => {
    const visit = await join();
    const order = (await place(cookieOf(visit))).body.data.order;
    const sessionId = visit.body.data.tableSessionId;
    const token = randomToken(24);
    const other = await person('STAFF');
    const pay = (headers: Record<string, string>, claim?: string) => {
      const req = request(app)
        .post(`/api/v1/staff/orders/${order._id}/payments`)
        .set(headers)
        .set('Idempotency-Key', randomToken(16));
      if (claim) req.set('X-Payment-Claim', claim);
      return req.send({ amount: order.total, method: 'CASH', expectedVersion: 0 });
    };
    expect((await pay(auth())).status).toBe(409);
    expect((await claimFor(sessionId, auth(), token)).status).toBe(200);
    await TableSessionModel.updateOne(
      { _id: sessionId },
      { $set: { collectionExpiresAt: new Date(Date.now() - 1) } },
    );
    expect((await pay(auth(), token)).status).toBe(409);
    const secondToken = randomToken(24);
    expect((await claimFor(sessionId, other.headers, secondToken)).status).toBe(200);
    expect((await claimFor(sessionId, auth(), token)).status).toBe(409);
    expect((await pay(auth(), token)).status).toBe(409);
    expect((await pay(other.headers, secondToken)).status).toBe(201);
  });

  it('collects multiple installments, exposes the balance and holds KDS and cancellation until fully paid', async () => {
    const visit = await join();
    const cookie = cookieOf(visit);
    const id = (await place(cookie)).body.data.order._id;
    const key = randomToken(16);
    const first = await receive(id, key, { amount: 10000 });
    expect(first.status).toBe(201);
    expect((await receive(id, key, { amount: 10000 })).status).toBe(200);
    expect(await PaymentModel.countDocuments()).toBe(1);
    const mine = await request(app).get('/api/v1/orders/mine').set('Cookie', cookie);
    expect(mine.body.data.orders[0]).toMatchObject({
      status: 'AWAITING_PAYMENT',
      paymentStatus: 'UNPAID',
      paidAmount: 10000,
      balanceDue: 25000,
    });
    expect((await request(app).get('/api/v1/staff/orders').set(auth())).body.data.items).toEqual(
      [],
    );
    expect(
      (await request(app).post(`/api/v1/orders/${id}/cancel`).set('Cookie', cookie)).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .patch(`/api/v1/staff/orders/${id}/status`)
          .set(auth())
          .send({ status: 'CANCELLED' })
      ).status,
    ).toBe(403);
    const bill = await request(app)
      .get(`/api/v1/staff/table-sessions/${visit.body.data.tableSessionId}/bill`)
      .set(auth());
    expect(bill.body.data).toMatchObject({ total: 25000, paidAmount: 10000 });
    const shift = await request(app).get('/api/v1/staff/cash-shifts/current').set(auth());
    expect(shift.body.data.shift.unpaidSessions[0].unpaidTotal).toBe(25000);
    expect((await receive(id, randomToken(16), { amount: 25001 })).status).toBe(422);
    expect(
      (await receive(id, randomToken(16), { amount: 25000, method: 'BANK_TRANSFER' })).status,
    ).toBe(201);
    expect((await OrderModel.findById(id))!.toObject()).toMatchObject({
      status: 'PENDING',
      paymentStatus: 'PAID',
      paidAmount: 35000,
    });
    await serve(id);
    expect((await close(visit.body.data.tableSessionId)).status).toBe(200);
    expect((await BillModel.findOne())!.paidAmount).toBe(35000);
  });

  it('refunds all installments exactly once and cancels a partially paid order', async () => {
    const visit = await join();
    const id = (await place(cookieOf(visit))).body.data.order._id;
    expect((await receive(id, randomToken(16), { amount: 5000 })).status).toBe(201);
    expect((await receive(id, randomToken(16), { amount: 10000 })).status).toBe(201);
    const order = (await OrderModel.findById(id))!;
    const refund = {
      amount: 15000,
      method: 'CASH',
      expectedVersion: order.version,
      reason: 'Khách đổi ý, đã hoàn tiền',
      refundConfirmed: true,
    };
    const responses = await Promise.all(
      [1, 2].map(() =>
        request(app).post(`/api/v1/staff/orders/${id}/refund`).set(auth()).send(refund),
      ),
    );
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect((await OrderModel.findById(id))!.paidAmount).toBe(0);
    expect(await PaymentModel.countDocuments({ status: 'REFUNDED' })).toBe(2);
    expect((await close(visit.body.data.tableSessionId)).status).toBe(200);
    const totals = await paymentAnalytics(
      new Date(Date.now() - 86400000),
      new Date(Date.now() + 86400000),
    );
    expect(totals).toMatchObject({ grossCollected: 15000, totalRefunded: 15000, totalRevenue: 0 });
  });

  it('requires admin approval, freezes pending corrections and applies a void only once under two admin approvals', async () => {
    const id = (await place(cookieOf(await join()))).body.data.order._id;
    const payment = (await receive(id)).body.data.payment;
    const created = await correction(payment._id, 'VOID');
    expect(created.status).toBe(201);
    expect((await correction(payment._id, 'VOID')).status).toBe(409);
    expect(
      (
        await request(app)
          .patch(`/api/v1/staff/orders/${id}/status`)
          .set(auth())
          .send({ status: 'CONFIRMED' })
      ).body.error.code,
    ).toBe('PAYMENT_CORRECTION_PENDING');
    expect((await decision(created.body.data._id, auth())).status).toBe(403);
    const admin = await person('ADMIN');
    const secondAdmin = await person('ADMIN');
    const responses = await Promise.all([
      decision(created.body.data._id, admin.headers),
      decision(created.body.data._id, secondAdmin.headers),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await OrderModel.findById(id))!.toObject()).toMatchObject({
      status: 'AWAITING_PAYMENT',
      paymentStatus: 'UNPAID',
      paidAmount: 0,
    });
    expect((await PaymentModel.findById(payment._id))!.reversalKind).toBe('VOID');
    expect(await PaymentCorrectionModel.countDocuments({ status: 'APPROVED' })).toBe(1);
    const totals = await paymentAnalytics(
      new Date(Date.now() - 86400000),
      new Date(Date.now() + 86400000),
    );
    expect(totals).toMatchObject({
      grossCollected: 35000,
      adjustmentAmount: -35000,
      totalRefunded: 0,
      totalRevenue: 0,
    });
  });

  it('corrects a method after closing without rewriting the original receipt or immutable bill', async () => {
    const visit = await join();
    const id = (await place(cookieOf(visit))).body.data.order._id;
    const payment = (await receive(id)).body.data.payment;
    await serve(id);
    expect((await close(visit.body.data.tableSessionId)).status).toBe(200);
    const snapshot = JSON.stringify((await BillModel.findOne())!.toObject());
    const created = await correction(payment._id, 'METHOD', { method: 'BANK_TRANSFER' });
    expect(created.status).toBe(201);
    const admin = await person('ADMIN');
    expect((await decision(created.body.data._id, admin.headers)).status).toBe(200);
    expect(JSON.stringify((await BillModel.findOne())!.toObject())).toBe(snapshot);
    const original = (await PaymentModel.findById(payment._id))!;
    expect(original.amount).toBe(35000);
    expect(original.method).toBe('CASH');
    expect(original.confirmedBy.toString()).toBe(payment.confirmedBy);
    expect(original.paidAt.toISOString()).toBe(payment.paidAt);
    expect(
      await PaymentModel.countDocuments({
        replacesPaymentId: payment._id,
        method: 'BANK_TRANSFER',
        status: 'SUCCESS',
      }),
    ).toBe(1);
    const totals = await paymentAnalytics(
      new Date(Date.now() - 86400000),
      new Date(Date.now() + 86400000),
    );
    expect(totals).toMatchObject({
      grossCollected: 35000,
      totalRefunded: 0,
      adjustmentAmount: 0,
      totalRevenue: 35000,
    });
    const shift = await request(app).get('/api/v1/staff/cash-shifts/current').set(auth());
    expect(shift.body.data.shift.paymentsByMethod.BANK_TRANSFER.total).toBe(35000);
    expect(shift.body.data.shift.reversalsByMethod.CASH.total).toBe(35000);
  });

  it('moves a mistaken receipt to the right order atomically and keeps net revenue unchanged', async () => {
    const cookie = cookieOf(await join());
    const source = (await place(cookie)).body.data.order._id;
    const target = (await place(cookie)).body.data.order._id;
    const payment = (await receive(source)).body.data.payment;
    const created = await correction(payment._id, 'TRANSFER', { targetOrderId: target });
    expect(created.status).toBe(201);
    expect((await receive(target)).body.error.code).toBe('PAYMENT_CORRECTION_PENDING');
    const admin = await person('ADMIN');
    expect((await decision(created.body.data._id, admin.headers)).status).toBe(200);
    expect((await OrderModel.findById(source))!.toObject()).toMatchObject({
      status: 'AWAITING_PAYMENT',
      paidAmount: 0,
      paymentStatus: 'UNPAID',
    });
    expect((await OrderModel.findById(target))!.toObject()).toMatchObject({
      status: 'PENDING',
      paidAmount: 35000,
      paymentStatus: 'PAID',
    });
    expect(
      (await paymentAnalytics(new Date(Date.now() - 86400000), new Date(Date.now() + 86400000)))
        .totalRevenue,
    ).toBe(35000);
  });

  it('rejects self approval and rejection restores operations without changing receipts', async () => {
    const id = (await place(cookieOf(await join()))).body.data.order._id;
    const payment = (await receive(id)).body.data.payment;
    const admin = await person('ADMIN');
    const created = await request(app)
      .post(`/api/v1/admin/payments/${payment._id}/corrections`)
      .set(admin.headers)
      .send({ kind: 'VOID', reason: 'Cần kiểm tra khoản thu' });
    expect(created.status).toBe(201);
    expect((await decision(created.body.data._id, admin.headers)).status).toBe(403);
    const secondAdmin = await person('ADMIN');
    expect((await decision(created.body.data._id, secondAdmin.headers, false)).status).toBe(200);
    expect((await PaymentModel.findById(payment._id))!.status).toBe('SUCCESS');
    expect(
      (
        await request(app)
          .patch(`/api/v1/staff/orders/${id}/status`)
          .set(auth())
          .send({ status: 'CONFIRMED' })
      ).status,
    ).toBe(200);
  });

  it('blocks wrong-order reversal after preparation and guards payment history permissions', async () => {
    const id = (await place(cookieOf(await join()))).body.data.order._id;
    const payment = (await receive(id)).body.data.payment;
    for (const status of ['CONFIRMED', 'PREPARING'])
      expect(
        (await request(app).patch(`/api/v1/staff/orders/${id}/status`).set(auth()).send({ status }))
          .status,
      ).toBe(200);
    expect((await correction(payment._id, 'VOID')).status).toBe(403);
    expect((await request(app).get('/api/v1/staff/payments')).status).toBe(401);
    expect((await request(app).get('/api/v1/admin/payments').set(auth())).status).toBe(403);
    const history = await request(app).get('/api/v1/staff/payments').set(auth());
    expect(history.body.data.items[0]).toMatchObject({
      id: payment._id,
      orders: [{ code: expect.any(String), tableName: 'Bàn 01' }],
    });
    expect(history.body.data.items[0]).not.toHaveProperty('idempotencyKey');
  });

  it('reports refunds on their actual date including negative net cash flow', async () => {
    const visit = await join();
    const id = (await place(cookieOf(visit))).body.data.order._id;
    const payment = (await receive(id)).body.data.payment;
    const yesterday = new Date(Date.now() - 86400000);
    await PaymentModel.updateOne({ _id: payment._id }, { $set: { paidAt: yesterday } });
    const order = (await OrderModel.findById(id))!;
    expect(
      (
        await request(app).post(`/api/v1/staff/orders/${id}/refund`).set(auth()).send({
          amount: 35000,
          method: 'CASH',
          expectedVersion: order.version,
          reason: 'Khách hủy, đã hoàn tiền',
          refundConfirmed: true,
        })
      ).status,
    ).toBe(200);
    const start = new Date(Date.now() - 60000);
    const totals = await paymentAnalytics(start, new Date(Date.now() + 60000));
    expect(totals).toMatchObject({
      grossCollected: 0,
      totalRefunded: 35000,
      adjustmentAmount: 0,
      totalRevenue: -35000,
    });
    expect(totals.revenueByDay[0]!.revenue).toBe(-35000);
  });
});

describe('dynamic QR and pay-before-preparation', () => {
  it('reviews each served paid order before closing, keeps ordering open and carries reviews into the receipt', async () => {
    const first = await join();
    const cookie = cookieOf(first);
    const otherCookie = cookieOf(await join());
    const sessionId = first.body.data.tableSessionId;
    const id = (await place(cookie)).body.data.order._id;
    const review = (orderId: string, guestCookie: string, rating = 4) =>
      request(app)
        .post(`/api/v1/orders/${orderId}/review`)
        .set('Cookie', guestCookie)
        .send({ rating, comment: 'Ngon!' });
    expect((await review(id, cookie)).status).toBe(422);
    expect((await receive(id)).status).toBe(201);
    expect((await review(id, cookie)).status).toBe(422);
    await serve(id);
    expect((await review(id, otherCookie)).status).toBe(403);
    expect((await review(id, cookie)).status).toBe(201);
    expect((await review(id, cookie, 5)).status).toBe(409);
    expect((await TableSessionModel.findById(sessionId))!.status).toBe('OPEN');
    expect(await BillModel.countDocuments({ tableSessionId: sessionId })).toBe(0);
    const mine = await request(app).get('/api/v1/orders/mine').set('Cookie', cookie);
    expect(mine.body.data.orders[0].review).toMatchObject({ rating: 4, comment: 'Ngon!' });
    expect(Object.keys(mine.body.data.orders[0].review).sort()).toEqual([
      'comment',
      'createdAt',
      'rating',
    ]);
    const detail = await request(app).get(`/api/v1/orders/${id}`).set('Cookie', cookie);
    expect(detail.body.data.order.review).toEqual(mine.body.data.orders[0].review);
    expect(
      (await request(app).get('/api/v1/orders/mine').set('Cookie', otherCookie)).body.data.orders,
    ).toEqual([]);

    const more = await place(cookie);
    expect(more.status).toBe(201);
    const nextId = more.body.data.order._id;
    expect(more.body.data.order.review).toBeNull();
    expect((await receive(nextId)).status).toBe(201);
    await serve(nextId);
    expect((await review(nextId, cookie, 5)).status).toBe(201);
    expect(await ReviewModel.countDocuments({ tableSessionId: sessionId })).toBe(2);
    expect((await close(sessionId)).status).toBe(200);
    const receipt = await request(app).get('/api/v1/receipts/current').set('Cookie', cookie);
    expect(
      receipt.body.data.orders.map((order: { review: { rating: number } }) => order.review.rating),
    ).toEqual([4, 5]);
    expect(
      (
        await request(app)
          .post(`/api/v1/receipts/orders/${id}/review`)
          .set('Cookie', cookie)
          .send({ rating: 1 })
      ).status,
    ).toBe(409);
  });
  it('returns a conflict for simultaneous review submissions and records one review', async () => {
    const cookie = cookieOf(await join());
    const id = (await place(cookie)).body.data.order._id;
    await receive(id);
    await serve(id);
    const responses = await Promise.all(
      [4, 5].map((rating) =>
        request(app).post(`/api/v1/orders/${id}/review`).set('Cookie', cookie).send({ rating }),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await ReviewModel.countDocuments({ orderId: id })).toBe(1);
  });
  it('serves two devices, collects each order, keeps ordering open and finalizes one immutable bill on close', async () => {
    const display = await qr();
    expect(display.status).toBe(200);
    expect(display.headers['cache-control']).toBe('no-store');
    const ticket = new URL(display.body.data.url).pathname.split('/t/')[1]!;
    const [first, second] = await Promise.all([join(ticket), join(ticket)]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.data.tableSessionId).toBe(second.body.data.tableSessionId);
    expect(first.body.data.participantId).not.toBe(second.body.data.participantId);
    const cookie = cookieOf(first);
    const sessionId = first.body.data.tableSessionId;
    const placed = await place(cookie);
    expect(placed.status).toBe(201);
    expect(placed.body.data.order).toMatchObject({
      status: 'AWAITING_PAYMENT',
      paymentStatus: 'UNPAID',
    });
    const id = placed.body.data.order._id;
    expect((await request(app).get('/api/v1/staff/orders').set(auth())).body.data.items).toEqual(
      [],
    );
    expect(
      (await request(app).get('/api/v1/staff/awaiting-payments').set(auth())).body.data.items,
    ).toHaveLength(1);
    expect(
      (
        await request(app)
          .patch(`/api/v1/staff/orders/${id}/status`)
          .set(auth())
          .send({ status: 'CONFIRMED' })
      ).status,
    ).toBe(403);
    expect((await close(sessionId)).status).toBe(403);
    expect((await receive(id, randomToken(16), { amount: 35001 })).status).toBe(422);
    expect((await receive(id)).status).toBe(201);
    expect((await TableSessionModel.findById(sessionId))!.status).toBe('OPEN');
    expect(
      await GuestSessionModel.countDocuments({ tableSessionId: sessionId, revokedAt: null }),
    ).toBe(2);
    expect(
      (await request(app).get('/api/v1/staff/orders').set(auth())).body.data.items[0],
    ).toMatchObject({ _id: id, status: 'PENDING', paymentStatus: 'PAID' });
    expect((await close(sessionId)).status).toBe(403);
    const more = await place(cookieOf(second));
    expect(more.status).toBe(201);
    expect((await receive(more.body.data.order._id)).status).toBe(201);
    await serve(id);
    await serve(more.body.data.order._id);
    const preview = await request(app)
      .get(`/api/v1/staff/table-sessions/${sessionId}/bill`)
      .set(auth());
    expect(preview.body.data).toMatchObject({ total: 0, paidAmount: 70000 });
    expect((await close(sessionId)).status).toBe(200);
    const bill = (await BillModel.findOne({ tableSessionId: sessionId }))!;
    expect(bill.total).toBe(70000);
    expect(bill.paidAmount).toBe(70000);
    expect(bill.payments).toHaveLength(2);
    expect(
      await GuestSessionModel.countDocuments({ tableSessionId: sessionId, revokedAt: null }),
    ).toBe(0);
    expect(
      (await request(app).post('/api/v1/orders/quote').set('Cookie', cookie).send(payload)).status,
    ).toBe(401);
    const receipt = await request(app).get('/api/v1/receipts/current').set('Cookie', cookie);
    expect(receipt.body.data).toMatchObject({ source: 'BILL_SNAPSHOT', total: 35000 });
    expect(receipt.body.data.orders).toHaveLength(1);
    expect((await join(ticket)).status).toBe(403);
    expect((await join()).body.data.tableSessionId).not.toBe(sessionId);
  });
  it('rejects old static tokens, display keys, expired and modified QR without opening a session', async () => {
    const table = (await TableModel.findById(tableId))!;
    const expired = createAdmissionTicket(tableId, table.qrEpoch, Date.now() - 60_000).token;
    const current = createAdmissionTicket(tableId, table.qrEpoch).token;
    for (const token of [staticToken, displayToken, expired, `${current}x`])
      expect((await join(token)).status).toBe(403);
    expect(await TableSessionModel.countDocuments()).toBe(0);
    expect(await GuestSessionModel.countDocuments()).toBe(0);
    expect((await request(app).get('/api/v1/table-displays/qr')).status).toBe(422);
    expect((await request(app).post(`/api/v1/staff/tables/${tableId}/display`)).status).toBe(401);
  });
  it('rotates the dedicated display key and immediately invalidates its QR while retaining admitted guests', async () => {
    const oldDisplay = await qr();
    const ticket = new URL(oldDisplay.body.data.url).pathname.split('/t/')[1]!;
    const guest = await join(ticket);
    expect(guest.status).toBe(200);
    const replacement = await provision();
    expect((await qr()).status).toBe(403);
    expect((await join(ticket)).status).toBe(403);
    expect((await qr(replacement)).status).toBe(200);
    expect((await place(cookieOf(guest))).status).toBe(201);
    expect(await AuditLogModel.countDocuments({ action: 'table.displayProvisioned' })).toBe(2);
  });
  it('records exactly one payment and order event for concurrent retries and rejects a changed payload', async () => {
    const guest = await join();
    const order = (await place(cookieOf(guest))).body.data.order;
    const key = randomToken(16);
    const [first, second] = await Promise.all([receive(order._id, key), receive(order._id, key)]);
    expect([first.status, second.status].sort()).toEqual([200, 201]);
    expect(await PaymentModel.countDocuments()).toBe(1);
    expect(
      await OutboxEventModel.countDocuments({
        aggregateId: order._id,
        eventType: 'order.statusChanged',
      }),
    ).toBe(2);
    expect((await receive(order._id, key, { method: 'OTHER' })).status).toBe(409);
    expect((await receive(order._id)).status).toBe(409);
  });
  it('allows only one of two distinct payment attempts for the same order', async () => {
    const order = (await place(cookieOf(await join()))).body.data.order;
    const responses = await Promise.all([receive(order._id), receive(order._id)]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await PaymentModel.countDocuments()).toBe(1);
  });
  it('limits unpaid drafts, lets customers cancel an unpaid order and frees a slot', async () => {
    const cookie = cookieOf(await join());
    const orders = [];
    for (let i = 0; i < 3; i++) {
      const response = await place(cookie);
      expect(response.status).toBe(201);
      orders.push(response.body.data.order);
    }
    expect((await place(cookie)).status).toBe(403);
    expect(
      (await request(app).post(`/api/v1/orders/${orders[0]._id}/cancel`).set('Cookie', cookie))
        .status,
    ).toBe(200);
    expect((await place(cookie)).status).toBe(201);
  });
  it('requires explicit manual refund before cancellation and accounts for cash returned', async () => {
    const guest = await join();
    const cookie = cookieOf(guest);
    const id = (await place(cookie)).body.data.order._id;
    expect((await receive(id)).status).toBe(201);
    expect(
      (await request(app).post(`/api/v1/orders/${id}/cancel`).set('Cookie', cookie)).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .patch(`/api/v1/staff/orders/${id}/status`)
          .set(auth())
          .send({ status: 'CANCELLED' })
      ).status,
    ).toBe(403);
    const refund = {
      amount: 35000,
      expectedVersion: 1,
      method: 'CASH',
      reason: 'Khách gọi nhầm, đã hoàn tiền',
      refundConfirmed: true,
    };
    expect(
      (
        await request(app)
          .post(`/api/v1/staff/orders/${id}/refund`)
          .set(auth())
          .send({ ...refund, refundConfirmed: false })
      ).status,
    ).toBe(422);
    const refunded = await request(app)
      .post(`/api/v1/staff/orders/${id}/refund`)
      .set(auth())
      .send(refund);
    expect(refunded.status).toBe(200);
    expect(refunded.body.data.order).toMatchObject({
      status: 'CANCELLED',
      paymentStatus: 'REFUNDED',
    });
    expect(
      (await request(app).post(`/api/v1/staff/orders/${id}/refund`).set(auth()).send(refund))
        .status,
    ).toBe(200);
    expect(await AuditLogModel.countDocuments({ action: 'payment.refunded' })).toBe(1);
    const shift = await request(app).get('/api/v1/staff/cash-shifts/current').set(auth());
    expect(shift.body.data.shift.paymentsByMethod.CASH.total).toBe(35000);
    expect(shift.body.data.shift.refundsByMethod.CASH.total).toBe(35000);
    expect((await close(guest.body.data.tableSessionId)).status).toBe(200);
    const bill = (await BillModel.findOne())!;
    expect(bill.total).toBe(0);
    expect(bill.paidAmount).toBe(0);
  });
});
