import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { buildApp } from '../../app.js';
import { UserModel } from '../../models/User.js';
import { RefreshSessionModel } from '../../models/RefreshSession.js';
import { PaymentModel } from '../../models/Payment.js';
import { AuditLogModel } from '../../models/AuditLog.js';
import { hashPassword, signAccessToken } from '../../utils/crypto.js';

let repl: MongoMemoryReplSet;
let app: ReturnType<typeof buildApp>;
let adminId: string;
let staffId: string;
let admin: Record<string, string>;
let staff: Record<string, string>;
let refreshCookie: string;
const login = (email: string, password = 'Password@123') =>
  request(app).post('/api/v1/auth/login').send({ email, password });
const update = (id: string, data: object) =>
  request(app).patch(`/api/v1/admin/users/${id}`).set(admin).send(data);

beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(repl.getUri());
  app = buildApp();
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
}, 120000);
beforeEach(async () => {
  await UserModel.deleteMany({});
  await RefreshSessionModel.deleteMany({});
  const passwordHash = await hashPassword('Password@123');
  adminId = (
    await UserModel.create({ name: 'Quản lý', email: 'admin@test.vn', role: 'ADMIN', passwordHash })
  ).id;
  staffId = (
    await UserModel.create({
      name: 'Nhân viên',
      email: 'staff@test.vn',
      role: 'STAFF',
      passwordHash,
    })
  ).id;
  admin = { Authorization: `Bearer ${(await login('admin@test.vn')).body.data.accessToken}` };
  const session = await login('staff@test.vn');
  staff = { Authorization: `Bearer ${session.body.data.accessToken}` };
  refreshCookie = String((session.headers['set-cookie'] as unknown as string[])[0]).split(';')[0]!;
});
afterAll(async () => {
  await mongoose.disconnect();
  await repl.stop();
});

