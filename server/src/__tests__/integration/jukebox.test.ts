import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { buildApp } from '../../app.js';
import { config } from '../../config/index.js';
import {
  JukeboxTrackModel,
  JukeboxStateModel,
  JukeboxVoteModel,
  JukeboxActionModel,
} from '../../models/Jukebox.js';
import { TableModel } from '../../models/Table.js';
import { TableSessionModel } from '../../models/TableSession.js';
import { GuestSessionModel } from '../../models/GuestSession.js';
import { UserModel } from '../../models/User.js';
import { OutboxEventModel } from '../../models/OutboxEvent.js';
import { OrderModel } from '../../models/Order.js';
import { PaymentModel } from '../../models/Payment.js';
import { BillModel } from '../../models/Bill.js';
import { outboxRepository } from '../../repositories/outboxRepository.js';
import { sha256, signAccessToken } from '../../utils/crypto.js';
import {
  jukeboxFeed,
  voteJukebox,
  jukeboxCatalog,
  saveJukeboxTrack,
  staffJukeboxFeed,
  leaseJukebox,
  controlJukebox,
} from '../../services/jukeboxService.js';
import { transferSession, transition } from '../../services/tableSessionService.js';
import type { GameActor } from '../../services/miniGameService.js';

const app = buildApp();
let repl: MongoMemoryReplSet,
  a: GameActor,
  b: GameActor,
  c: GameActor,
  user: string,
  staffToken: string,
  adminToken: string;
let t1: string, t2: string, device: string;
const track = (extra = {}) => ({
  requestId: randomUUID(),
  expectedVersion: 0,
  title: 'Bài một',
  artist: 'Nghệ sĩ',
  audioUrl: 'https://audio.example.test/song.mp3',
  enabled: true,
  ...extra,
});
const choose = async (actor: GameActor, trackId: string | null, extra = {}) =>
  voteJukebox(actor, {
    requestId: randomUUID(),
    expectedVersion: (await jukeboxFeed(actor)).vote!.version,
    trackId,
    ...extra,
  });
