import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { buildApp } from '../../app.js';
import { config } from '../../config/index.js';
import { MiniGameRoundModel, MiniGameActionModel } from '../../models/MiniGame.js';
import { TableModel } from '../../models/Table.js';
import { TableSessionModel } from '../../models/TableSession.js';
import { GuestSessionModel } from '../../models/GuestSession.js';
import { OrderModel } from '../../models/Order.js';
import { PaymentModel } from '../../models/Payment.js';
import { BillModel } from '../../models/Bill.js';
import { OutboxEventModel } from '../../models/OutboxEvent.js';
import { AuditLogModel } from '../../models/AuditLog.js';
import {
  createGame,
  actOnGame,
  gameFeed,
  type GameActor,
  type GameAction,
} from '../../services/miniGameService.js';
import { transition, transferSession } from '../../services/tableSessionService.js';
import { outboxRepository } from '../../repositories/outboxRepository.js';
import { sha256 } from '../../utils/crypto.js';
import { GAME_SPIN_MS, GAME_START_DELAY_MS, GAME_COOLDOWN_MS } from '@may-cafe/contracts';

let repl: MongoMemoryReplSet, app: ReturnType<typeof buildApp>;
let a: GameActor,
  b: GameActor,
  c: GameActor,
  other: GameActor,
  tableId: string,
  emptyTableId: string;
const cookie = 'mc_guest=game-host';
async function guest(
  sid: string,
  participantId: string,
  token: string = randomUUID(),
): Promise<GameActor> {
  await GuestSessionModel.create({
    tableSessionId: sid,
    participantId,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + 3600000),
  });
  return { tableSessionId: sid, participantId };
}
const create = (name = 'An', actor = a, requestId = randomUUID()) =>
  createGame(actor, { name, requestId });
async function act(id: string, kind: GameAction, actor = a, name = 'Bình') {
  const round = await MiniGameRoundModel.findById(id).orFail();
  return actOnGame(actor, id, kind, {
    requestId: randomUUID(),
    expectedVersion: round.version,
    ...(kind === 'join' ? { name } : {}),
  });
}
async function ready() {
  const round = await create();
  await act(round.id, 'join', b);
  return round.id;
}
const session = (actor = a) => TableSessionModel.findById(actor.tableSessionId).orFail();
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(repl.getUri());
  app = buildApp();
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
}, 120000);
beforeEach(async () => {
  vi.restoreAllMocks();
  for (const col of Object.values(mongoose.connection.collections)) await col.deleteMany({});
  const table = await TableModel.create({
    code: 'G1',
    name: 'Bàn game',
    capacity: 4,
    publicTokenHash: 'game-a',
  });
  tableId = table.id;
  const sid = (await TableSessionModel.create({ tableId: table._id })).id;
  a = await guest(sid, 'private-host', 'game-host');
  b = await guest(sid, 'private-player-b');
  c = await guest(sid, 'private-player-c');
  const otherTable = await TableModel.create({
    code: 'G2',
    name: 'Bàn khác',
    capacity: 4,
    publicTokenHash: 'game-b',
  });
  other = await guest(
    (await TableSessionModel.create({ tableId: otherTable._id })).id,
    'private-other',
  );
  emptyTableId = (
    await TableModel.create({
      code: 'G3',
      name: 'Bàn trống',
      capacity: 4,
      publicTokenHash: 'game-empty',
    })
  ).id;
});
afterAll(async () => {
  await mongoose.disconnect();
  await repl.stop();
});

