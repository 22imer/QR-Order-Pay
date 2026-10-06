import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { buildApp } from '../../app.js';
import { UserModel } from '../../models/User.js';
import { TableModel } from '../../models/Table.js';
import { CategoryModel } from '../../models/Category.js';
import { ProductModel } from '../../models/Product.js';
import { ToppingModel } from '../../models/Topping.js';
import { hashPassword, randomToken, sha256 } from '../../utils/crypto.js';
import request from 'supertest';
import { createServer, type Server } from 'node:http';
import { io as connectSocket, type Socket } from 'socket.io-client';
import { createSocketServer } from '../../realtime/socket.js';
import { TableSessionModel } from '../../models/TableSession.js';
import { GuestSessionModel } from '../../models/GuestSession.js';
import { PaymentModel } from '../../models/Payment.js';
import { AIService } from '../../services/aiService.js';
import { ReviewModel } from '../../models/Review.js';
import { OrderModel } from '../../models/Order.js';
import { BillModel } from '../../models/Bill.js';
import { AuditLogModel } from '../../models/AuditLog.js';
import { config } from '../../config/index.js';
import { getInstanceMetricsSnapshot } from '../../infrastructure/metrics.js';
import { persistAnomalyAlert, runAnomalyDetection } from '../../services/anomalyService.js';
import { AnomalyAlertModel } from '../../models/AnomalyAlert.js';
import { startOutboxRelay, type OutboxRelay } from '../../services/outboxRelay.js';
import { OutboxEventModel } from '../../models/OutboxEvent.js';
import { CancelRequestModel } from '../../models/CancelRequest.js';
import { CashShiftModel } from '../../models/CashShift.js';
import { orderRepository } from '../../repositories/orderRepository.js';
import { paymentRepository } from '../../repositories/paymentRepository.js';

const INTERNAL_ORDER_FIELDS = ['idempotencyKey', 'requestHash', '__v'];

function expectNoInternalOrderFields(order: Record<string, unknown>): void {
  for (const field of INTERNAL_ORDER_FIELDS) expect(order).not.toHaveProperty(field);
}

let httpServer: Server;
let socketServer: ReturnType<typeof createSocketServer>;
let socketUrl = '';
const clients: Socket[] = [];
let outboxRelay: OutboxRelay;

let replSet: MongoMemoryReplSet;
let app: ReturnType<typeof buildApp>;
let staffAccess = '';
let tableId = '';
let tableToken = '';

async function seedBasic() {
  await Promise.all(
    Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})),
  );
  await Promise.all([
    UserModel.deleteMany({}),
    TableModel.deleteMany({}),
    CategoryModel.deleteMany({}),
    ProductModel.deleteMany({}),
    ToppingModel.deleteMany({}),
  ]);
  const passwordHash = await hashPassword('Password@123');
  await UserModel.create({
    name: 'Admin',
    email: 'admin@test.vn',
    passwordHash,
    role: 'ADMIN',
    isActive: true,
  });
  await UserModel.create({
    name: 'Staff',
    email: 'staff@test.vn',
    passwordHash,
    role: 'STAFF',
    isActive: true,
  });
  const cat = await CategoryModel.create({
    name: 'Cà phê',
    slug: 'cafe',
    sortOrder: 0,
    isActive: true,
  });
  const topping = await ToppingModel.create({
    name: 'Trân châu đen',
    price: 8000,
    isAvailable: true,
    isArchived: false,
  });
  await ProductModel.create({
    categoryId: cat._id,
    name: 'Espresso Mây',
    slug: 'espresso-may',
    description: '',
    image: 'https://example.com/x.jpg',
    basePrice: 35000,
    variants: [
      { name: 'S', price: 35000, isAvailable: true },
      { name: 'M', price: 45000, isAvailable: true },
    ],
    allowedOptions: {
      sizes: ['S', 'M'],
      sugarLevels: ['0%', '50%', '100%'],
      iceLevels: ['less-ice', 'normal-ice'],
      toppingIds: [topping._id.toString()],
    },
    toppingIds: [topping._id.toString()],
    tags: [],
    ingredientMetadata: { caffeine: true, dairy: false, flavorProfile: ['đắng'] },
    isAvailable: true,
    isArchived: false,
    sortOrder: 0,
  });
  tableToken = randomToken(24);
  const table = await TableModel.create({
    code: 'B01',
    name: 'Bàn 01',
    capacity: 4,
    publicTokenHash: sha256(tableToken),
    isActive: true,
  });
  tableId = table._id.toString();
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = replSet.getUri();
  await mongoose.connect(uri);
  app = buildApp();
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  httpServer = createServer(app);
  socketServer = createSocketServer(httpServer);
  outboxRelay = startOutboxRelay();
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address');
  socketUrl = `http://127.0.0.1:${address.port}`;
}, 120_000);

afterAll(async () => {
  await outboxRelay.stop();
  if (socketServer) await new Promise<void>((resolve) => socketServer.close(() => resolve()));
  await mongoose.disconnect();
  await replSet.stop();
});

afterEach(() => {
  for (const socket of clients.splice(0)) socket.disconnect();
});

beforeEach(async () => {
  await seedBasic();
  const loginRes = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'staff@test.vn', password: 'Password@123' });
  staffAccess = loginRes.body.data.accessToken;
});

