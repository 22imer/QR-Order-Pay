import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import type { Express } from 'express';
import { buildApp } from '../../app.js';
import { createAdmissionTicket } from '../../services/tableQrService.js';
import { config } from '../../config/index.js';
import { UserModel } from '../../models/User.js';
import { TableModel } from '../../models/Table.js';
import { CategoryModel } from '../../models/Category.js';
import { ProductModel } from '../../models/Product.js';
import { TableSessionModel } from '../../models/TableSession.js';
import { GuestSessionModel } from '../../models/GuestSession.js';
import { AuditLogModel } from '../../models/AuditLog.js';
import { hashPassword, randomToken, sha256 } from '../../utils/crypto.js';
import { sweepIdleSessions } from '../../services/idleSessionSweeper.js';
import { OutboxEventModel } from '../../models/OutboxEvent.js';
import { unitOfWork } from '../../infrastructure/unitOfWork.js';
import { tableSessionRepository } from '../../repositories/tableSessionRepository.js';
import { auditRepository } from '../../repositories/auditRepository.js';
import { outboxRepository } from '../../repositories/outboxRepository.js';

let replSet: MongoMemoryReplSet;
let app: Express;
let staffAccess = '';
let tableId = '';
let tableToken = '';
let otherTableId = '';
let otherTableToken = '';

async function seedBasic() {
  await Promise.all(Object.values(mongoose.models).map((model) => model.deleteMany({})));
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
      toppingIds: [],
    },
    toppingIds: [],
    tags: [],
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
  otherTableToken = randomToken(24);
  const otherTable = await TableModel.create({
    code: 'B02',
    name: 'Bàn 02',
    capacity: 4,
    publicTokenHash: sha256(otherTableToken),
    isActive: true,
  });
  otherTableId = otherTable._id.toString();
}

async function joinGuest(token: string = tableToken) {
  const id = token === tableToken ? tableId : otherTableId;
  const table = (await TableModel.findById(id))!;
  token = createAdmissionTicket(id, table.qrEpoch ?? 0).token;
  return request(app).post('/api/v1/table-sessions/join').send({ tableToken: token });
}

function openStaffSession(id: string = tableId) {
  return request(app)
    .post(`/api/v1/staff/tables/${id}/sessions`)
    .set('Authorization', `Bearer ${staffAccess}`);
}

/** Đổi timeout nhưng luôn khôi phục giá trị cũ, kể cả khi assertion bên trong ném lỗi. */
async function withIdleTimeout<T>(min: number, fn: () => Promise<T>): Promise<T> {
  const original = config.sessionIdleTimeoutMin;
  (config as unknown as { sessionIdleTimeoutMin: number }).sessionIdleTimeoutMin = min;
  try {
    return await fn();
  } finally {
    (config as unknown as { sessionIdleTimeoutMin: number }).sessionIdleTimeoutMin = original;
  }
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  app = buildApp();
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

beforeEach(async () => {
  await seedBasic();
  const loginRes = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'staff@test.vn', password: 'Password@123' });
  expect(loginRes.status).toBe(200);
  staffAccess = loginRes.body.data.accessToken as string;
});

describe('transactional outbox', () => {
  it('rolls back the business record, audit and event together', async () => {
    await expect(
      unitOfWork.withTransaction(async (session) => {
        const tableSession = await tableSessionRepository.create(
          { tableId, source: 'GUEST' },
          session,
        );
        await auditRepository.log(
          {
            actorType: 'SYSTEM',
            action: 'test.forcedRollback',
            entityType: 'TableSession',
            entityId: tableSession.id,
          },
          session,
        );
        await outboxRepository.createRealtimeEvents(
          [
            {
              eventType: 'tableSession.statusChanged',
              aggregateType: 'TableSession',
              aggregateId: tableSession.id,
              aggregateVersion: tableSession.version,
              target: { scope: 'staff' },
              payload: { tableSessionId: tableSession.id, status: 'OPEN' },
            },
          ],
          session,
        );
        throw new Error('forced rollback');
      }),
    ).rejects.toThrow('forced rollback');

    expect(await TableSessionModel.countDocuments({ tableId })).toBe(0);
    expect(await AuditLogModel.countDocuments({ action: 'test.forcedRollback' })).toBe(0);
    expect(await OutboxEventModel.countDocuments({ aggregateType: 'TableSession' })).toBe(0);
  });
});