const command = async (kind: 'next' | 'stop', extra = {}) =>
  controlJukebox(user, kind, {
    deviceId: device,
    requestId: randomUUID(),
    playbackVersion: (await jukeboxFeed()).playbackVersion,
    ...extra,
  });
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(repl.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
}, 120000);
beforeEach(async () => {
  vi.restoreAllMocks();
  for (const col of Object.values(mongoose.connection.collections)) await col.deleteMany({});
  const table = await TableModel.create({
    code: 'J1',
    name: 'Bàn nhạc',
    capacity: 4,
    publicTokenHash: 'jukebox-table',
  });
  const sid = (await TableSessionModel.create({ tableId: table._id })).id;
  a = { tableSessionId: sid, participantId: 'private-guest-a' };
  b = { ...a, participantId: 'private-guest-b' };
  const other = await TableModel.create({
    code: 'J2',
    name: 'Bàn khác',
    capacity: 4,
    publicTokenHash: 'jukebox-other',
  });
  c = {
    tableSessionId: (await TableSessionModel.create({ tableId: other._id })).id,
    participantId: 'private-guest-c',
  };
  await GuestSessionModel.create({
    ...a,
    tokenHash: sha256('jukebox-cookie'),
    expiresAt: new Date(Date.now() + 3600000),
  });
  const admin = await UserModel.create({
    name: 'Admin',
    email: 'admin@jukebox.test',
    passwordHash: 'unused',
    role: 'ADMIN',
  });
  const staff = await UserModel.create({
    name: 'Staff',
    email: 'staff@jukebox.test',
    passwordHash: 'unused',
    role: 'STAFF',
  });
  user = staff.id;
  device = randomUUID();
  staffToken = signAccessToken({ sub: staff.id, role: 'STAFF', name: staff.name });
  adminToken = signAccessToken({ sub: admin.id, role: 'ADMIN', name: admin.name });
  t1 = (await saveJukeboxTrack(admin.id, null, track())).id!;
  t2 = (
    await saveJukeboxTrack(
      admin.id,
      null,
      track({ title: 'Bài hai', audioUrl: 'https://audio.example.test/two.ogg' }),
    )
  ).id!;
});
afterAll(async () => {
  await mongoose.disconnect();
  await repl.stop();
});
describe('jukebox table ballots and exclusive counter player', () => {
  it('accepts shared YouTube URLs, keeps them private and selects them through the existing leased queue', async () => {
    for (const audioUrl of [
      'https://youtu.be/M7lc1UVf-VE?si=share',
      'https://www.youtube.com/watch?v=M7lc1UVf-VE&list=ignored',
      'https://www.youtube.com/shorts/M7lc1UVf-VE',
    ]) {
      const saved = await saveJukeboxTrack(user, null, track({ audioUrl }));
      expect((await JukeboxTrackModel.findById(saved.id))?.audioUrl).toBe(audioUrl);
      await choose(a, saved.id);
    }
    expect(JSON.stringify(await jukeboxFeed(a))).not.toContain('youtu');
    await leaseJukebox(user, 'claim', { deviceId: device });
    const selected = await command('next');
    expect(selected.current?.audioUrl).toContain('youtube.com/shorts/');
    for (const audioUrl of [
      'https://youtube.com.evil.test/watch?v=M7lc1UVf-VE',
      'https://youtu.be/invalid',
      'javascript:alert(1)',
      'https://open.spotify.com/track/123',
    ])
      await expect(saveJukeboxTrack(user, null, track({ audioUrl }))).rejects.toThrow();
  });
  it('requires QR, guest CSRF, role separation, internal portal isolation and no-store', async () => {
    expect((await request(app).get('/api/v1/jukebox')).status).toBe(401);
    expect((await request(app).get('/api/v1/jukebox').set('Cookie', 'mc_member=only')).status).toBe(
      401,
    );
    const feed = await request(app).get('/api/v1/jukebox').set('Cookie', 'mc_guest=jukebox-cookie');
    expect(feed.status).toBe(200);
    expect(feed.headers['cache-control']).toBe('no-store');
    expect(
      (
        await request(app)
          .post('/api/v1/jukebox/vote')
          .set('Cookie', 'mc_guest=jukebox-cookie')
          .set('Origin', 'https://evil.test')
          .send({})
      ).status,
    ).toBe(403);
    expect((await request(app).get('/api/v1/admin/jukebox/tracks')).status).toBe(401);
    expect(
      (await request(app).get('/api/v1/admin/jukebox/tracks').auth(staffToken, { type: 'bearer' }))
        .status,
    ).toBe(403);
    expect(
      (await request(app).get('/api/v1/admin/jukebox/tracks').auth(adminToken, { type: 'bearer' }))
        .status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .get('/api/v1/staff/jukebox')
          .query({ deviceId: device })
          .auth(staffToken, { type: 'bearer' })
      ).status,
    ).toBe(200);
    const prior = config.trafficClass;
    try {
      Object.assign(config, { trafficClass: 'internal' });
      expect((await request(app).get('/api/v1/jukebox')).status).toBe(404);
      Object.assign(config, { trafficClass: 'guest' });
      expect(
        (
          await request(app)
            .get('/api/v1/admin/jukebox/tracks')
            .auth(adminToken, { type: 'bearer' })
        ).status,
      ).toBe(404);
    } finally {
      Object.assign(config, { trafficClass: prior });
    }
  });
  it('rejects non-audio providers, insecure/credential URLs, controls and forged fields', async () => {
    for (const audioUrl of [
      'http://a.test/a.mp3',
      'https://youtube.com/watch?v=x',
      'javascript:alert(1)',
      'https://u:p@a.test/a.mp3',
      'https://a.test/a.mp3#x',
    ])
      await expect(saveJukeboxTrack(user, null, track({ audioUrl }))).rejects.toThrow();
    await expect(saveJukeboxTrack(user, null, track({ title: 'A\u0000B' }))).rejects.toThrow();
    await expect(
      voteJukebox(a, {
        requestId: randomUUID(),
        expectedVersion: 0,
        trackId: t1,
        tableSessionId: c.tableSessionId,
      }),
    ).rejects.toThrow();
    expect(await JukeboxTrackModel.countDocuments()).toBe(2);
  });
  it('keeps audio URLs, voters, private session IDs and device IDs out of guest feed/events', async () => {
    await choose(a, t1);
    await leaseJukebox(user, 'claim', { deviceId: device });
    await command('next');
    const serialized = JSON.stringify(await jukeboxFeed(b));
    for (const secret of [
      'audioUrl',
      'example.test',
      a.tableSessionId,
      a.participantId,
      device,
      user,
    ])
      expect(serialized).not.toContain(secret);
    const events = await OutboxEventModel.find({ eventType: 'jukebox.changed' });
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.payload).toEqual({ refresh: true });
      expect(event.target.scope).toBe('all');
    }
    expect((await staffJukeboxFeed(user, { deviceId: randomUUID() })).current?.audioUrl).toBe('');
    expect((await staffJukeboxFeed(user, { deviceId: device })).current?.audioUrl).toContain(
      'https:',
    );
  });
  it('shares one ballot per table, changes/cancels without consuming a turn and persists across reload', async () => {
    await choose(a, t1);
    expect((await jukeboxFeed(b)).vote?.trackId).toBe(t1);
    await choose(b, t2);
    let feed = await jukeboxFeed(a);
    expect(feed.queue).toMatchObject([{ id: t2, votes: 1 }]);
    expect(feed.vote?.remaining).toBe(5);
    await choose(a, null);
    feed = await jukeboxFeed(b);
    expect(feed.queue).toHaveLength(0);
    expect(feed.vote?.remaining).toBe(5);
    expect(await JukeboxVoteModel.countDocuments()).toBe(1);
  });
  it('allows exactly one winner for concurrent same-table changes', async () => {
    const result = await Promise.allSettled([
      choose(a, t1, { expectedVersion: 0 }),
      choose(b, t2, { expectedVersion: 0 }),
    ]);
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await jukeboxFeed(a)).queue).toHaveLength(1);
    expect((await jukeboxFeed(a)).vote?.version).toBe(1);
  });
  it('replays identical ballot requests and rejects key reuse with different payload', async () => {
    const body = { requestId: randomUUID(), expectedVersion: 0, trackId: t1 };
    await Promise.all([voteJukebox(a, body), voteJukebox(b, body)]);
    expect((await jukeboxFeed(a)).vote?.version).toBe(1);
    await expect(voteJukebox(a, { ...body, trackId: t2 })).rejects.toMatchObject({ status: 409 });
    expect(await JukeboxActionModel.countDocuments({ actor: `table:${a.tableSessionId}` })).toBe(1);
  });
  it('ranks by votes then oldest active ballot and consumes only the selected song votes', async () => {
    await choose(a, t1);
    await choose(c, t2);
    expect((await jukeboxFeed(a)).queue.map((t) => t.id)).toEqual([t1, t2]);
    await JukeboxVoteModel.updateOne(
      { tableSessionId: c.tableSessionId },
      { selectedAt: new Date(Date.now() - 10000) },
    );
    expect((await jukeboxFeed(a)).queue[0]!.id).toBe(t2);
    await leaseJukebox(user, 'claim', { deviceId: device });
    const next = await command('next');
    expect(next.current?.id).toBe(t2);
    expect(next.queue[0]?.id).toBe(t1);
    expect((await jukeboxFeed(c)).vote).toMatchObject({ trackId: null, remaining: 4 });
    expect((await jukeboxFeed(a)).vote?.remaining).toBe(5);
  });
  it('limits each table session to five consumed turns, including fresh participants', async () => {
    await leaseJukebox(user, 'claim', { deviceId: device });
    for (let i = 0; i < 5; i++) {
      await choose(a, i % 2 ? t2 : t1);
      await command('next');
    }
    expect((await jukeboxFeed(b)).vote).toMatchObject({ remaining: 0, canVote: false });
    await expect(choose(b, t2)).rejects.toMatchObject({ status: 409 });
  });
  it('counts independent tables, clears inactive ballots for a selected song without charging them', async () => {
    await choose(a, t1);
    await choose(c, t1);
    expect((await jukeboxFeed(a)).queue[0]).toMatchObject({ id: t1, votes: 2 });
    await TableSessionModel.updateOne({ _id: c.tableSessionId }, { status: 'CHECKOUT' });
    await leaseJukebox(user, 'claim', { deviceId: device });
    await command('next');
    expect((await jukeboxFeed(a)).vote).toMatchObject({ remaining: 4, trackId: null });
    expect((await jukeboxFeed(c)).vote).toMatchObject({ remaining: 5, trackId: null });
    await TableSessionModel.updateOne({ _id: c.tableSessionId }, { status: 'OPEN' });
    expect((await jukeboxFeed(c)).queue).toHaveLength(0);
  });
  it('excludes checkout/closed ballots and forbids their mutations', async () => {
    await choose(a, t1);
    await choose(c, t2);
    await TableSessionModel.updateOne({ _id: a.tableSessionId }, { status: 'CHECKOUT' });
    expect((await jukeboxFeed(a)).queue.map((t) => t.id)).toEqual([t2]);
    await expect(choose(a, t2)).rejects.toMatchObject({ status: 403 });
    await TableSessionModel.updateOne({ _id: c.tableSessionId }, { status: 'CLOSED' });
    await expect(jukeboxFeed(c)).rejects.toMatchObject({ status: 403 });
    await leaseJukebox(user, 'claim', { deviceId: device });
    expect((await command('next')).current).toBeNull();
    expect((await JukeboxVoteModel.findOne({ tableSessionId: a.tableSessionId }))?.used).toBe(0);
  });
  it('follows transfer by session, does not block close and gives a new session a fresh allowance', async () => {
    await choose(a, t1);
    const vacant = await TableModel.create({
      code: 'J3',
      name: 'Bàn chuyển',
      capacity: 4,
      publicTokenHash: 'jukebox-transfer',
    });
    await transferSession(
      a.tableSessionId,
      vacant.id,
      (await TableSessionModel.findById(a.tableSessionId).orFail()).version,
      user,
    );
    expect((await jukeboxFeed(a)).vote?.trackId).toBe(t1);
    await transition(
      a.tableSessionId,
      (await TableSessionModel.findById(a.tableSessionId).orFail()).version,
      'CLOSED',
      user,
    );
    const sid = (await TableSessionModel.create({ tableId: vacant._id })).id;
    expect((await jukeboxFeed({ ...a, tableSessionId: sid })).vote).toMatchObject({
      trackId: null,
      remaining: 5,
    });
  });
  it('disabling a song clears pending votes without spending turns and rejects stale forms', async () => {
    await choose(a, t1);
    const old = (await jukeboxCatalog()).find((t) => t.id === t1)!;
    const body = track({ ...old, expectedVersion: old.version, enabled: false });
    delete (body as Record<string, unknown>).id;
    delete (body as Record<string, unknown>).version;
    await saveJukeboxTrack(user, t1, body);
    expect((await jukeboxFeed(a)).vote).toMatchObject({ trackId: null, remaining: 5, version: 2 });
    await expect(choose(a, t1)).rejects.toMatchObject({ status: 404 });
    await expect(
      saveJukeboxTrack(user, t1, { ...body, requestId: randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('catalog create replay returns same id and edit keeps the selected audio snapshot immutable', async () => {
    const body = track({ title: 'Replay' });
    const one = await saveJukeboxTrack(user, null, body),
      two = await saveJukeboxTrack(user, null, body);
    expect(two.id).toBe(one.id);
    expect(await JukeboxTrackModel.countDocuments({ title: 'Replay' })).toBe(1);
    await choose(a, t1);
    await leaseJukebox(user, 'claim', { deviceId: device });
    await command('next');
    await saveJukeboxTrack(
      user,
      t1,
      track({
        expectedVersion: 1,
        title: 'Tên mới',
        audioUrl: 'https://audio.example.test/new.mp3',
        enabled: false,
      }),
    );
    expect((await staffJukeboxFeed(user, { deviceId: device })).current).toMatchObject({
      title: 'Bài một',
      audioUrl: 'https://audio.example.test/song.mp3',
    });
  });
  it('allows only one simultaneous lease, requires matching user/device and never steals a live lease', async () => {
    const otherDevice = randomUUID();
    const claims = await Promise.allSettled([
      leaseJukebox(user, 'claim', { deviceId: device }),
      leaseJukebox(user, 'claim', { deviceId: otherDevice }),
    ]);
    expect(claims.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const winner = (await JukeboxStateModel.findById('main'))!.leaseDeviceId!;
    await expect(
      leaseJukebox('another-user', 'heartbeat', { deviceId: winner }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(leaseJukebox(user, 'release', { deviceId: randomUUID() })).rejects.toMatchObject({
      status: 409,
    });
    expect((await leaseJukebox(user, 'heartbeat', { deviceId: winner })).lease.owned).toBe(true);
  });
  it('expires/releases leases, prevents stale player commands, and lets another device recover', async () => {
    await leaseJukebox(user, 'claim', { deviceId: device });
    await JukeboxStateModel.updateOne({ _id: 'main' }, { leaseUntil: new Date(Date.now() - 1) });
    await expect(command('next')).rejects.toMatchObject({ status: 409 });
    await expect(leaseJukebox(user, 'heartbeat', { deviceId: device })).rejects.toMatchObject({
      status: 409,
    });
    device = randomUUID();
    await leaseJukebox(user, 'claim', { deviceId: device });
    await leaseJukebox(user, 'release', { deviceId: device });
    expect((await staffJukeboxFeed(user, { deviceId: device })).lease.busy).toBe(false);
  });
  it('serializes next clicks, replays ended callbacks and rejects old playback versions', async () => {
    await choose(a, t1);
    await choose(c, t2);
    await leaseJukebox(user, 'claim', { deviceId: device });
    const body = { deviceId: device, requestId: randomUUID(), playbackVersion: 0 };
    const responses = await Promise.all([
      controlJukebox(user, 'next', body),
      controlJukebox(user, 'next', body),
    ]);
    expect(responses[0]!.current?.id).toBe(responses[1]!.current?.id);
    expect((await jukeboxFeed()).playbackVersion).toBe(1);
    await expect(
      controlJukebox(user, 'next', { ...body, requestId: randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await jukeboxFeed()).queue).toHaveLength(1);
    await command('stop');
    expect((await jukeboxFeed()).current).toBeNull();
    expect((await jukeboxFeed()).queue).toHaveLength(1);
  });
  it('rolls back ballot, journal, audit and state when outbox fails; never writes financial records', async () => {
    const before = await JukeboxStateModel.findById('main').lean();
    vi.spyOn(outboxRepository, 'createRealtimeEvents').mockRejectedValueOnce(
      new Error('outbox down'),
    );
    await expect(choose(a, t1)).rejects.toThrow('outbox down');
    expect(await JukeboxVoteModel.countDocuments()).toBe(0);
    expect(await JukeboxStateModel.findById('main').lean()).toEqual(before);
    expect(await JukeboxActionModel.countDocuments({ actor: `table:${a.tableSessionId}` })).toBe(0);
    await choose(a, t1);
    await leaseJukebox(user, 'claim', { deviceId: device });
    await command('next');
    for (const model of [OrderModel, PaymentModel, BillModel])
      expect(await model.countDocuments()).toBe(0);
  });
  it('allows the lease owner to select an enabled song without votes and replays the exact command', async () => {
    await leaseJukebox(user, 'claim', { deviceId: device });
    const body = { deviceId: device, requestId: randomUUID(), playbackVersion: 0, trackId: t2 };
    const results = await Promise.all([
      controlJukebox(user, 'play', body),
      controlJukebox(user, 'play', body),
    ]);
    expect(results[0]!.current?.id).toBe(t2);
    expect(results[1]!.current?.id).toBe(t2);
    expect((await jukeboxFeed()).playbackVersion).toBe(1);
    expect(await JukeboxVoteModel.countDocuments()).toBe(0);
    expect(
      await JukeboxActionModel.countDocuments({ actor: `user:${user}`, requestId: body.requestId }),
    ).toBe(1);
    await expect(controlJukebox(user, 'play', { ...body, trackId: t1 })).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      controlJukebox(user, 'play', { ...body, requestId: randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
    for (const model of [OrderModel, PaymentModel, BillModel])
      expect(await model.countDocuments()).toBe(0);
  });
  it('consumes only matching votes for a manually selected song and keeps other requested songs queued', async () => {
    await choose(a, t1);
    await choose(c, t2);
    await leaseJukebox(user, 'claim', { deviceId: device });
    const selected = await controlJukebox(user, 'play', {
      deviceId: device,
      requestId: randomUUID(),
      playbackVersion: 0,
      trackId: t2,
    });
    expect(selected.current?.id).toBe(t2);
    expect((await jukeboxFeed(c)).vote).toMatchObject({ remaining: 4, trackId: null });
    expect((await jukeboxFeed(a)).vote).toMatchObject({ remaining: 5, trackId: t1 });
    expect(selected.queue.map((track) => track.id)).toEqual([t1]);
    expect((await command('next')).current?.id).toBe(t1);
  });
  it('rejects manual selection without authority or with a disabled/missing song, and rolls back failed publication', async () => {
    const body = { deviceId: device, requestId: randomUUID(), playbackVersion: 0, trackId: t1 };
    await expect(controlJukebox(user, 'play', body)).rejects.toMatchObject({ status: 409 });
    await leaseJukebox(user, 'claim', { deviceId: device });
    await expect(
      controlJukebox(user, 'play', { ...body, deviceId: randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
    await JukeboxTrackModel.updateOne({ _id: t1 }, { enabled: false });
    await expect(controlJukebox(user, 'play', body)).rejects.toMatchObject({ status: 404 });
    await expect(
      controlJukebox(user, 'play', { ...body, trackId: new mongoose.Types.ObjectId().toString() }),
    ).rejects.toMatchObject({ status: 404 });
    await JukeboxTrackModel.updateOne({ _id: t1 }, { enabled: true });
    const before = await JukeboxStateModel.findById('main').lean();
    const records = await JukeboxActionModel.countDocuments();
    vi.spyOn(outboxRepository, 'createRealtimeEvents').mockRejectedValueOnce(
      new Error('manual outbox failed'),
    );
    await expect(controlJukebox(user, 'play', body)).rejects.toThrow('manual outbox failed');
    expect(await JukeboxStateModel.findById('main').lean()).toEqual(before);
    expect(await JukeboxActionModel.countDocuments()).toBe(records);
  });
  it('exposes manual playback on staff/admin routes with strict bodies and existing portal/role guards', async () => {
    const path = '/api/v1/staff/jukebox/play';
    const body = { deviceId: device, requestId: randomUUID(), playbackVersion: 0, trackId: t1 };
    expect((await request(app).post(path).send(body)).status).toBe(401);
    expect(
      (
        await request(app)
          .post('/api/v1/admin/jukebox/play')
          .set('Authorization', `Bearer ${staffToken}`)
          .send(body)
      ).status,
    ).toBe(403);
    const admin = await UserModel.findOne({ role: 'ADMIN' }).orFail();
    await leaseJukebox(admin.id, 'claim', { deviceId: device });
    for (const invalid of [
      { ...body, audioUrl: 'https://audio.example.test/other.mp3' },
      { ...body, trackId: 'invalid' },
      { ...body, trackId: undefined },
    ])
      expect(
        (await request(app).post(path).set('Authorization', `Bearer ${adminToken}`).send(invalid))
          .status,
      ).toBe(422);
    const played = await request(app)
      .post('/api/v1/admin/jukebox/play')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);
    expect(played.status).toBe(200);
    expect(played.body.data.current.id).toBe(t1);
    const replayed = await request(app)
      .post(path)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);
    expect(replayed.status).toBe(200);
    expect(replayed.body.data.playbackVersion).toBe(1);
  });

  it('boots safely from an empty jukebox store without writing anything on read', async () => {
    await JukeboxStateModel.deleteMany({});
    expect((await jukeboxFeed(a)).playbackVersion).toBe(0);
    expect(await JukeboxStateModel.countDocuments()).toBe(0);
    await Promise.all([choose(a, t1), choose(c, t2)]);
    expect(await JukeboxStateModel.countDocuments()).toBe(1);
    expect((await jukeboxFeed(a)).queue).toHaveLength(2);
  });
});