describe('order flow integration', () => {
  it('searches the real menu with strict per-item budget and dairy constraints', async () => {
    const response = await request(app)
      .post('/api/v1/menu/search')
      .send({ query: 'ca phe khong sua duoi 40 nghin' });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      mode: 'fallback',
      intent: {
        requirements: {
          noCaffeine: false,
          noDairy: true,
          includedGroups: ['coffee'],
          excludedGroups: [],
          budget: { maxVnd: 40_000, inclusive: false, scope: 'item' },
        },
      },
    });
    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0]).toMatchObject({ name: 'Espresso Mây', unitPrice: 35_000 });

    const product = await ProductModel.findById(response.body.data.items[0].productId).lean();
    expect(product?.ingredientMetadata?.dairy).toBe(false);
    expect(
      response.body.data.items.every((item: { unitPrice: number }) => item.unitPrice < 40_000),
    ).toBe(true);
    expect((await request(app).post('/api/v1/menu/search').send({ query: '' })).status).toBe(422);
  });

  it('exposes anomaly evidence to admins and audits acknowledgement', async () => {
    const detectionNow = new Date();
    const product = (await ProductModel.findOne())!;
    const syntheticOrders = [];
    const order = (
      index: number,
      createdAt: Date,
      status: 'READY' | 'CANCELLED',
      statusHistory: Array<{ from: string | null; to: string; at: Date }>,
    ) => ({
      code: `SYN-${index}`,
      tableSessionId: new mongoose.Types.ObjectId(),
      participantId: `synthetic-${index}`,
      tableId,
      items: [
        {
          productId: product._id,
          variantId: product.variants[0]!._id,
          sizeName: 'S',
          sugarLevel: '0%',
          iceLevel: 'normal-ice',
          toppingIds: [],
          toppingNamesSnapshot: [],
          note: '',
          quantity: 1,
          unitPrice: 35_000,
          lineTotal: 35_000,
          nameSnapshot: product.name,
          variantNameSnapshot: 'S',
        },
      ],
      total: 35_000,
      status,
      paymentStatus: 'UNPAID',
      statusHistory,
      idempotencyKey: `synthetic-${index}`,
      requestHash: `hash-${index}`,
      version: 0,
      createdAt,
      updatedAt: createdAt,
    });
    for (let index = 0; index < 20; index += 1) {
      const baselineCreated = new Date(detectionNow.getTime() - 40 * 60_000 + index);
      const currentCreated = new Date(detectionNow.getTime() - 10 * 60_000 + index);
      syntheticOrders.push(
        order(
          index,
          baselineCreated,
          index === 0 ? 'CANCELLED' : 'READY',
          index === 0
            ? [
                {
                  from: 'PENDING',
                  to: 'CANCELLED',
                  at: new Date(detectionNow.getTime() - 30 * 60_000),
                },
              ]
            : [],
        ),
      );
      syntheticOrders.push(
        order(
          100 + index,
          currentCreated,
          index < 8 ? 'CANCELLED' : 'READY',
          index < 8
            ? [
                {
                  from: 'PENDING',
                  to: 'CANCELLED',
                  at: new Date(detectionNow.getTime() - 5 * 60_000),
                },
              ]
            : [],
        ),
      );
      const baselineReady = new Date(detectionNow.getTime() - 30 * 60_000 + index);
      syntheticOrders.push(
        order(200 + index, new Date(detectionNow.getTime() - 80 * 60_000), 'READY', [
          { from: 'CONFIRMED', to: 'PREPARING', at: new Date(baselineReady.getTime() - 300_000) },
          { from: 'PREPARING', to: 'READY', at: baselineReady },
        ]),
      );
      const currentReady = new Date(detectionNow.getTime() - 60_000 + index);
      syntheticOrders.push(
        order(300 + index, new Date(detectionNow.getTime() - 20 * 60_000), 'READY', [
          { from: 'CONFIRMED', to: 'PREPARING', at: new Date(currentReady.getTime() - 1_140_000) },
          { from: 'PREPARING', to: 'READY', at: currentReady },
        ]),
      );
    }
    await OrderModel.insertMany(syntheticOrders);
    const evaluated = await runAnomalyDetection(detectionNow);
    expect(evaluated.filter((item) => item.state === 'ALERT').map((item) => item.detector)).toEqual(
      ['PREPARATION_P95', 'CANCELLATION_RATE'],
    );
    const adminLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@test.vn', password: 'Password@123' });
    const adminAccess = adminLogin.body.data.accessToken as string;
    const dashboard = await request(app)
      .get('/api/v1/admin/anomalies')
      .set('Authorization', `Bearer ${adminAccess}`);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.data.evaluations).toHaveLength(4);
    expect(dashboard.body.data.alerts).toHaveLength(2);
    expect(
      (
        await request(app)
          .get('/api/v1/admin/anomalies')
          .set('Authorization', `Bearer ${staffAccess}`)
      ).status,
    ).toBe(403);

    const now = new Date();
    const evaluation = {
      detector: 'HTTP_ERROR_RATE' as const,
      target: 'all',
      state: 'ALERT' as const,
      severity: 'WARNING' as const,
      windowStart: new Date(now.getTime() - 900_000).toISOString(),
      windowEnd: now.toISOString(),
      observedValue: 0.3,
      thresholdValue: 0.1,
      baselineValue: 0.01,
      sampleCount: 40,
      baselineSampleCount: 40,
      method: 'integration synthetic evidence',
      evidence: { errors: 12, requests: 40 },
    };
    expect(await persistAnomalyAlert(evaluation, now, false)).toBe(true);
    expect(
      await persistAnomalyAlert(
        { ...evaluation, windowEnd: new Date(now.getTime() + 60_000).toISOString() },
        new Date(now.getTime() + 60_000),
        false,
      ),
    ).toBe(false);
    expect(
      await AnomalyAlertModel.countDocuments({ detector: 'HTTP_ERROR_RATE', target: 'all' }),
    ).toBe(1);
    const alert = (await AnomalyAlertModel.findOne({
      detector: 'HTTP_ERROR_RATE',
      target: 'all',
    }))!;
    const acknowledged = await request(app)
      .patch(`/api/v1/admin/anomalies/${alert.id}/status`)
      .set('Authorization', `Bearer ${adminAccess}`)
      .send({ status: 'ACKNOWLEDGED' });
    expect(acknowledged.status).toBe(200);
    expect(acknowledged.body.data.alert.status).toBe('ACKNOWLEDGED');
    expect(
      await AuditLogModel.exists({ action: 'anomaly.acknowledged', entityId: alert.id }),
    ).toBeTruthy();
    const closed = await request(app)
      .patch(`/api/v1/admin/anomalies/${alert.id}/status`)
      .set('Authorization', `Bearer ${adminAccess}`)
      .send({ status: 'CLOSED' });
    expect(closed.status).toBe(200);
    expect(
      await AuditLogModel.exists({ action: 'anomaly.closed', entityId: alert.id }),
    ).toBeTruthy();
    expect(
      (
        await request(app)
          .patch(`/api/v1/admin/anomalies/${alert.id}/status`)
          .set('Authorization', `Bearer ${adminAccess}`)
          .send({ status: 'ACKNOWLEDGED' })
      ).status,
    ).toBe(404);
  });

  it('lists review statistics for admins only and applies rating/date filters', async () => {
    await ReviewModel.create([
      {
        orderId: new mongoose.Types.ObjectId(),
        tableSessionId: new mongoose.Types.ObjectId(),
        participantId: 'guest-1',
        rating: 5,
        comment: 'Rất ngon',
      },
      {
        orderId: new mongoose.Types.ObjectId(),
        tableSessionId: new mongoose.Types.ObjectId(),
        participantId: 'guest-2',
        rating: 3,
        comment: 'Ổn',
      },
    ]);
    const adminLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@test.vn', password: 'Password@123' });
    const adminAccess = adminLogin.body.data.accessToken as string;
    const all = await request(app)
      .get('/api/v1/admin/reviews')
      .set('Authorization', `Bearer ${adminAccess}`);
    expect(all.status).toBe(200);
    expect(all.body.data).toMatchObject({ total: 2, averageRating: 4 });
    expect(
      all.body.data.distribution.find((item: { rating: number }) => item.rating === 5).count,
    ).toBe(1);
    const filtered = await request(app)
      .get('/api/v1/admin/reviews?rating=5')
      .set('Authorization', `Bearer ${adminAccess}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.data).toMatchObject({ total: 1, averageRating: 5 });
    expect(
      (
        await request(app)
          .get('/api/v1/admin/reviews')
          .set('Authorization', `Bearer ${staffAccess}`)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .get('/api/v1/admin/reviews?rating=9')
          .set('Authorization', `Bearer ${adminAccess}`)
      ).status,
    ).toBe(422);
  });

  it('aggregates dashboard data beyond the repository page limit and filters by date', async () => {
    const product = (await ProductModel.findOne())!;
    const createdAt = new Date();
    await OrderModel.insertMany(
      Array.from({ length: 105 }, (_, index) => ({
        code: `REPORT-${index}`,
        tableSessionId: new mongoose.Types.ObjectId(),
        participantId: `report-guest-${index}`,
        tableId,
        items: [
          {
            productId: product._id,
            variantId: product.variants[0]!._id,
            sizeName: 'S',
            sugarLevel: '0%',
            iceLevel: 'normal-ice',
            toppingIds: [],
            toppingNamesSnapshot: [],
            note: '',
            quantity: 1,
            unitPrice: 35_000,
            lineTotal: 35_000,
            nameSnapshot: product.name,
            variantNameSnapshot: 'S',
          },
        ],
        total: 35_000,
        status: 'SERVED',
        paymentStatus: 'PAID',
        statusHistory: [],
        idempotencyKey: `report-${index}`,
        requestHash: `report-hash-${index}`,
        version: 0,
        createdAt,
        updatedAt: createdAt,
      })),
    );

    const adminLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@test.vn', password: 'Password@123' });
    const adminAccess = adminLogin.body.data.accessToken as string;
    const dateParts = new Intl.DateTimeFormat('en', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(createdAt)
      .reduce<Record<string, string>>((parts, part) => ({ ...parts, [part.type]: part.value }), {});
    const date = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
    const response = await request(app)
      .get(`/api/v1/admin/reports/overview?from=${date}&to=${date}`)
      .set('Authorization', `Bearer ${adminAccess}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      totalRevenue: 105 * 35_000,
      orderCount: 105,
      averageOrderValue: 35_000,
    });
    expect(response.body.data.topProducts[0]).toMatchObject({
      name: 'Espresso Mây',
      quantity: 105,
      revenue: 105 * 35_000,
    });
    expect(response.body.data.revenueByDay).toEqual([{ date, revenue: 105 * 35_000, orders: 105 }]);
  });

  function cookies(res: { headers: Record<string, unknown> }): string {
    return (res.headers['set-cookie'] as string[]).map((c) => c.split(';')[0]).join('; ');
  }
  async function startVisit() {
    const opened = await request(app)
      .post(`/api/v1/staff/tables/${tableId}/sessions`)
      .set('Authorization', `Bearer ${staffAccess}`);
    expect(opened.status).toBe(200);
    const joined = await request(app).post('/api/v1/table-sessions/join').send({ tableToken });
    expect(joined.status).toBe(200);
    const product = (await ProductModel.findOne())!;
    const payload = {
      items: [
        {
          productId: product.id,
          variantId: product.variants[0]!._id!.toString(),
          sugarLevel: '50%',
          iceLevel: 'normal-ice',
          toppingIds: [],
          quantity: 1,
        },
      ],
    };
    return {
      cookie: cookies(joined),
      sessionId: opened.body.data.session._id as string,
      payload,
      participantId: joined.body.data.participantId as string,
    };
  }
  async function place(cookie: string, payload: object, key = randomToken(16)) {
    const quotedPayload = await withQuote(cookie, payload);
    const res = await request(app)
      .post('/api/v1/orders')
      .set('Cookie', cookie)
      .set('Idempotency-Key', key)
      .send(quotedPayload);
    expect(res.status).toBe(201);
    return res.body.data.order as { _id: string; total: number };
  }
  async function withQuote(cookie: string, payload: object) {
    const quoted = await request(app)
      .post('/api/v1/orders/quote')
      .set('Cookie', cookie)
      .send(payload);
    expect(quoted.status).toBe(200);
    return { ...payload, quoteToken: quoted.body.data.quoteToken };
  }
  async function serve(id: string) {
    for (const status of ['CONFIRMED', 'PREPARING', 'READY', 'SERVED']) {
      const res = await request(app)
        .patch(`/api/v1/staff/orders/${id}/status`)
        .set('Authorization', `Bearer ${staffAccess}`)
        .send({ status });
      expect(res.status).toBe(200);
    }
  }
  async function checkout(sessionId: string) {
    const session = (await TableSessionModel.findById(sessionId))!;
    const res = await request(app)
      .patch(`/api/v1/staff/table-sessions/${sessionId}/status`)
      .set('Authorization', `Bearer ${staffAccess}`)
      .send({ status: 'CHECKOUT', expectedVersion: session.version });
    expect(res.status).toBe(200);
    return res.body.data.session.version as number;
  }
  function pay(sessionId: string, amount: number, version: number, key: string) {
    return request(app)
      .post(`/api/v1/staff/table-sessions/${sessionId}/payments`)
      .set('Authorization', `Bearer ${staffAccess}`)
      .set('Idempotency-Key', key)
      .send({ amount, expectedVersion: version, method: 'CASH' });
  }
  function event<T = unknown>(socket: Socket, name: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.off(name, handler);
        reject(new Error(`Timeout: ${name}`));
      }, 5000);
      const handler = (payload: T | { data: T }) => {
        clearTimeout(timeout);
        if (payload && typeof payload === 'object' && 'eventId' in payload && 'data' in payload)
          resolve((payload as { data: T }).data);
        else resolve(payload as T);
      };
      socket.once(name, handler);
    });
  }
  async function guestSocket(cookie: string): Promise<Socket> {
    const socket = connectSocket(socketUrl, {
      autoConnect: false,
      transports: ['websocket'],
      extraHeaders: { Cookie: cookie },
      auth: { role: 'GUEST' },
      reconnection: false,
    });
    clients.push(socket);
    const connected = event(socket, 'connect');
    socket.connect();
    await connected;
    return socket;
  }

  it('completes two-guest payment, receipt and review flow without reopening ordering rights', async () => {
    const { cookie, sessionId, payload, participantId } = await startVisit();
    const tables = await request(app)
      .get('/api/v1/staff/tables')
      .set('Authorization', `Bearer ${staffAccess}`);
    expect(tables.status).toBe(200);
    expect(tables.body.data.tables[0]).not.toHaveProperty('publicTokenHash');
    expect(
      (await request(app).get('/api/v1/admin/tables').set('Authorization', `Bearer ${staffAccess}`))
        .status,
    ).toBe(403);
    const current = await request(app).get('/api/v1/table-sessions/current').set('Cookie', cookie);
    expect(current.body.data.table.name).toBe('Bàn 01');
    const rejoin = await request(app)
      .post('/api/v1/table-sessions/join')
      .set('Cookie', cookie)
      .send({ tableToken });
    expect(rejoin.body.data.participantId).toBe(participantId);
    const second = await request(app).post('/api/v1/table-sessions/join').send({ tableToken });
    const secondCookie = cookies(second);
    const firstOrder = await place(cookie, payload);
    const secondOrder = await place(secondCookie, payload);
    expect((await request(app).get('/api/v1/receipts/current').set('Cookie', cookie)).status).toBe(
      401,
    );
    await serve(firstOrder._id);
    await serve(secondOrder._id);
    expect(
      (
        await request(app)
          .post(`/api/v1/orders/${firstOrder._id}/review`)
          .set('Cookie', cookie)
          .send({ rating: 5 })
      ).status,
    ).toBe(422);
    await request(app)
      .post('/api/v1/service-requests')
      .set('Cookie', cookie)
      .send({ type: 'REQUEST_BILL' });
    const version = await checkout(sessionId);
    const amount = firstOrder.total + secondOrder.total;
    expect((await pay(sessionId, 0, version, 'payment-wrong-amount')).status).toBe(422);
    const paid = await pay(sessionId, amount, version, 'payment-complete');
    expect(paid.status).toBe(201);
    const replay = await pay(sessionId, amount, version, 'payment-complete');
    expect(replay.status).toBe(200);
    expect(replay.body.data.payment._id).toBe(paid.body.data.payment._id);
    expect((await pay(sessionId, amount + 1, version, 'payment-complete')).status).toBe(409);
    expect(await PaymentModel.countDocuments({ tableSessionId: sessionId })).toBe(1);
    expect(
      await GuestSessionModel.countDocuments({ tableSessionId: sessionId, revokedAt: null }),
    ).toBe(0);
    expect(
      (
        await request(app)
          .post('/api/v1/orders')
          .set('Cookie', cookie)
          .set('Idempotency-Key', 'old-guest-order')
          .send(payload)
      ).status,
    ).toBe(401);
    const receipt = await request(app).get('/api/v1/receipts/current').set('Cookie', cookie);
    expect(receipt.status).toBe(200);
    expect(receipt.body.data.orders.map((o: { _id: string }) => o._id)).toEqual([firstOrder._id]);
    expect(receipt.body.data.total).toBe(firstOrder.total);
    expect(
      (
        await request(app)
          .post(`/api/v1/receipts/orders/${secondOrder._id}/review`)
          .set('Cookie', cookie)
          .send({ rating: 5 })
      ).status,
    ).toBe(403);
    const review = await request(app)
      .post(`/api/v1/receipts/orders/${firstOrder._id}/review`)
      .set('Cookie', cookie)
      .send({ rating: 5, comment: 'Ngon!' });
    expect(review.status).toBe(201);
    expect(
      (
        await request(app)
          .post(`/api/v1/receipts/orders/${firstOrder._id}/review`)
          .set('Cookie', cookie)
          .send({ rating: 4 })
      ).status,
    ).toBe(409);
    expect(
      (await request(app).get('/api/v1/receipts/current').set('Cookie', cookie)).body.data.orders[0]
        .review.rating,
    ).toBe(5);
    expect(
      (await request(app).get('/api/v1/table-sessions/current').set('Cookie', cookie)).body.data,
    ).toMatchObject({ active: false, receiptAvailable: true });
    const requests = await request(app)
      .get('/api/v1/staff/service-requests')
      .set('Authorization', `Bearer ${staffAccess}`);
    expect(requests.body.data.items).toHaveLength(0);
    await GuestSessionModel.updateMany({ tableSessionId: sessionId }, { expiresAt: new Date(0) });
    expect((await request(app).get('/api/v1/receipts/current').set('Cookie', cookie)).status).toBe(
      401,
    );
  });

  it('prevents closing unpaid sessions, paying unfinished orders and ordering during checkout', async () => {
    const { cookie, sessionId, payload } = await startVisit();
    const order = await place(cookie, payload);
    const current = (await TableSessionModel.findById(sessionId))!;
    const close = await request(app)
      .patch(`/api/v1/staff/table-sessions/${sessionId}/status`)
      .set('Authorization', `Bearer ${staffAccess}`)
      .send({ status: 'CLOSED', expectedVersion: current.version });
    expect(close.status).toBe(403);
    expect((await TableSessionModel.findById(sessionId))!.status).toBe('OPEN');
    expect((await pay(sessionId, order.total, current.version, 'pay-before-checkout')).status).toBe(
      403,
    );
    const version = await checkout(sessionId);
    expect((await pay(sessionId, order.total, version, 'pay-unfinished')).status).toBe(422);
    expect(
      (
        await request(app)
          .post('/api/v1/orders')
          .set('Cookie', cookie)
          .set('Idempotency-Key', 'checkout-order')
          .send(payload)
      ).status,
    ).toBe(403);
  });

  it('closes an empty table, invalidates receipt access on leave and opens a fresh visit', async () => {
    const { cookie, sessionId } = await startVisit();
    await request(app)
      .post('/api/v1/service-requests')
      .set('Cookie', cookie)
      .send({ type: 'CALL_STAFF' });
    const closed = await request(app)
      .patch(`/api/v1/staff/table-sessions/${sessionId}/status`)
      .set('Authorization', `Bearer ${staffAccess}`)
      .send({ status: 'CLOSED', expectedVersion: 0 });
    expect(closed.status).toBe(200);
    expect((await request(app).get('/api/v1/receipts/current').set('Cookie', cookie)).status).toBe(
      200,
    );
    expect(
      (await request(app).post('/api/v1/table-sessions/leave').set('Cookie', cookie)).status,
    ).toBe(200);
    expect((await request(app).get('/api/v1/receipts/current').set('Cookie', cookie)).status).toBe(
      401,
    );
    const next = await startVisit();
    expect(next.sessionId).not.toBe(sessionId);
    expect(
      (await request(app).get('/api/v1/table-sessions/current').set('Cookie', cookie)).body.data
        .active,
    ).toBe(false);
  });

  it('authenticates realtime with HttpOnly cookies and publishes through the full order lifecycle', async () => {
    const { cookie, sessionId, payload, participantId } = await startVisit();
    const guest = await guestSocket(cookie);
    const serverGuest = socketServer.sockets.sockets.get(guest.id!)!;
    expect(serverGuest.rooms.has(`guest:${sessionId}:${participantId}`)).toBe(true);
    expect(serverGuest.rooms.has('staff')).toBe(false);
    const staff = connectSocket(socketUrl, {
      autoConnect: false,
      transports: ['websocket'],
      auth: { role: 'STAFF', accessToken: staffAccess },
      reconnection: false,
    });
    clients.push(staff);
    const connected = event(staff, 'connect');
    staff.connect();
    await connected;
    const created = event<{ orderId: string }>(staff, 'order.created');
    const order = await place(cookie, payload);
    expect((await created).orderId).toBe(order._id);
    const changed = event<{ status: string }>(guest, 'order.statusChanged');
    await serve(order._id);
    expect((await changed).status).toBe('CONFIRMED');
    const requested = event(staff, 'serviceRequest.created');
    await request(app)
      .post('/api/v1/service-requests')
      .set('Cookie', cookie)
      .send({ type: 'CALL_STAFF' });
    await requested;
    const version = await checkout(sessionId);
    const payment = event(guest, 'payment.confirmed');
    const disconnected = event(guest, 'disconnect');
    expect((await pay(sessionId, order.total, version, 'socket-payment')).status).toBe(201);
    await payment;
    await disconnected;
    const denied = event<Error>(guest, 'connect_error');
    guest.connect();
    expect((await denied).message).toBe('UNAUTHENTICATED');
  });

  it('rejects unavailable variants, unapproved toppings and AI recommendations outside constraints', async () => {
    const { cookie, payload } = await startVisit();
    const unrelated = await ToppingModel.create({
      name: 'Unapproved',
      price: 1000,
      isAvailable: true,
    });
    payload.items[0]!.toppingIds = [unrelated.id] as never[];
    expect(
      (
        await request(app)
          .post('/api/v1/orders')
          .set('Cookie', cookie)
          .set('Idempotency-Key', 'invalid-topping')
          .send(payload)
      ).status,
    ).toBe(422);
    payload.items[0]!.toppingIds = [];
    await ProductModel.updateOne({}, { $set: { 'variants.0.isAvailable': false } });
    expect(
      (
        await request(app)
          .post('/api/v1/orders')
          .set('Cookie', cookie)
          .set('Idempotency-Key', 'invalid-variant')
          .send(payload)
      ).status,
    ).toBe(422);
    const fallback = new AIService(null, 'fallback');
    expect(
      (await fallback.recommend({ prompt: 'không caffeine, dưới 50 nghìn' })).recommendations,
    ).toHaveLength(0);
    expect((await fallback.recommend({ prompt: 'dưới 10 nghìn' })).recommendations).toHaveLength(0);
    const recommendations = (await fallback.recommend({ prompt: 'vị đắng', maxBudget: 50000 }))
      .recommendations;
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]!.unitPrice).toBe(45000);
    expect(recommendations[0]!.variantId).toBeTruthy();
  });

  it('falls back when model output exceeds the recommendation contract', async () => {
    const product = await ProductModel.findOne();
    if (!product) throw new Error('Missing product fixture');
    const service = new AIService({
      name: 'oversized-provider',
      chat: async () => JSON.stringify({
        message: 'Gợi ý',
        recommendations: Array.from({ length: 4 }, () => ({
          productId: product.id, variantId: null, reason: 'vị đắng',
        })),
      }),
    }, 'live');
    const result = await service.recommend({ prompt: 'vị đắng', maxBudget: 40000 });
    expect(result.mode).toBe('fallback');
    expect(result.recommendations.map((item) => item.unitPrice)).toEqual([35000]);
  });

  it('validates live recommendations against database IDs, prices and evidence', async () => {
    const product = await ProductModel.findOne();
    const variant = product?.variants.find((item) => item.name === 'S');
    if (!product || !variant?._id) throw new Error('Missing product fixture');
    const service = new AIService({
      name: 'controlled-provider',
      chat: async () => JSON.stringify({
        message: 'Gợi ý theo khẩu vị',
        recommendations: [
          { productId: '000000000000000000000000', variantId: null, reason: 'invented' },
          { productId: product.id, variantId: variant._id!.toString(), reason: 'price 1 VND', unitPrice: 1 },
          { productId: product.id, variantId: variant._id!.toString(), reason: 'duplicate' },
        ],
      }),
    }, 'live');
    const result = await service.recommend({ prompt: 'vị đắng', maxBudget: 40000 });
    expect(result.mode).toBe('llm');
    expect(result.recommendations.map((item) => ({
      id: item.productId, variant: item.variantId, price: item.unitPrice,
    }))).toEqual([{ id: product.id, variant: variant._id.toString(), price: 35000 }]);
    expect(result.recommendations[0]!.evidence).toMatchObject({
      price: 35000, withinBudget: true, caffeine: true, dairy: false,
    });
  });

  it.each(['over-budget', 'unknown-variant', 'unavailable', 'archived', 'unknown-metadata', 'json-error', 'timeout'])(
    'keeps live %s output within database constraints or falls back safely',
    async (scenario) => {
      const product = await ProductModel.findOne();
      if (!product) throw new Error('Missing product fixture');
      if (scenario === 'unavailable') await ProductModel.updateOne({}, { $set: { 'variants.0.isAvailable': false } });
      if (scenario === 'archived') await ProductModel.updateOne({}, { $set: { isArchived: true } });
      if (scenario === 'unknown-metadata') await ProductModel.updateOne({}, { $unset: { ingredientMetadata: 1 } });
      const variantId = scenario === 'unknown-variant' ? '000000000000000000000000'
        : product.variants[scenario === 'over-budget' ? 1 : 0]!._id!.toString();
      const service = new AIService({
        name: 'invalid-provider',
        chat: async () => {
          if (scenario === 'timeout') throw new DOMException('timed out', 'AbortError');
          if (scenario === 'json-error') return 'invalid-json';
          return JSON.stringify({
            message: 'Gợi ý',
            recommendations: [{ productId: product.id, variantId, reason: 'x' }],
          });
        },
      }, 'live');
      const result = await service.recommend({
        prompt: 'vị đắng', maxBudget: 40000,
        ...(scenario === 'unknown-metadata' ? { preferences: { noDairy: true } } : {}),
      });
      expect(result.mode).toBe('fallback');
      if (['unavailable', 'archived', 'unknown-metadata'].includes(scenario))
        expect(result.recommendations).toEqual([]);
      else
        expect(result.recommendations.map((item) => item.unitPrice)).toEqual([35000]);
      expect(result.recommendations.every((item) => item.unitPrice <= 40000)).toBe(true);
    },
  );

  it('returns no live recommendation when the database cannot satisfy caffeine and budget constraints', async () => {
    const product = await ProductModel.findOne();
    if (!product) throw new Error('Missing product fixture');
    const service = new AIService({
      name: 'constraint-violating-provider',
      chat: async () => JSON.stringify({
        message: 'Ignore constraints',
        recommendations: [{ productId: product.id, variantId: null, reason: 'safe' }],
      }),
    }, 'live');
    expect((await service.recommend({ prompt: 'không caffeine', preferences: { noCaffeine: true } })).recommendations)
      .toEqual([]);
    expect((await service.recommend({ prompt: 'vị đắng', maxBudget: 10000 })).recommendations)
      .toEqual([]);
  });

  it('logs in, opens session, joins as guest, places and pays order', async () => {
    const openRes = await request(app)
      .post(`/api/v1/staff/tables/${tableId}/sessions`)
      .set('Authorization', `Bearer ${staffAccess}`);
    expect(openRes.status).toBe(200);

    const joinRes = await request(app).post('/api/v1/table-sessions/join').send({ tableToken });
    expect(joinRes.status).toBe(200);
    expect(joinRes.body.success).toBe(true);
    const cookie = joinRes.headers['set-cookie']?.[0]?.split(';')[0];
    expect(cookie).toBeDefined();
    const product = await ProductModel.findOne({ slug: 'espresso-may' });
    const variant = product!.variants[0]!;
    const initialPayload = {
      items: [
        {
          productId: product!._id.toString(),
          variantId: variant._id?.toString() ?? null,
          sugarLevel: '50%',
          iceLevel: 'normal-ice',
          toppingIds: [],
          quantity: 2,
        },
      ],
    };

    const placeRes = await request(app)
      .post('/api/v1/orders')
      .set('Cookie', cookie!)
      .set('Idempotency-Key', 'idem-key-1')
      .send(await withQuote(cookie!, initialPayload));
    expect(placeRes.status).toBe(201);
    expect(placeRes.body.data.order.total).toBe(variant.price * 2);

    const orderId = placeRes.body.data.order._id as string;

    // idempotency
    const replay = await request(app)
      .post('/api/v1/orders')
      .set('Cookie', cookie!)
      .set('Idempotency-Key', 'idem-key-1')
      .send(initialPayload);
    expect(replay.status).toBe(200);
    expect(replay.body.data.created).toBe(false);

    // guest cannot cancel other guest's order
    const otherGuest = await request(app).post('/api/v1/table-sessions/join').send({ tableToken });
    const otherCookie = otherGuest.headers['set-cookie']?.[0]?.split(';')[0] ?? '';
    const otherCancel = await request(app)
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set('Cookie', otherCookie);
    expect(otherCancel.status).toBe(403);

    const confirmRes = await request(app)
      .patch(`/api/v1/staff/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${staffAccess}`)
      .send({ status: 'CONFIRMED' });
    expect(confirmRes.status).toBe(200);

    for (const status of ['PREPARING', 'READY', 'SERVED']) {
      const r = await request(app)
        .patch(`/api/v1/staff/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${staffAccess}`)
        .send({ status });
      expect(r.status).toBe(200);
    }

    const billRes = await request(app)
      .get(`/api/v1/staff/table-sessions/${confirmRes.body.data.order.tableSessionId}/bill`)
      .set('Authorization', `Bearer ${staffAccess}`);
    expect(billRes.status).toBe(200);
    expect(billRes.body.data.total).toBe(variant.price * 2);

    const expected = variant.price * 2;
    const sessionId = billRes.body.data.tableSessionId;
    // get current version
    const sessionsList = await request(app)
      .get('/api/v1/staff/table-sessions')
      .set('Authorization', `Bearer ${staffAccess}`);
    const current = sessionsList.body.data.items.find(
      (it: { session: { _id: string } }) => it.session._id === sessionId,
    );
    const version = current.session.version;
    const transitionRes = await request(app)
      .patch(`/api/v1/staff/table-sessions/${sessionId}/status`)
      .set('Authorization', `Bearer ${staffAccess}`)
      .send({ status: 'CHECKOUT', expectedVersion: version });
    const nextVersion =
      transitionRes.status === 200 ? transitionRes.body.data.session.version : version + 1;
    const payRes = await request(app)
      .post(`/api/v1/staff/table-sessions/${sessionId}/payments`)
      .set('Authorization', `Bearer ${staffAccess}`)
      .set('Idempotency-Key', 'pay-key-1')
      .send({ amount: expected, method: 'CASH', expectedVersion: nextVersion });
    expect(payRes.status).toBe(201);
    expect(payRes.body.data.payment.amount).toBe(expected);
    expect(payRes.body.data.payment.shiftId).toBeTruthy();
    const shift = await request(app)
      .get('/api/v1/staff/cash-shifts/current')
      .set('Authorization', `Bearer ${staffAccess}`);
    expect(shift.body.data.shift.paymentsByMethod.CASH).toMatchObject({
      total: expected,
      count: 1,
    });
    const adminLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@test.vn', password: 'Password@123' });
    const bills = await request(app)
      .get('/api/v1/admin/bills')
      .set('Authorization', `Bearer ${adminLogin.body.data.accessToken}`);
    expect(bills.status).toBe(200);
    expect(bills.body.data.items[0]).toMatchObject({ total: expected, cashierName: 'Staff' });
  }, 60_000);

  it('prevents two staff transitions from overwriting the same order version', async () => {
    const { cookie, payload } = await startVisit();
    const order = await place(cookie, payload);
    const responses = await Promise.all([
      request(app)
        .patch(`/api/v1/staff/orders/${order._id}/status`)
        .set('Authorization', `Bearer ${staffAccess}`)
        .send({ status: 'CONFIRMED' }),
      request(app)
        .patch(`/api/v1/staff/orders/${order._id}/status`)
        .set('Authorization', `Bearer ${staffAccess}`)
        .send({ status: 'CONFIRMED' }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const stored = await OrderModel.findById(order._id);
    expect(stored?.status).toBe('CONFIRMED');
    expect(stored?.version).toBe(1);
    expect(stored?.statusHistory.filter((entry) => entry.to === 'CONFIRMED')).toHaveLength(1);
  });

  it('server recomputes unitPrice from menu (ignores client price)', async () => {
    await request(app)
      .post(`/api/v1/staff/tables/${tableId}/sessions`)
      .set('Authorization', `Bearer ${staffAccess}`);
    const joinRes = await request(app).post('/api/v1/table-sessions/join').send({ tableToken });
    const cookie = joinRes.headers['set-cookie']?.[0]?.split(';')[0] ?? '';
    const product = await ProductModel.findOne({ slug: 'espresso-may' });
    const variant = product!.variants[0]!;
    const pricePayload = {
      items: [
        {
          productId: product!._id.toString(),
          variantId: variant._id?.toString() ?? null,
          sugarLevel: '100%',
          iceLevel: 'normal-ice',
          toppingIds: [],
          quantity: 1,
          unitPrice: 1,
          lineTotal: 1,
        },
      ],
    };
    const res = await request(app)
      .post('/api/v1/orders')
      .set('Cookie', cookie)
      .set('Idempotency-Key', 'idem-key-2')
      .send(await withQuote(cookie, pricePayload));
    expect(res.status).toBe(201);
    expect(res.body.data.order.total).toBe(variant.price);
  }, 60_000);

  it('rejects order with invalid variantId', async () => {
    await request(app)
      .post(`/api/v1/staff/tables/${tableId}/sessions`)
      .set('Authorization', `Bearer ${staffAccess}`);
    const joinRes = await request(app).post('/api/v1/table-sessions/join').send({ tableToken });
    const cookie = joinRes.headers['set-cookie']?.[0]?.split(';')[0] ?? '';
    const product = await ProductModel.findOne({ slug: 'espresso-may' });
    const res = await request(app)
      .post('/api/v1/orders')
      .set('Cookie', cookie)
      .set('Idempotency-Key', 'idem-key-3')
      .send({
        items: [
          {
            productId: product!._id.toString(),
            variantId: '6f0e0000000000000000abcd',
            sugarLevel: '100%',
            iceLevel: 'normal-ice',
            toppingIds: [],
            quantity: 1,
          },
        ],
      });
    expect(res.status).toBe(422);
  }, 60_000);

  it('returns idempotent result when same key is reused with same payload', async () => {
    await request(app)
      .post(`/api/v1/staff/tables/${tableId}/sessions`)
      .set('Authorization', `Bearer ${staffAccess}`);
    const joinRes = await request(app).post('/api/v1/table-sessions/join').send({ tableToken });
    const cookie = joinRes.headers['set-cookie']?.[0]?.split(';')[0] ?? '';
    const product = await ProductModel.findOne({ slug: 'espresso-may' });
    const variant = product!.variants[0]!;
    const payload = {
      items: [
        {
          productId: product!._id.toString(),
          variantId: variant._id?.toString() ?? null,
          sugarLevel: '50%',
          iceLevel: 'normal-ice',
          toppingIds: [],
          quantity: 1,
        },
      ],
    };
    const r1 = await request(app)
      .post('/api/v1/orders')
      .set('Cookie', cookie)
      .set('Idempotency-Key', 'idem-dup')
      .send(await withQuote(cookie, payload));
    const r2 = await request(app)
      .post('/api/v1/orders')
      .set('Cookie', cookie)
      .set('Idempotency-Key', 'idem-dup')
      .send(payload);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(200);
    expect(r1.body.data.order._id).toBe(r2.body.data.order._id);
    const orderId = r1.body.data.order._id as string;
    expect(await AuditLogModel.countDocuments({ action: 'order.placed', entityId: orderId })).toBe(
      1,
    );
    expect(
      await OutboxEventModel.countDocuments({
        aggregateType: 'Order',
        aggregateId: orderId,
        eventType: 'order.created',
      }),
    ).toBe(2);
  }, 60_000);

  it('replays an order when the same key races past the idempotency pre-check', async () => {
    const { cookie, payload } = await startVisit();
    const quoted = await withQuote(cookie, payload);
    const send = () =>
      request(app)
        .post('/api/v1/orders')
        .set('Cookie', cookie)
        .set('Idempotency-Key', 'race-key-0001')
        .send(quoted);
    const first = await send();
    expect(first.status).toBe(201);
    // Giả lập request thứ hai đi qua bước kiểm tra trước khi request đầu commit.
    const spy = vi.spyOn(orderRepository, 'findByIdempotency').mockResolvedValueOnce(null);
    try {
      const second = await send();
      expect(second.status).toBe(200);
      expect(second.body.data).toMatchObject({ created: false });
      expect(second.body.data.order._id).toBe(first.body.data.order._id);
    } finally {
      spy.mockRestore();
    }
    expect(await OrderModel.countDocuments({ idempotencyKey: 'race-key-0001' })).toBe(1);
  }, 60_000);

  it('replays a payment when the same key races past the idempotency pre-check', async () => {
    const { cookie, sessionId, payload } = await startVisit();
    const order = await place(cookie, payload);
    await serve(order._id);
    const version = await checkout(sessionId);
    const first = await pay(sessionId, order.total, version, 'pay-race-0001');
    expect(first.status).toBe(201);
    const spy = vi.spyOn(paymentRepository, 'findByIdempotency').mockResolvedValueOnce(null);
    try {
      const second = await pay(sessionId, order.total, version, 'pay-race-0001');
      expect(second.status).toBe(200);
      expect(second.body.data).toMatchObject({ replayed: true, billId: first.body.data.billId });
    } finally {
      spy.mockRestore();
    }
    expect(await PaymentModel.countDocuments({ tableSessionId: sessionId })).toBe(1);
    expect(await BillModel.countDocuments({ tableSessionId: sessionId })).toBe(1);
  }, 60_000);

  it('lists only unfinished orders of active visits in the staff feed', async () => {
    const closedVisit = await startVisit();
    const served = await place(closedVisit.cookie, closedVisit.payload);
    await serve(served._id);
    const version = await checkout(closedVisit.sessionId);
    expect((await pay(closedVisit.sessionId, served.total, version, randomToken(16))).status).toBe(
      201,
    );
    // Đơn chưa hoàn tất nằm trong phiên đã đóng (như dữ liệu seed cũ) không được lên KDS.
    const { _id: _servedId, ...servedCopy } = (await OrderModel.findById(served._id).lean())!;
    await OrderModel.create({
      ...servedCopy,
      code: 'STALE01',
      status: 'PENDING',
      paymentStatus: 'UNPAID',
      idempotencyKey: 'stale-order-key',
      requestHash: 'stale-order-hash',
    });

    const activeVisit = await startVisit();
    const pending = await place(activeVisit.cookie, activeVisit.payload);

    const feed = await request(app)
      .get('/api/v1/staff/orders')
      .set('Authorization', `Bearer ${staffAccess}`);
    expect(feed.status).toBe(200);
    expect(feed.body.data.items.map((item: { _id: string }) => item._id)).toEqual([pending._id]);
    expect(feed.body.data.items[0]).toMatchObject({ tableName: 'Bàn 01', status: 'PENDING' });
    expectNoInternalOrderFields(feed.body.data.items[0]);

    const servedFeed = await request(app)
      .get('/api/v1/staff/orders?status=SERVED')
      .set('Authorization', `Bearer ${staffAccess}`);
    expect(servedFeed.body.data.items).toEqual([]);
  }, 60_000);

  it('never exposes internal order fields to guests or staff', async () => {
    const { cookie, payload } = await startVisit();
    const placed = await request(app)
      .post('/api/v1/orders')
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomToken(16))
      .send(await withQuote(cookie, payload));
    expect(placed.status).toBe(201);
    expectNoInternalOrderFields(placed.body.data.order);
    const orderId = placed.body.data.order._id as string;
    const confirmed = await request(app)
      .patch(`/api/v1/staff/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${staffAccess}`)
      .send({ status: 'CONFIRMED' });
    expect(confirmed.status).toBe(200);
    expectNoInternalOrderFields(confirmed.body.data.order);

    const mine = await request(app).get('/api/v1/orders/mine').set('Cookie', cookie);
    const detail = await request(app).get(`/api/v1/orders/${orderId}`).set('Cookie', cookie);
    for (const order of [mine.body.data.orders[0], detail.body.data.order]) {
      expectNoInternalOrderFields(order);
      expect(order).toMatchObject({ _id: orderId, status: 'CONFIRMED' });
      for (const entry of order.statusHistory) expect(entry).not.toHaveProperty('by');
    }

    const second = await place(cookie, payload);
    const cancelled = await request(app)
      .post(`/api/v1/orders/${second._id}/cancel`)
      .set('Cookie', cookie);
    expect(cancelled.status).toBe(200);
    expectNoInternalOrderFields(cancelled.body.data.order);

    const staffDetail = await request(app)
      .get(`/api/v1/staff/orders/${orderId}`)
      .set('Authorization', `Bearer ${staffAccess}`);
    expectNoInternalOrderFields(staffDetail.body.data.order);
    expect(staffDetail.body.data.order).toMatchObject({ tableName: 'Bàn 01', tableCode: 'B01' });
    expect(staffDetail.body.data.order.statusHistory.at(-1).by).toEqual(expect.any(String));
  }, 60_000);

  it('rejects duplicate idempotency key with different payload', async () => {
    await request(app)
      .post(`/api/v1/staff/tables/${tableId}/sessions`)
      .set('Authorization', `Bearer ${staffAccess}`);
    const joinRes = await request(app).post('/api/v1/table-sessions/join').send({ tableToken });
    const cookie = joinRes.headers['set-cookie']?.[0]?.split(';')[0] ?? '';
    const product = await ProductModel.findOne({ slug: 'espresso-may' });
    const variant = product!.variants[0]!;
    const firstPayload = {
      items: [
        {
          productId: product!._id.toString(),
          variantId: variant._id?.toString() ?? null,
          sugarLevel: '50%',
          iceLevel: 'normal-ice',
          toppingIds: [],
          quantity: 1,
        },
      ],
    };
    await request(app)
      .post('/api/v1/orders')
      .set('Cookie', cookie)
      .set('Idempotency-Key', 'idem-conflict')
      .send(await withQuote(cookie, firstPayload));
    const conflict = await request(app)
      .post('/api/v1/orders')
      .set('Cookie', cookie)
      .set('Idempotency-Key', 'idem-conflict')
      .send({
        items: [
          {
            productId: product!._id.toString(),
            variantId: variant._id?.toString() ?? null,
            sugarLevel: '100%',
            iceLevel: 'normal-ice',
            toppingIds: [],
            quantity: 5,
          },
        ],
      });
    expect(conflict.status).toBe(409);
    const created = await OrderModel.findOne({ idempotencyKey: 'idem-conflict' });
    expect(created).not.toBeNull();
    expect(
      await AuditLogModel.countDocuments({ action: 'order.placed', entityId: created!.id }),
    ).toBe(1);
    expect(
      await OutboxEventModel.countDocuments({
        aggregateType: 'Order',
        aggregateId: created!.id,
        eventType: 'order.created',
      }),
    ).toBe(2);
  }, 60_000);

  it('rejects a stale signed quote after the catalog price changes', async () => {
    const { cookie, payload } = await startVisit();
    const quote = await request(app)
      .post('/api/v1/orders/quote')
      .set('Cookie', cookie)
      .send(payload);
    expect(quote.status).toBe(200);
    await ProductModel.updateOne({ slug: 'espresso-may' }, { $inc: { 'variants.0.price': 5_000 } });
    const placed = await request(app)
      .post('/api/v1/orders')
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomToken(16))
      .send({ ...payload, quoteToken: quote.body.data.quoteToken });
    expect(placed.status).toBe(409);
    expect(placed.body.error).toMatchObject({
      code: 'QUOTE_CHANGED',
      details: { reason: 'CATALOG_CHANGED' },
    });
    expect(await OrderModel.countDocuments()).toBe(0);
  });

  it('does not place an order when a quoted topping becomes unavailable', async () => {
    const { cookie, payload } = await startVisit();
    const topping = (await ToppingModel.findOne())!;
    const cart = {
      ...payload,
      items: [{ ...payload.items[0]!, toppingIds: [topping.id] }],
    };
    const quote = await request(app).post('/api/v1/orders/quote').set('Cookie', cookie).send(cart);
    expect(quote.status).toBe(200);
    await ToppingModel.updateOne({ _id: topping._id }, { $set: { isAvailable: false } });

    const response = await request(app)
      .post('/api/v1/orders')
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomToken(16))
      .send({ ...cart, quoteToken: quote.body.data.quoteToken });
    expect(response.status).toBe(422);
    expect(await OrderModel.countDocuments()).toBe(0);
  });

  it('approves a confirmed-order cancellation request exactly once', async () => {
    const { cookie, payload } = await startVisit();
    const order = await place(cookie, payload);
    expect(
      (
        await request(app)
          .patch(`/api/v1/staff/orders/${order._id}/status`)
          .set('Authorization', `Bearer ${staffAccess}`)
          .send({ status: 'CONFIRMED' })
      ).status,
    ).toBe(200);
    const otherGuest = await request(app).post('/api/v1/table-sessions/join').send({ tableToken });
    expect(
      (
        await request(app)
          .post(`/api/v1/orders/${order._id}/cancel-requests`)
          .set('Cookie', cookies(otherGuest))
          .send({ reason: 'Gửi hộ khách khác' })
      ).status,
    ).toBe(403);
    const [created, duplicate] = await Promise.all([
      request(app)
        .post(`/api/v1/orders/${order._id}/cancel-requests`)
        .set('Cookie', cookie)
        .send({ reason: 'Khách đổi ý' }),
      request(app)
        .post(`/api/v1/orders/${order._id}/cancel-requests`)
        .set('Cookie', cookie)
        .send({ reason: 'Khách đổi ý' }),
    ]);
    expect(created.status).toBe(201);
    expect(duplicate.status).toBe(201);
    expect(duplicate.body.data.request._id).toBe(created.body.data.request._id);
    expect(await CancelRequestModel.countDocuments()).toBe(1);
    const requestId = created.body.data.request._id as string;
    const approved = await request(app)
      .patch(`/api/v1/staff/cancel-requests/${requestId}`)
      .set('Authorization', `Bearer ${staffAccess}`)
      .send({ decision: 'APPROVED', expectedVersion: 0 });
    expect(approved.status).toBe(200);
    expect((await OrderModel.findById(order._id))!.status).toBe('CANCELLED');
    expect(
      (
        await request(app)
          .patch(`/api/v1/staff/cancel-requests/${requestId}`)
          .set('Authorization', `Bearer ${staffAccess}`)
          .send({ decision: 'REJECTED', expectedVersion: 0 })
      ).status,
    ).toBe(409);
  });

  it('does not collect payment while a cancellation request is still pending', async () => {
    const { cookie, payload, sessionId } = await startVisit();
    const order = await place(cookie, payload);
    expect(
      (
        await request(app)
          .patch(`/api/v1/staff/orders/${order._id}/status`)
          .set('Authorization', `Bearer ${staffAccess}`)
          .send({ status: 'CONFIRMED' })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post(`/api/v1/orders/${order._id}/cancel-requests`)
          .set('Cookie', cookie)
          .send({ reason: 'Khách muốn đổi món' })
      ).status,
    ).toBe(201);
    for (const status of ['PREPARING', 'READY', 'SERVED']) {
      expect(
        (
          await request(app)
            .patch(`/api/v1/staff/orders/${order._id}/status`)
            .set('Authorization', `Bearer ${staffAccess}`)
            .send({ status })
        ).status,
      ).toBe(200);
    }
    const version = await checkout(sessionId);
    const response = await pay(sessionId, order.total, version, randomToken(16));
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CANCEL_REQUEST_PENDING');
    expect(await PaymentModel.countDocuments()).toBe(0);
  });

  it('assigns a concurrent payment to exactly one valid cash shift while closing', async () => {
    const { cookie, payload, sessionId } = await startVisit();
    const order = await place(cookie, payload);
    await serve(order._id);
    const sessionVersion = await checkout(sessionId);
    const opened = await request(app)
      .post('/api/v1/staff/cash-shifts')
      .set('Authorization', `Bearer ${staffAccess}`)
      .send({ openingCash: 0 });
    expect(opened.status).toBe(201);
    const initialShiftId = opened.body.data.shift._id as string;
    const [paymentResponse, closeResponse] = await Promise.all([
      pay(sessionId, order.total, sessionVersion, randomToken(16)),
      request(app)
        .post(`/api/v1/staff/cash-shifts/${initialShiftId}/close`)
        .set('Authorization', `Bearer ${staffAccess}`)
        .send({ expectedVersion: 0, countedCash: 0, note: 'Bàn giao ca' }),
    ]);

    expect(paymentResponse.status).toBe(201);
    expect([200, 409]).toContain(closeResponse.status);
    const payment = await PaymentModel.findById(paymentResponse.body.data.payment._id);
    expect(payment?.shiftId).toBeTruthy();
    if (closeResponse.status === 200) {
      expect(payment!.shiftId!.toString()).not.toBe(initialShiftId);
    }
  });

  it('reconciles an overnight shift once under payment replay and concurrent close', async () => {
    const { cookie, payload, sessionId } = await startVisit();
    const order = await place(cookie, payload);
    await serve(order._id);
    const sessionVersion = await checkout(sessionId);
    const opened = await request(app)
      .post('/api/v1/staff/cash-shifts')
      .set('Authorization', `Bearer ${staffAccess}`)
      .send({ openingCash: 100_000 });
    const shiftId = opened.body.data.shift._id as string;
    await CashShiftModel.updateOne(
      { _id: shiftId },
      { $set: { openedAt: new Date(Date.now() - 26 * 60 * 60_000) } },
    );
    const paymentKey = randomToken(16);
    const first = await pay(sessionId, order.total, sessionVersion, paymentKey);
    const replay = await pay(sessionId, order.total, sessionVersion, paymentKey);
    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(await PaymentModel.countDocuments({ shiftId })).toBe(1);

    const current = await request(app)
      .get('/api/v1/staff/cash-shifts/current')
      .set('Authorization', `Bearer ${staffAccess}`);
    expect(Date.now() - Date.parse(current.body.data.shift.openedAt)).toBeGreaterThan(
      24 * 60 * 60_000,
    );
    expect(current.body.data.shift.paymentsByMethod.CASH).toMatchObject({
      total: order.total,
      count: 1,
    });
    const closePayload = {
      expectedVersion: current.body.data.shift.version,
      countedCash: 100_000 + order.total,
      note: 'Ca qua đêm',
    };
    const closed = await Promise.all([
      request(app)
        .post(`/api/v1/staff/cash-shifts/${shiftId}/close`)
        .set('Authorization', `Bearer ${staffAccess}`)
        .send(closePayload),
      request(app)
        .post(`/api/v1/staff/cash-shifts/${shiftId}/close`)
        .set('Authorization', `Bearer ${staffAccess}`)
        .send(closePayload),
    ]);
    expect(closed.map((response) => response.status).sort()).toEqual([200, 409]);
    const stored = await CashShiftModel.findById(shiftId);
    expect(stored).toMatchObject({
      status: 'CLOSED',
      expectedCash: 100_000 + order.total,
      difference: 0,
    });
  });

  it('transfers an open visit to an empty table atomically while guest access remains valid', async () => {
    const { cookie, sessionId } = await startVisit();
    const targetToken = randomToken(24);
    const target = await TableModel.create({
      code: 'B02',
      name: 'Bàn 02',
      capacity: 4,
      publicTokenHash: sha256(targetToken),
      isActive: true,
    });
    const moved = await request(app)
      .post(`/api/v1/staff/table-sessions/${sessionId}/transfer`)
      .set('Authorization', `Bearer ${staffAccess}`)
      .send({ targetTableId: target.id, expectedVersion: 0 });
    expect(moved.status).toBe(200);
    expect(moved.body.data.session.tableId).toBe(target.id);
    const current = await request(app).get('/api/v1/table-sessions/current').set('Cookie', cookie);
    expect(current.body.data.table).toMatchObject({ id: target.id, code: 'B02' });
    const targetJoin = await request(app)
      .post('/api/v1/table-sessions/join')
      .send({ tableToken: targetToken });
    expect(targetJoin.body.data.tableSessionId).toBe(sessionId);
    const sourceJoin = await request(app).post('/api/v1/table-sessions/join').send({ tableToken });
    expect(sourceJoin.body.data.tableSessionId).not.toBe(sessionId);
  });

  it('allows only one of two sessions racing for the same target table', async () => {
    const first = await startVisit();
    const sourceTwo = await TableModel.create({
      code: 'B03',
      name: 'Bàn 03',
      capacity: 4,
      publicTokenHash: sha256(randomToken(24)),
      isActive: true,
    });
    const target = await TableModel.create({
      code: 'B04',
      name: 'Bàn 04',
      capacity: 4,
      publicTokenHash: sha256(randomToken(24)),
      isActive: true,
    });
    const openedTwo = await request(app)
      .post(`/api/v1/staff/tables/${sourceTwo.id}/sessions`)
      .set('Authorization', `Bearer ${staffAccess}`);
    const secondSessionId = openedTwo.body.data.session._id as string;
    const responses = await Promise.all([
      request(app)
        .post(`/api/v1/staff/table-sessions/${first.sessionId}/transfer`)
        .set('Authorization', `Bearer ${staffAccess}`)
        .send({ targetTableId: target.id, expectedVersion: 0 }),
      request(app)
        .post(`/api/v1/staff/table-sessions/${secondSessionId}/transfer`)
        .set('Authorization', `Bearer ${staffAccess}`)
        .send({ targetTableId: target.id, expectedVersion: 0 }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(
      await TableSessionModel.countDocuments({
        tableId: target._id,
        status: { $in: ['OPEN', 'CHECKOUT'] },
      }),
    ).toBe(1);
  });

  it('lets staff change availability without granting price-edit permission', async () => {
    const product = (await ProductModel.findOne({ slug: 'espresso-may' }))!;
    const changed = await request(app)
      .patch(`/api/v1/staff/catalog/products/${product.id}/availability`)
      .set('Authorization', `Bearer ${staffAccess}`)
      .send({ isAvailable: false, basePrice: 1 });
    expect(changed.status).toBe(200);
    const stored = (await ProductModel.findById(product.id))!;
    expect(stored.isAvailable).toBe(false);
    expect(stored.basePrice).toBe(35_000);
    expect(
      await AuditLogModel.countDocuments({
        action: 'product.availabilityChanged',
        entityId: product.id,
      }),
    ).toBe(1);
    expect(
      await OutboxEventModel.countDocuments({
        eventType: 'menu.availabilityChanged',
        aggregateId: product.id,
      }),
    ).toBe(1);
  });

  it('revalidates the final AI configuration against dairy metadata and total budget', async () => {
    const { cookie } = await startVisit();
    const product = (await ProductModel.findOne({ slug: 'espresso-may' }))!;
    const topping = (await ToppingModel.findOne())!;
    const response = await request(app)
      .post('/api/v1/ai/recommendations/validate')
      .set('Cookie', cookie)
      .send({
        productId: product.id,
        variantId: product.variants[1]!._id!.toString(),
        toppingIds: [topping.id],
        constraints: { noDairy: true, maxBudget: 40_000 },
      });

    expect(response.status).toBe(200);
    expect(response.body.data.valid).toBe(false);
    expect(response.body.data.total).toBe(53_000);
    expect(response.body.data.violations).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Không thể xác nhận topping'),
        expect.stringContaining('vượt ngân sách'),
      ]),
    );
  });

  it('paginates more than 100 immutable bills and protects admin-only history', async () => {
    const paidAt = new Date('2026-09-23T03:00:00.000Z');
    await BillModel.insertMany(
      Array.from({ length: 105 }, (_, index) => ({
        invoiceCode: `MC-ARCHIVE-${String(index + 1).padStart(3, '0')}`,
        tableSessionId: new mongoose.Types.ObjectId(),
        tableId: new mongoose.Types.ObjectId(),
        tableCode: 'OLD-01',
        tableName: 'Bàn Archive',
        cashierName: 'Thu ngân cũ',
        source: 'STAFF',
        openedAt: new Date(paidAt.getTime() - 60_000),
        closedAt: paidAt,
        participants: [],
        orders: [],
        subtotal: index + 1,
        total: index + 1,
        paidAmount: index + 1,
        paymentIds: [],
        payments: [{ method: 'CASH', amount: index + 1, paidAt }],
      })),
    );
    const adminLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@test.vn', password: 'Password@123' });
    const page = await request(app)
      .get('/api/v1/admin/bills?table=Archive&cashier=cũ&page=6&limit=20')
      .set('Authorization', `Bearer ${adminLogin.body.data.accessToken}`);

    expect(page.status).toBe(200);
    expect(page.body.data).toMatchObject({ total: 105, page: 6, limit: 20 });
    expect(page.body.data.items).toHaveLength(5);
    expect(page.body.data.items[0]).toMatchObject({
      tableName: 'Bàn Archive',
      cashierName: 'Thu ngân cũ',
    });
    expect(
      (await request(app).get('/api/v1/admin/bills').set('Authorization', `Bearer ${staffAccess}`))
        .status,
    ).toBe(403);
    expect((await request(app).get('/api/v1/admin/bills')).status).toBe(401);
  });

  describe('guest auto-open sessions', () => {
    function cookieNamed(res: { headers: Record<string, unknown> }, name: string): string {
      const header = res.headers['set-cookie'];
      const raw = (Array.isArray(header) ? (header as string[]) : []).find((c: string) =>
        c.startsWith(`${name}=`),
      );
      expect(raw).toBeDefined();
      return raw!.split(';')[0]!;
    }
    async function orderPayload() {
      const product = (await ProductModel.findOne({ slug: 'espresso-may' }))!;
      return {
        items: [
          {
            productId: product._id.toString(),
            variantId: product.variants[0]!._id!.toString(),
            sugarLevel: '50%',
            iceLevel: 'normal-ice',
            toppingIds: [],
            quantity: 1,
          },
        ],
      };
    }
    async function joinWithoutStaff(cookie?: string) {
      const req = request(app).post('/api/v1/table-sessions/join');
      if (cookie) req.set('Cookie', cookie);
      const res = await req.send({ tableToken });
      expect(res.status).toBe(200);
      return res;
    }

    it('auto-opens a GUEST session so a fresh table can order without staff', async () => {
      const joined = await joinWithoutStaff();
      expect(joined.body.data.created).toBe(true);
      expect(joined.body.data.table).toMatchObject({
        id: tableId,
        code: 'B01',
        name: 'Bàn 01',
        capacity: 4,
      });
      const cookie = cookieNamed(joined, 'mc_guest');
      const sessionId = joined.body.data.tableSessionId as string;
      expect(joined.body.data.tableSession).toMatchObject({ id: sessionId, status: 'OPEN' });

      const sessions = await TableSessionModel.find({ tableId }).lean();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({ status: 'OPEN', source: 'GUEST', openedBy: null });
      expect(sessions[0]!._id.toString()).toBe(sessionId);
      expect(
        await AuditLogModel.countDocuments({
          action: 'tableSession.autoOpened',
          entityId: sessionId,
        }),
      ).toBe(1);

      const order = await place(cookie, await orderPayload());
      expect(order.total).toBe(35000);
    }, 60_000);

    it('reuses the same participant and session when the QR is scanned again', async () => {
      const first = await joinWithoutStaff();
      const cookie = cookieNamed(first, 'mc_guest');
      const again = await joinWithoutStaff(cookie);
      expect(again.body.data.created).toBe(false);
      expect(again.body.data.participantId).toBe(first.body.data.participantId);
      expect(again.body.data.tableSessionId).toBe(first.body.data.tableSessionId);
      expect(await TableSessionModel.countDocuments({ tableId })).toBe(1);
    }, 60_000);

    it('returns the live GUEST session instead of a conflict when staff opens the table', async () => {
      const joined = await joinWithoutStaff();
      const sessionId = joined.body.data.tableSessionId as string;
      const opened = await request(app)
        .post(`/api/v1/staff/tables/${tableId}/sessions`)
        .set('Authorization', `Bearer ${staffAccess}`);
      expect(opened.status).toBe(200);
      expect(opened.body.data.created).toBe(false);
      expect(opened.body.data.session._id).toBe(sessionId);

      const list = await request(app)
        .get('/api/v1/staff/table-sessions')
        .set('Authorization', `Bearer ${staffAccess}`);
      expect(list.status).toBe(200);
      const item = list.body.data.items.find(
        (it: { session: { _id: string } }) => it.session._id === sessionId,
      );
      expect(item).toBeDefined();
      expect(item.session.source).toBe('GUEST');
      expect(item.session).toHaveProperty('closedReason');
      expect(item.table._id).toBe(tableId);
    }, 60_000);

    it('bill closes the auto-opened session and lets a new scan order again', async () => {
      const joined = await joinWithoutStaff();
      const cookie = cookieNamed(joined, 'mc_guest');
      const sessionId = joined.body.data.tableSessionId as string;
      const order = await place(cookie, await orderPayload());
      await serve(order._id);
      const version = await checkout(sessionId);
      const paid = await pay(sessionId, order.total, version, 'auto-open-payment');
      expect(paid.status).toBe(201);
      expect(typeof paid.body.data.billId).toBe('string');
      expect(paid.body.data.orderIds).toEqual([order._id]);
      expect((await TableSessionModel.findById(sessionId))!.status).toBe('CLOSED');

      const rescan = await joinWithoutStaff(cookie);
      expect(rescan.body.data.created).toBe(true);
      const newSessionId = rescan.body.data.tableSessionId as string;
      expect(newSessionId).not.toBe(sessionId);
      expect((await TableSessionModel.findById(newSessionId))!.status).toBe('OPEN');

      const newCookie = cookieNamed(rescan, 'mc_guest');
      const newOrder = await place(newCookie, await orderPayload());
      expect(newOrder._id).toBeTruthy();

      const revoked = await request(app)
        .post('/api/v1/orders')
        .set('Cookie', cookie)
        .set('Idempotency-Key', randomToken(16))
        .send(await orderPayload());
      expect(revoked.status).toBe(401);
    }, 60_000);

    it('replays the payment idempotently against a single immutable bill', async () => {
      const joined = await joinWithoutStaff();
      const cookie = cookieNamed(joined, 'mc_guest');
      const sessionId = joined.body.data.tableSessionId as string;
      const order = await place(cookie, await orderPayload());
      await serve(order._id);
      const version = await checkout(sessionId);

      const metricBefore = getInstanceMetricsSnapshot().businessEvents.payment_confirmed;
      const first = await pay(sessionId, order.total, version, 'auto-open-replay');
      expect(first.status).toBe(201);
      expect(getInstanceMetricsSnapshot().businessEvents.payment_confirmed).toBe(metricBefore + 1);
      const replay = await pay(sessionId, order.total, version, 'auto-open-replay');
      expect(replay.status).toBe(200);
      expect(replay.body.data.replayed).toBe(true);
      expect(getInstanceMetricsSnapshot().businessEvents.payment_confirmed).toBe(metricBefore + 1);
      expect(replay.body.data.billId).toBe(first.body.data.billId);
      expect(await BillModel.countDocuments({ tableSessionId: sessionId })).toBe(1);
      expect(await PaymentModel.countDocuments({ tableSessionId: sessionId })).toBe(1);
      expect(await AuditLogModel.countDocuments({ action: 'payment.confirmed' })).toBe(1);
      expect(
        await OutboxEventModel.countDocuments({
          aggregateType: 'TableSession',
          aggregateId: sessionId,
          eventType: 'payment.confirmed',
        }),
      ).toBe(2);
    }, 60_000);

    it('serves the frozen bill snapshot and a receipt free of internal fields', async () => {
      const joined = await joinWithoutStaff();
      const cookie = cookieNamed(joined, 'mc_guest');
      const receiptCookie = cookieNamed(joined, 'mc_receipt');
      const sessionId = joined.body.data.tableSessionId as string;
      const order = await place(cookie, await orderPayload());
      await serve(order._id);
      const version = await checkout(sessionId);
      expect((await pay(sessionId, order.total, version, 'auto-open-snapshot')).status).toBe(201);

      const receipt = await request(app)
        .get('/api/v1/receipts/current')
        .set('Cookie', receiptCookie);
      expect(receipt.status).toBe(200);
      expect(receipt.body.data.orders).toHaveLength(1);
      const line = receipt.body.data.orders[0];
      expect(line).toMatchObject({
        _id: order._id,
        code: expect.any(String),
        total: order.total,
        review: null,
      });
      expect(line.items).toHaveLength(1);
      for (const item of [line, ...line.items]) {
        for (const key of ['idempotencyKey', 'requestHash', 'statusHistory', 'version', '__v']) {
          expect(item).not.toHaveProperty(key);
        }
      }

      await OrderModel.updateOne({ _id: order._id }, { $set: { total: 1 } });
      const frozenReceipt = await request(app)
        .get('/api/v1/receipts/current')
        .set('Cookie', receiptCookie);
      expect(frozenReceipt.body.data.source).toBe('BILL_SNAPSHOT');
      expect(frozenReceipt.body.data.total).toBe(order.total);
      const bill = await request(app)
        .get(`/api/v1/staff/table-sessions/${sessionId}/bill`)
        .set('Authorization', `Bearer ${staffAccess}`);
      expect(bill.status).toBe(200);
      expect(bill.body.data.total).toBe(order.total);
      expect(bill.body.data.orders).toHaveLength(1);
      expect(bill.body.data.orders[0]._id).toBe(order._id);
      expect(bill.body.data.orders[0].total).toBe(order.total);

      await Promise.all([
        BillModel.deleteOne({ tableSessionId: sessionId }),
        OrderModel.updateOne({ _id: order._id }, { $set: { total: order.total } }),
      ]);
      const legacyReceipt = await request(app)
        .get('/api/v1/receipts/current')
        .set('Cookie', receiptCookie);
      expect(legacyReceipt.status).toBe(200);
      expect(legacyReceipt.body.data).toMatchObject({
        source: 'LEGACY_ORDER_FALLBACK',
        total: order.total,
      });
    }, 60_000);

    it('refuses guests when auto-open is disabled', async () => {
      // `config` là object runtime thường; chỉ tầng type mới là `as const` nên test đổi được giá trị.
      const runtimeConfig = config as unknown as { guestAutoOpen: boolean };
      const previous = runtimeConfig.guestAutoOpen;
      runtimeConfig.guestAutoOpen = false;
      try {
        const res = await request(app).post('/api/v1/table-sessions/join').send({ tableToken });
        expect(res.status).toBe(403);
        expect(res.body.error).toMatchObject({
          code: 'FORBIDDEN',
          message: 'Bàn chưa mở phiên phục vụ, vui lòng báo nhân viên.',
        });
        expect(await TableSessionModel.countDocuments()).toBe(0);
      } finally {
        runtimeConfig.guestAutoOpen = previous;
      }
    }, 60_000);
  });
});