describe('guest auto-open session', () => {
  it('serves two truly concurrent guest joins with the same session and a single created flag', async () => {
    const [first, second] = await Promise.all([joinGuest(), joinGuest()]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.data.tableSessionId).toBe(second.body.data.tableSessionId);
    expect([first.body.data.created, second.body.data.created].filter(Boolean)).toHaveLength(1);

    const sessions = await TableSessionModel.find({ tableId });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.status).toBe('OPEN');
    expect(sessions[0]!.source).toBe('GUEST');
    expect(sessions[0]!._id.toString()).toBe(first.body.data.tableSessionId);
  });

  it('serves a concurrent guest join and staff open without conflict on the same table', async () => {
    const [guest, staff] = await Promise.all([
      joinGuest(otherTableToken),
      openStaffSession(otherTableId),
    ]);

    expect([guest.status, staff.status]).not.toContain(409);
    expect([guest.status, staff.status]).not.toContain(500);
    expect(guest.status).toBe(200);
    expect(staff.status).toBe(200);
    expect([guest.body.data.created, staff.body.data.created].filter(Boolean)).toHaveLength(1);

    const active = await TableSessionModel.find({
      tableId: otherTableId,
      status: { $in: ['OPEN', 'CHECKOUT'] },
    });
    expect(active).toHaveLength(1);
  });

  it('reverts a CHECKOUT session to OPEN when staff reopens the table', async () => {
    const joined = await joinGuest();
    expect(joined.status).toBe(200);
    const sessionId = joined.body.data.tableSessionId as string;

    const checkout = await request(app)
      .patch(`/api/v1/staff/table-sessions/${sessionId}/status`)
      .set('Authorization', `Bearer ${staffAccess}`)
      .send({ status: 'CHECKOUT', expectedVersion: 0 });
    expect(checkout.status).toBe(200);
    expect(checkout.body.data.session.status).toBe('CHECKOUT');

    const reopened = await openStaffSession();
    expect(reopened.status).toBe(200);
    expect(reopened.body.data.created).toBe(false);
    expect(reopened.body.data.session._id).toBe(sessionId);
    expect(reopened.body.data.session.status).toBe('OPEN');

    const stored = await TableSessionModel.findById(sessionId);
    expect(stored!.status).toBe('OPEN');
  });
});

describe('idle session sweeper', () => {
  it('closes an expired guest-opened session with no orders and revokes its guest session', async () => {
    const joined = await joinGuest();
    const sessionId = joined.body.data.tableSessionId as string;
    const guestCountBefore = await GuestSessionModel.countDocuments({ tableSessionId: sessionId });
    expect(guestCountBefore).toBe(1);

    const closedCount = await withIdleTimeout(60, () =>
      sweepIdleSessions(new Date(Date.now() + 61 * 60_000)),
    );
    expect(closedCount).toBe(1);

    const session = await TableSessionModel.findById(sessionId);
    expect(session!.status).toBe('CLOSED');
    expect(session!.closedReason).toBe('IDLE');
    expect(session!.closedBy).toBeNull();
    expect(session!.billId).toBeNull();

    const guest = await GuestSessionModel.findOne({ tableSessionId: sessionId });
    expect(guest!.revokedAt).not.toBeNull();

    const audit = await AuditLogModel.findOne({
      action: 'tableSession.idleClosed',
      entityId: sessionId,
    });
    expect(audit).not.toBeNull();
  });

  it('keeps an idle guest-opened session that still has a live order', async () => {
    const joined = await joinGuest();
    const sessionId = joined.body.data.tableSessionId as string;
    const product = (await ProductModel.findOne({ slug: 'espresso-may' }))!;
    const cookie = ((joined.headers['set-cookie'] as unknown as string[]) ?? [])
      .map((value) => value.split(';')[0])
      .join('; ');
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
    const quote = await request(app)
      .post('/api/v1/orders/quote')
      .set('Cookie', cookie)
      .send(payload);
    const placed = await request(app)
      .post('/api/v1/orders')
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomToken(16))
      .send({ ...payload, quoteToken: quote.body.data.quoteToken });
    expect(placed.status).toBe(201);

    const closedCount = await withIdleTimeout(60, () =>
      sweepIdleSessions(new Date(Date.now() + 61 * 60_000)),
    );
    expect(closedCount).toBe(0);

    const session = await TableSessionModel.findById(sessionId);
    expect(session!.status).toBe('OPEN');
    expect(session!.closedReason).toBeNull();
  });

  it('leaves staff-opened sessions alone even when they are past the idle timeout', async () => {
    const opened = await openStaffSession();
    expect(opened.status).toBe(200);
    const sessionId = opened.body.data.session._id as string;

    const closedCount = await withIdleTimeout(60, () =>
      sweepIdleSessions(new Date(Date.now() + 61 * 60_000)),
    );
    expect(closedCount).toBe(0);

    const session = await TableSessionModel.findById(sessionId);
    expect(session!.status).toBe('OPEN');
    expect(session!.closedReason).toBeNull();
  });

  it('does nothing when the idle timeout is disabled', async () => {
    const joined = await joinGuest();
    const sessionId = joined.body.data.tableSessionId as string;

    const closedCount = await withIdleTimeout(0, () =>
      sweepIdleSessions(new Date(Date.now() + 61 * 60_000)),
    );
    expect(closedCount).toBe(0);

    const session = await TableSessionModel.findById(sessionId);
    expect(session!.status).toBe('OPEN');
    const guest = await GuestSessionModel.findOne({ tableSessionId: sessionId });
    expect(guest!.revokedAt).toBeNull();
  });

  it('lets a guest open a fresh session on the same table after the idle sweep closed the empty one', async () => {
    const first = await joinGuest();
    const firstSessionId = first.body.data.tableSessionId as string;

    expect(
      await withIdleTimeout(60, () => sweepIdleSessions(new Date(Date.now() + 61 * 60_000))),
    ).toBe(1);
    expect((await TableSessionModel.findById(firstSessionId))!.status).toBe('CLOSED');

    const second = await joinGuest();
    expect(second.status).toBe(200);
    expect(second.body.data.created).toBe(true);
    expect(second.body.data.tableSessionId).not.toBe(firstSessionId);

    const sessions = await TableSessionModel.find({ tableId }).sort({ startedAt: 1 });
    expect(sessions).toHaveLength(2);
    expect(sessions.map((s) => s.status)).toEqual(['CLOSED', 'OPEN']);
  });
});