describe('account management', () => {
  it('deletes employees from the list, revokes login and keeps payment history', async () => {
    const payment = await PaymentModel.create({
      tableSessionId: new mongoose.Types.ObjectId(),
      amount: 35000,
      confirmedBy: staffId,
      idempotencyKey: `employee-${staffId}`,
    });
    const before = payment.toObject();
    const endpoint = `/api/v1/admin/users/${staffId}`;
    expect((await request(app).delete(endpoint).set(admin)).status).toBe(200);
    expect(
      (await request(app).get('/api/v1/admin/users').set(admin)).body.data.users.map(
        (user: { id: string }) => user.id,
      ),
    ).not.toContain(staffId);
    expect((await UserModel.findById(staffId))?.isDeleted).toBe(true);
    expect((await login('staff@test.vn')).status).toBe(401);
    expect((await request(app).get('/api/v1/auth/me').set(staff)).status).toBe(401);
    expect(
      (await request(app).post('/api/v1/auth/refresh').set('Cookie', refreshCookie)).status,
    ).toBe(401);
    expect((await update(staffId, { isActive: true })).status).toBe(404);
    expect((await PaymentModel.findById(payment.id))?.toObject()).toEqual(before);
    const recorded = await PaymentModel.findById(payment.id).populate<{
      confirmedBy: { name: string };
    }>('confirmedBy');
    expect(recorded?.confirmedBy.name).toBe('Nhân viên');
    expect(await AuditLogModel.exists({ action: 'user.deleted', entityId: staffId })).toBeTruthy();
    expect((await request(app).delete(endpoint).set(admin)).status).toBe(404);
  });

  it('allows only admin to delete staff and refuses admin deletion', async () => {
    expect((await request(app).delete(`/api/v1/admin/users/${staffId}`).set(staff)).status).toBe(
      403,
    );
    expect((await request(app).delete(`/api/v1/admin/users/${staffId}`)).status).toBe(401);
    expect((await request(app).delete(`/api/v1/admin/users/${adminId}`).set(admin)).status).toBe(
      409,
    );
    expect((await request(app).delete('/api/v1/admin/users/invalid').set(admin)).status).toBe(422);
    expect(
      (await request(app).delete(`/api/v1/admin/users/${new mongoose.Types.ObjectId()}`).set(admin))
        .status,
    ).toBe(404);
    expect((await UserModel.findById(staffId))?.isActive).toBe(true);
    expect((await UserModel.findById(adminId))?.role).toBe('ADMIN');
  });

  it('returns safe profile fields and allows own name only', async () => {
    const me = await request(app).get('/api/v1/auth/me').set(staff);
    expect(me.body.data).toMatchObject({ id: staffId, email: 'staff@test.vn', role: 'STAFF' });
    expect(me.body.data.passwordHash).toBeUndefined();
    expect(
      (await request(app).patch('/api/v1/auth/me').set(staff).send({ name: '  Tên mới  ' })).body
        .data.user.name,
    ).toBe('Tên mới');
    expect(
      (await request(app).patch('/api/v1/auth/me').set(staff).send({ name: 'Tên', role: 'ADMIN' }))
        .status,
    ).toBe(422);
    expect((await UserModel.findById(staffId))?.role).toBe('STAFF');
    expect((await request(app).get('/api/v1/admin/users').set(staff)).status).toBe(403);
    expect(
      (await request(app).patch(`/api/v1/admin/users/${adminId}`).set(staff).send({ name: 'X' }))
        .status,
    ).toBe(403);
    expect((await request(app).get('/api/v1/auth/me')).status).toBe(401);
  });

  it('checks current password, then revokes access and refresh tokens on password change', async () => {
    expect(
      (
        await request(app)
          .post('/api/v1/auth/password')
          .set(staff)
          .send({ currentPassword: 'Wrong', newPassword: 'NewPassword@123' })
      ).status,
    ).toBe(422);
    expect((await request(app).get('/api/v1/auth/me').set(staff)).status).toBe(200);
    expect(
      (
        await request(app)
          .post('/api/v1/auth/password')
          .set(staff)
          .send({ currentPassword: 'Password@123', newPassword: 'NewPassword@123' })
      ).status,
    ).toBe(200);
    expect((await request(app).get('/api/v1/auth/me').set(staff)).status).toBe(401);
    expect(
      (await request(app).post('/api/v1/auth/refresh').set('Cookie', refreshCookie)).status,
    ).toBe(401);
    expect((await login('staff@test.vn')).status).toBe(401);
    const next = await login('staff@test.vn', 'NewPassword@123');
    expect(next.status).toBe(200);
    expect(
      (
        await request(app)
          .get('/api/v1/auth/me')
          .set('Authorization', `Bearer ${next.body.data.accessToken}`)
      ).status,
    ).toBe(200);
  });

  it('creates, edits, locks, unlocks and resets staff without exposing password hashes', async () => {
    const created = await request(app)
      .post('/api/v1/admin/users')
      .set(admin)
      .send({ name: 'Mới', email: ' NEW@TEST.VN ', role: 'STAFF', password: 'Password@123' });
    expect(created.status).toBe(201);
    expect(created.body.data.user.email).toBe('new@test.vn');
    expect(created.body.data.user.passwordHash).toBeUndefined();
    expect((await update(staffId, { name: 'Sửa tên', email: 'updated@test.vn' })).status).toBe(200);
    expect((await update(staffId, { isActive: false })).status).toBe(200);
    expect((await request(app).get('/api/v1/auth/me').set(staff)).status).toBe(401);
    expect((await login('updated@test.vn')).status).toBe(401);
    expect((await update(staffId, { isActive: true, password: 'ResetPassword@123' })).status).toBe(
      200,
    );
    expect((await login('updated@test.vn', 'ResetPassword@123')).status).toBe(200);
    expect((await request(app).get('/api/v1/auth/me').set(staff)).status).toBe(401);
    expect(
      (await request(app).post('/api/v1/auth/refresh').set('Cookie', refreshCookie)).status,
    ).toBe(401);
  });

  it('validates role, email, IDs and rejects arbitrary account updates', async () => {
    for (const body of [
      { role: 'OWNER' },
      { email: 'bad' },
      { name: '' },
      { password: 'short' },
      { $set: { role: 'ADMIN' } },
      { passwordHash: 'direct' },
    ])
      expect((await update(staffId, body)).status).toBe(422);
    expect((await update(staffId, { email: 'admin@test.vn' })).status).toBe(409);
    expect((await update('bad-id', { name: 'X' })).status).toBe(422);
    expect((await update(new mongoose.Types.ObjectId().toString(), { name: 'X' })).status).toBe(
      404,
    );
    expect((await update(adminId, { role: 'STAFF' })).status).toBe(409);
    expect((await update(adminId, { isActive: false })).status).toBe(409);
  });

  it('checks changed roles against existing access tokens', async () => {
    expect((await update(staffId, { role: 'ADMIN' })).status).toBe(200);
    expect((await request(app).get('/api/v1/auth/me').set(staff)).status).toBe(401);
    const promoted = await login('staff@test.vn');
    expect(promoted.body.data.user.role).toBe('ADMIN');
    expect(
      (
        await request(app)
          .get('/api/v1/admin/users')
          .set('Authorization', `Bearer ${promoted.body.data.accessToken}`)
      ).status,
    ).toBe(200);
  });

  it('preserves at least one admin when two admins concurrently remove each other', async () => {
    await update(staffId, { role: 'ADMIN' });
    const second = {
      Authorization: `Bearer ${(await login('staff@test.vn')).body.data.accessToken}`,
    };
    const results = await Promise.all([
      update(staffId, { role: 'STAFF' }),
      request(app).patch(`/api/v1/admin/users/${adminId}`).set(second).send({ role: 'STAFF' }),
    ]);
    expect(results.filter((result) => result.status === 200)).toHaveLength(1);
    expect(await UserModel.countDocuments({ role: 'ADMIN', isActive: true })).toBe(1);
  });

  it('accepts existing tokens without version before the first security change', async () => {
    const legacy = {
      Authorization: `Bearer ${signAccessToken({ sub: staffId, role: 'STAFF', name: 'Cũ' })}`,
    };
    expect((await request(app).get('/api/v1/auth/me').set(legacy)).status).toBe(200);
    await update(staffId, { password: 'ResetPassword@123' });
    expect((await request(app).get('/api/v1/auth/me').set(legacy)).status).toBe(401);
  });
});