describe('table mini game: explicit opt-in and immutable server draw', () => {
  it('requires QR capability, no-stores responses, validates body and blocks cross-origin/internal access', async () => {
    expect((await request(app).get('/api/v1/game')).status).toBe(401);
    expect(
      (await request(app).get('/api/v1/game').set('Cookie', 'mc_member=member-only')).status,
    ).toBe(401);
    const response = await request(app).get('/api/v1/game').set('Cookie', cookie);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.data.current).toBeNull();
    expect(
      (
        await request(app)
          .post('/api/v1/game')
          .set('Cookie', cookie)
          .set('Origin', 'https://evil.test')
          .send({ name: 'An', requestId: randomUUID() })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/v1/game')
          .set('Cookie', cookie)
          .send({ name: 'An', requestId: randomUUID(), winnerId: 'chosen' })
      ).status,
    ).toBe(422);
    const old = config.trafficClass;
    try {
      Object.assign(config, { trafficClass: 'internal' });
      expect((await request(app).get('/api/v1/game').set('Cookie', cookie)).status).toBe(404);
    } finally {
      Object.assign(config, { trafficClass: old });
    }
  });
  it('creates one host entry with public identifiers and only session-scoped refresh events', async () => {
    const round = await create();
    expect(round.players).toHaveLength(1);
    expect(round.canSpin).toBe(false);
    expect(round.players[0]!.isYou).toBe(true);
    const bView = (await gameFeed(b)).current!;
    expect(bView.players[0]!.isYou).toBe(false);
    expect(bView.isHost).toBe(false);
    const serialized = JSON.stringify(await gameFeed(b));
    for (const secret of [
      'private-host',
      'private-player',
      a.tableSessionId,
      'requestHash',
      'requestId',
      'participantId',
    ])
      expect(serialized).not.toContain(secret);
    const events = await OutboxEventModel.find({ eventType: 'game.changed' });
    expect(events).toHaveLength(1);
    expect(events[0]!.target.scope).toBe('session');
    expect(events[0]!.target.tableSessionId).toBe(a.tableSessionId);
    expect(events[0]!.payload).toEqual({ refresh: true });
    expect((await gameFeed(other)).current).toBeNull();
  });
  it('serializes raced create/replay and rejects changing the original request', async () => {
    const requestId = randomUUID();
    const [one, two] = await Promise.all([create('An', a, requestId), create('An', a, requestId)]);
    expect(one.id).toBe(two.id);
    expect(await MiniGameRoundModel.countDocuments()).toBe(1);
    await expect(create('Tên khác', a, requestId)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
    await expect(create('Cường', c)).rejects.toMatchObject({ code: 'GAME_ACTIVE' });
  });
  it('requires at least two opt-in participants and only the creator can spin or cancel', async () => {
    const round = await create();
    await expect(act(round.id, 'spin')).rejects.toMatchObject({ code: 'GAME_NEEDS_PLAYERS' });
    await act(round.id, 'join', b);
    expect((await gameFeed(a)).current!.canSpin).toBe(true);
    await expect(act(round.id, 'spin', b)).rejects.toThrow();
    await expect(act(round.id, 'cancel', b)).rejects.toThrow();
    await expect(act(round.id, 'leave', a)).rejects.toThrow();
  });
  it('keeps one entry per device, normalizes aliases and refuses duplicate names', async () => {
    const round = await create('  Lan   Anh ');
    expect(round.players[0]!.name).toBe('Lan Anh');
    await expect(act(round.id, 'join', b, 'lan anh')).rejects.toMatchObject({
      code: 'GAME_NAME_TAKEN',
    });
    await act(round.id, 'join', b, 'Bình');
    const before = (await gameFeed(b)).current!.players.find((p) => p.isYou)!.id;
    await act(round.id, 'join', b, 'Bình mới');
    const updated = (await gameFeed(b)).current!;
    expect(updated.players).toHaveLength(2);
    expect(updated.players.find((p) => p.isYou)!.id).toBe(before);
    await act(round.id, 'leave', b);
    expect((await gameFeed(a)).current!.players).toHaveLength(1);
  });
  it('replays an action after a lost response without extra entries/audit/outbox and detects changed reuse', async () => {
    const round = await create();
    const input = { name: 'Bình', requestId: randomUUID(), expectedVersion: 0 };
    const [one, two] = await Promise.all([
      actOnGame(b, round.id, 'join', input),
      actOnGame(b, round.id, 'join', input),
    ]);
    expect(one.players).toHaveLength(2);
    expect(two.players).toHaveLength(2);
    expect(await MiniGameActionModel.countDocuments()).toBe(1);
    expect(await AuditLogModel.countDocuments({ action: 'game.join' })).toBe(1);
    expect(await OutboxEventModel.countDocuments({ eventType: 'game.changed' })).toBe(2);
    await expect(actOnGame(b, round.id, 'join', { ...input, name: 'Khác' })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
  });
  it('draws one fixed roster/winner with common timestamps and no reroll on spin retry', async () => {
    const id = await ready(),
      input = { requestId: randomUUID(), expectedVersion: 1 };
    const before = Date.now();
    const results = await Promise.all([
      actOnGame(a, id, 'spin', input),
      actOnGame(a, id, 'spin', input),
    ]);
    const spun = results[0]!;
    expect(spun.phase).toBe('SPINNING');
    expect(results[1]!.winnerId).toBe(spun.winnerId);
    expect(spun.players.some((p) => p.id === spun.winnerId)).toBe(true);
    expect(spun.spinStartsAt).toBeGreaterThanOrEqual(before + GAME_START_DELAY_MS);
    expect(spun.revealsAt! - spun.spinStartsAt!).toBe(GAME_SPIN_MS);
    expect((await gameFeed(b)).current!.winnerId).toBe(spun.winnerId);
    await expect(act(id, 'spin')).rejects.toMatchObject({ code: 'GAME_NOT_WAITING' });
    await expect(act(id, 'join', c, 'Cường')).rejects.toMatchObject({ code: 'GAME_NOT_WAITING' });
    await expect(act(id, 'cancel')).rejects.toMatchObject({ code: 'GAME_NOT_WAITING' });
    expect(await AuditLogModel.countDocuments({ action: 'game.spin' })).toBe(1);
  });
  it('serializes a last-moment join against the spin snapshot and rejects stale versions', async () => {
    const id = await ready(),
      version = 1;
    const outcomes = await Promise.allSettled([
      actOnGame(a, id, 'spin', { requestId: randomUUID(), expectedVersion: version }),
      actOnGame(c, id, 'join', {
        requestId: randomUUID(),
        expectedVersion: version,
        name: 'Cường',
      }),
    ]);
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    let round = (await gameFeed(a)).current!;
    if (round.phase === 'WAITING') round = await act(id, 'spin');
    expect(round.players.some((p) => p.id === round.winnerId)).toBe(true);
    await expect(
      actOnGame(a, id, 'spin', { requestId: randomUUID(), expectedVersion: 0 }),
    ).rejects.toMatchObject({ code: 'GAME_CHANGED' });
  });
  it('removes revoked/expired guest capabilities from the spin roster', async () => {
    const id = await ready();
    await act(id, 'join', c, 'Cường');
    await GuestSessionModel.updateMany(
      { participantId: b.participantId },
      { revokedAt: new Date() },
    );
    expect((await gameFeed(a)).current!.players.find((p) => p.name === 'Bình')!.eligible).toBe(
      false,
    );
    const drawn = await act(id, 'spin');
    expect(drawn.players.map((p) => p.name)).toEqual(['An', 'Cường']);
    expect(drawn.players.some((p) => p.id === drawn.winnerId)).toBe(true);
  });
  it('refuses to spin if fewer than two capabilities remain valid', async () => {
    const id = await ready();
    await GuestSessionModel.updateMany(
      { participantId: b.participantId },
      { expiresAt: new Date(Date.now() - 1000) },
    );
    await expect(act(id, 'spin')).rejects.toMatchObject({ code: 'GAME_NEEDS_PLAYERS' });
    expect((await MiniGameRoundModel.findById(id).orFail()).winnerId).toBeNull();
  });
  it('caps a roster at twelve participants', async () => {
    const round = await create();
    for (let i = 1; i <= 11; i++) {
      const player = await guest(a.tableSessionId, `player-${i}`);
      await act(round.id, 'join', player, `Bạn ${i}`);
    }
    await expect(act(round.id, 'join', b)).rejects.toMatchObject({ code: 'GAME_FULL' });
    expect((await gameFeed(a)).current!.players).toHaveLength(12);
  });
  it('expires an abandoned lobby and releases its unique slot without deleting history', async () => {
    const round = await create();
    await MiniGameRoundModel.updateOne(
      { _id: round.id },
      { expiresAt: new Date(Date.now() - 1000) },
    );
    expect((await gameFeed(a)).current!.phase).toBe('EXPIRED');
    await expect(act(round.id, 'spin')).rejects.toMatchObject({ code: 'GAME_NOT_WAITING' });
    const next = await create();
    expect(next.id).not.toBe(round.id);
    expect((await gameFeed(a)).history[0]!.phase).toBe('EXPIRED');
    expect(await MiniGameRoundModel.countDocuments()).toBe(2);
  });
  it('enforces draw/cooldown and six new rounds per minute', async () => {
    const id = await ready();
    await act(id, 'spin');
    await expect(create()).rejects.toMatchObject({ code: 'GAME_COOLDOWN' });
    await MiniGameRoundModel.updateOne(
      { _id: id },
      { revealsAt: new Date(Date.now() - GAME_COOLDOWN_MS - 1000) },
    );
    for (let i = 0; i < 5; i++) {
      const next = await create();
      await act(next.id, 'cancel');
    }
    await expect(create()).rejects.toMatchObject({ code: 'GAME_LIMIT' });
  });
  it('isolates sessions and does not accept arbitrary winner/roster fields from the client', async () => {
    const id = await ready();
    await expect(act(id, 'join', other)).rejects.toMatchObject({ status: 404 });
    const input = { requestId: randomUUID(), expectedVersion: 1, winnerId: 'fake' };
    expect(
      (await request(app).post(`/api/v1/game/${id}/spin`).set('Cookie', cookie).send(input)).status,
    ).toBe(422);
    expect((await MiniGameRoundModel.findById(id).orFail()).status).toBe('WAITING');
  });
  it('never blocks checkout/close and never carries a game to the next table session', async () => {
    const round = await create();
    await transition(a.tableSessionId, (await session()).version, 'CHECKOUT', null);
    expect((await gameFeed(a)).current!.phase).toBe('CANCELLED');
    await expect(act(round.id, 'join', b)).rejects.toThrow();
    await transition(a.tableSessionId, (await session()).version, 'CLOSED', null);
    expect((await request(app).get('/api/v1/game').set('Cookie', cookie)).status).toBe(401);
    const fresh = await TableSessionModel.create({ tableId });
    expect((await gameFeed({ ...a, tableSessionId: fresh.id })).current).toBeNull();
    await expect(
      actOnGame({ ...a, tableSessionId: fresh.id }, round.id, 'spin', {
        requestId: randomUUID(),
        expectedVersion: 0,
      }),
    ).rejects.toThrow();
  });
  it('follows the same serving session when staff transfers the table', async () => {
    const round = await create();
    await transferSession(
      a.tableSessionId,
      emptyTableId,
      (await session()).version,
      new mongoose.Types.ObjectId().toString(),
    );
    expect(String((await session()).tableId)).toBe(emptyTableId);
    expect((await gameFeed(b)).current!.id).toBe(round.id);
  });
  it('rolls back round/action/audit/outbox and result together on transactional failures', async () => {
    const version = (await session()).version;
    vi.spyOn(outboxRepository, 'createRealtimeEvents').mockRejectedValueOnce(
      new Error('outbox down'),
    );
    await expect(create()).rejects.toThrow('outbox down');
    expect(await MiniGameRoundModel.countDocuments()).toBe(0);
    expect((await session()).version).toBe(version);
    expect(await AuditLogModel.countDocuments({ entityType: 'MiniGameRound' })).toBe(0);
    vi.restoreAllMocks();
    const id = await ready();
    vi.spyOn(outboxRepository, 'createRealtimeEvents').mockRejectedValueOnce(
      new Error('outbox down'),
    );
    await expect(act(id, 'spin')).rejects.toThrow('outbox down');
    const round = await MiniGameRoundModel.findById(id).orFail();
    expect(round.status).toBe('WAITING');
    expect(round.winnerId).toBeNull();
    expect(round.version).toBe(1);
    expect(await MiniGameActionModel.countDocuments()).toBe(1);
    expect(await AuditLogModel.countDocuments({ action: 'game.spin' })).toBe(0);
  });
  it('preserves existing orders and never creates a payment or bill', async () => {
    const existing = await OrderModel.create({
      code: 'KEEP',
      tableSessionId: other.tableSessionId,
      tableId: (await session(other)).tableId,
      participantId: other.participantId,
      items: [
        {
          productId: new mongoose.Types.ObjectId(),
          sugarLevel: '50%',
          iceLevel: 'normal-ice',
          quantity: 1,
          unitPrice: 10000,
          lineTotal: 10000,
          nameSnapshot: 'Giữ nguyên',
        },
      ],
      total: 10000,
      status: 'AWAITING_PAYMENT',
      idempotencyKey: 'keep-order',
      requestHash: 'keep-order',
    });
    const before = existing.toObject();
    const id = await ready();
    await act(id, 'spin');
    expect((await OrderModel.findById(existing.id).orFail()).toObject()).toEqual(before);
    expect(await PaymentModel.countDocuments()).toBe(0);
    expect(await BillModel.countDocuments()).toBe(0);
  });
  it('returns only the most recent ten historical rounds with common persisted results', async () => {
    const base = Date.now() - 100000;
    await MiniGameRoundModel.insertMany(
      Array.from({ length: 15 }, (_, i) => ({
        tableSessionId: a.tableSessionId,
        hostParticipantId: a.participantId,
        requestId: randomUUID(),
        requestHash: 'history',
        status: 'DRAWN',
        players: [{ publicId: `public-${i}`, participantId: a.participantId, name: 'An' }],
        winnerId: `public-${i}`,
        spinStartsAt: new Date(base + i * 1000),
        revealsAt: new Date(base + i * 1000 + 500),
        expiresAt: new Date(base),
        createdAt: new Date(base + i * 1000),
      })),
    );
    const feed = await gameFeed(b);
    expect(feed.current!.winnerId).toBe('public-14');
    expect(feed.current!.phase).toBe('FINISHED');
    expect(feed.history).toHaveLength(10);
  });
});
