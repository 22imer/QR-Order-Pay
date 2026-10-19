import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { buildApp } from '../../app.js';
import { MemberModel, MemberSessionModel, PointEntryModel } from '../../models/Member.js';
import { VoucherModel, VoucherUseModel } from '../../models/Voucher.js';
import { UserModel } from '../../models/User.js';
import { ProductModel } from '../../models/Product.js';
import { CategoryModel } from '../../models/Category.js';
import { TableModel } from '../../models/Table.js';
import { TableSessionModel } from '../../models/TableSession.js';
import { GuestSessionModel } from '../../models/GuestSession.js';
import { OrderModel } from '../../models/Order.js';
import { BillModel } from '../../models/Bill.js';
import {
  registerMember,
  loginMember,
  resolveMember,
  changeMemberPassword,
  updateMember,
} from '../../services/memberService.js';
import { saveVoucher, priceBenefits } from '../../services/promotionService.js';
import { createOrderQuote } from '../../services/orderPricingService.js';
import { placeOrder, cancelOrderByGuest, transitionByStaff } from '../../services/orderService.js';
import {
  confirmOrderPayment,
  buildBill,
  finalizeSessionBill,
} from '../../services/paymentService.js';
import { refundAndCancelOrder } from '../../services/orderRefundService.js';
import { claimPayment } from '../../services/paymentClaimService.js';
import { buildParticipantReceipt } from '../../services/receiptService.js';
import { getBillHistory } from '../../services/billHistoryService.js';
import { unitOfWork } from '../../infrastructure/unitOfWork.js';
import { hashPassword, randomToken, sha256 } from '../../utils/crypto.js';
import type { BenefitSelection } from '../../services/promotionService.js';
import { orderRepository } from '../../repositories/orderRepository.js';
import {
  requestPaymentCorrection,
  decidePaymentCorrection,
} from '../../services/paymentCorrectionService.js';

let repl: MongoMemoryReplSet;
let app: ReturnType<typeof buildApp>;
let actor: string, memberId: string, memberToken: string, sid: string, productId: string;
let admin: Record<string, string>, staff: Record<string, string>;
const key = () => randomToken(16);
const pass = 'Password@123';
const line = () => ({
  productId,
  variantId: null,
  sugarLevel: '0%',
  iceLevel: 'normal-ice',
  toppingIds: [],
  quantity: 1,
});
const voucher = (overrides = {}) => ({
  code: 'SAVE10',
  name: 'Giảm thử nghiệm',
  type: 'FIXED',
  value: 10000,
  minSubtotal: 0,
  maxDiscount: null,
  startsAt: new Date(Date.now() - 60000).toISOString(),
  endsAt: new Date(Date.now() + 86400000).toISOString(),
  maxUses: 10,
  perMemberLimit: null,
  memberRequired: false,
  isActive: true,
  ...overrides,
});
async function order(
  selection: BenefitSelection = {},
  participantId = key(),
  idempotencyKey = key(),
) {
  const input = { tableSessionId: sid, participantId, items: [line()], ...selection };
  const quote = await createOrderQuote(input);
  return placeOrder({ ...input, quoteToken: quote.quoteToken, idempotencyKey });
}
async function pay(id: string, amount?: number) {
  const current = await OrderModel.findById(id).orFail();
  const token = key();
  await claimPayment(sid, actor, token);
  return confirmOrderPayment({
    orderId: id,
    staffId: actor,
    expectedVersion: current.version,
    amount: amount ?? current.total,
    method: 'CASH',
    idempotencyKey: key(),
    claimToken: token,
  });
}
async function serve(id: string) {
  for (const next of ['CONFIRMED', 'PREPARING', 'READY', 'SERVED'] as const)
    await transitionByStaff(id, next, { id: actor });
}
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(repl.getUri());
  app = buildApp();
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  for (const role of ['ADMIN', 'STAFF'] as const) {
    const user = await UserModel.create({
      name: role,
      email: `${role}@promotion.test`,
      role,
      passwordHash: await hashPassword(pass),
    });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: pass });
    expect(login.status).toBe(200);
    if (role === 'ADMIN') {
      actor = user.id;
      admin = { Authorization: `Bearer ${login.body.data.accessToken}` };
    } else staff = { Authorization: `Bearer ${login.body.data.accessToken}` };
  }
}, 120000);
beforeEach(async () => {
  for (const collection of Object.values(mongoose.connection.collections))
    if (!['users', 'refreshsessions'].includes(collection.collectionName))
      await collection.deleteMany({});
  const member = await registerMember({ name: 'Khách thử', phone: '0901234567', password: pass });
  memberId = member.member.id;
  memberToken = member.token;
  const cat = await CategoryModel.create({ name: 'Cà phê', slug: 'ca-phe' });
  const product = await ProductModel.create({
    name: 'Latte',
    slug: 'latte',
    image: '/favicon.svg',
    categoryId: cat._id,
    basePrice: 60000,
    allowedOptions: { sizes: [], sugarLevels: ['0%'], iceLevels: ['normal-ice'], toppingIds: [] },
  });
  productId = product.id;
  const table = await TableModel.create({
    code: key(),
    name: 'Bàn ưu đãi',
    capacity: 4,
    publicTokenHash: key(),
  });
  sid = (await TableSessionModel.create({ tableId: table._id })).id;
});
afterAll(async () => {
  await mongoose.disconnect();
  await repl.stop();
});

describe('Member phone/password and boundaries', () => {
  it('normalizes phone, hashes password and returns no secret in DTO/cookie session', async () => {
    await expect(
      registerMember({ name: 'Trùng', phone: '+84 901 234 567', password: pass }),
    ).rejects.toMatchObject({ code: 'MEMBER_EXISTS' });
    const login = await request(app)
      .post('/api/v1/members/login')
      .send({ phone: '+84901234567', password: pass });
    expect(login.status).toBe(200);
    expect(String(login.headers['set-cookie'])).toContain('HttpOnly');
    expect(login.body.data.member).not.toHaveProperty('passwordHash');
    expect(login.body.data).not.toHaveProperty('token');
    const raw = await MemberModel.findById(memberId).orFail();
    expect(raw.passwordHash).not.toBe(pass);
    expect(await MemberSessionModel.findOne({ tokenHash: sha256(memberToken) })).toBeTruthy();
  });
  it('cannot read points or spend with a phone alone, and member cookie is not a guest table capability', async () => {
    expect((await request(app).get('/api/v1/members/points')).status).toBe(401);
    expect(
      (
        await request(app)
          .post('/api/v1/orders/quote')
          .set('Cookie', `mc_member=${memberToken}`)
          .send({ items: [line()] })
      ).status,
    ).toBe(401);
    await expect(priceBenefits(60000, { redeemPoints: 1 })).rejects.toMatchObject({ status: 401 });
  });
  it('locks repeated failed attempts and expires the lock', async () => {
    for (let i = 0; i < 6; i++)
      await expect(loginMember({ phone: '0901234567', password: 'wrong' })).rejects.toMatchObject({
        status: 401,
      });
    await expect(loginMember({ phone: '0901234567', password: pass })).rejects.toMatchObject({
      status: 429,
    });
    await MemberModel.updateOne(
      { _id: memberId },
      { $set: { lockedUntil: new Date(Date.now() - 1) } },
    );
    expect((await loginMember({ phone: '0901234567', password: pass })).member.id).toBe(memberId);
  });
  it('password change/admin reset/lock invalidate old sessions; expired session is rejected before TTL cleanup', async () => {
    await changeMemberPassword(memberToken, { currentPassword: pass, password: 'NewPassword@123' });
    expect(await resolveMember(memberToken)).toBeNull();
    const login = await loginMember({ phone: '0901234567', password: 'NewPassword@123' });
    const current = await MemberModel.findById(memberId).orFail();
    await updateMember(memberId, { expectedVersion: current.version, password: pass }, actor);
    expect(await resolveMember(login.token)).toBeNull();
    const next = await loginMember({ phone: '0901234567', password: pass });
    await MemberSessionModel.updateOne(
      { tokenHash: sha256(next.token) },
      { $set: { expiresAt: new Date(Date.now() - 1) } },
    );
    expect(await resolveMember(next.token)).toBeNull();
    const v = (await MemberModel.findById(memberId).orFail()).version;
    await updateMember(memberId, { expectedVersion: v, isActive: false }, actor);
    await expect(loginMember({ phone: '0901234567', password: pass })).rejects.toMatchObject({
      status: 401,
    });
  });
  it('restricts administration, validates input and CSRF; ignores forged memberId on guest requests', async () => {
    expect((await request(app).get('/api/v1/admin/members').set(staff)).status).toBe(403);
    expect(
      (await request(app).post('/api/v1/admin/vouchers').set(staff).send(voucher())).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/v1/members/register')
          .set('Origin', 'https://evil.invalid')
          .send({ name: 'Test', phone: '0909999999', password: pass })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/v1/members/register')
          .send({ name: 'Test', phone: '123', password: '123' })
      ).status,
    ).toBe(422);
    const guestToken = key();
    const participantId = key();
    await GuestSessionModel.create({
      tableSessionId: sid,
      participantId,
      tokenHash: sha256(guestToken),
      expiresAt: new Date(Date.now() + 3600000),
    });
    const response = await request(app)
      .post('/api/v1/orders/quote')
      .set('Cookie', `mc_guest=${guestToken}`)
      .send({ items: [line()], memberId, redeemPoints: 1 });
    expect(response.status).toBe(401);
  });
});
describe('Voucher, quote, money and points lifecycle', () => {
  it('combines an opted-in voucher and points, replays once, and earns only the net amount', async () => {
    await MemberModel.updateOne({ _id: memberId }, { $set: { points: 40 } });
    const saved = await saveVoucher(null, voucher({ allowPointRedemption: true }), actor);
    expect(saved.allowPointRedemption).toBe(true);
    const participant = key(),
      idem = key();
    const placed = (
      await order({ memberId, voucherCode: 'SAVE10', redeemPoints: 10 }, participant, idem)
    ).order;
    expect(placed.subtotal).toBe(60000);
    expect(placed.voucherDiscount).toBe(10000);
    expect(placed.pointsDiscount).toBe(10000);
    expect(placed.total).toBe(40000);
    expect(
      (await order({ memberId, voucherCode: 'SAVE10', redeemPoints: 10 }, participant, idem))
        .created,
    ).toBe(false);
    expect((await MemberModel.findById(memberId).orFail()).points).toBe(30);
    expect((await VoucherModel.findOne().orFail()).usedCount).toBe(1);
    expect(await PointEntryModel.countDocuments({ type: 'REDEEM' })).toBe(1);
    await pay(placed.id);
    await serve(placed.id);
    expect((await MemberModel.findById(memberId).orFail()).points).toBe(34);
    expect((await OrderModel.findById(placed.id).orFail()).earnedPoints).toBe(4);
  });
  it('caps points at half the post-voucher remainder including percent rounding and a zero remainder', async () => {
    await MemberModel.updateOne({ _id: memberId }, { $set: { points: 100 } });
    await saveVoucher(null, voucher({ allowPointRedemption: true }), actor);
    const allowed = await priceBenefits(60000, {
      memberId,
      voucherCode: 'SAVE10',
      redeemPoints: 25,
    });
    expect(allowed.maxRedeemPoints).toBe(25);
    expect(allowed.total).toBe(25000);
    await expect(
      priceBenefits(60000, { memberId, voucherCode: 'SAVE10', redeemPoints: 26 }),
    ).rejects.toMatchObject({ status: 422 });
    await saveVoucher(
      null,
      voucher({ code: 'PERCENT30', type: 'PERCENT', value: 30, allowPointRedemption: true }),
      actor,
    );
    const percent = await priceBenefits(60001, {
      memberId,
      voucherCode: 'PERCENT30',
      redeemPoints: 21,
    });
    expect(percent.voucherDiscount).toBe(18000);
    expect(percent.maxRedeemPoints).toBe(21);
    expect(percent.total).toBe(21001);
    await saveVoucher(
      null,
      voucher({ code: 'FREE', value: 100000, allowPointRedemption: true }),
      actor,
    );
    expect((await priceBenefits(60000, { memberId, voucherCode: 'FREE' })).maxRedeemPoints).toBe(0);
    await expect(
      priceBenefits(60000, { memberId, voucherCode: 'FREE', redeemPoints: 1 }),
    ).rejects.toMatchObject({ status: 422 });
  });
  it('keeps legacy vouchers exclusive and rejects stacking after admin disables the policy', async () => {
    await MemberModel.updateOne({ _id: memberId }, { $set: { points: 40 } });
    const saved = await saveVoucher(null, voucher({ allowPointRedemption: true }), actor);
    const input = {
      tableSessionId: sid,
      participantId: key(),
      items: [line()],
      memberId,
      voucherCode: 'SAVE10',
      redeemPoints: 10,
    };
    const quote = await createOrderQuote(input);
    expect(quote.voucherAllowsPoints).toBe(true);
    expect(quote.maxRedeemPoints).toBe(25);
    await saveVoucher(
      saved.id,
      { ...voucher({ allowPointRedemption: false }), expectedVersion: saved.version },
      actor,
    );
    await expect(
      placeOrder({ ...input, quoteToken: quote.quoteToken, idempotencyKey: key() }),
    ).rejects.toMatchObject({ status: 422 });
    expect(await OrderModel.countDocuments()).toBe(0);
    expect((await MemberModel.findById(memberId).orFail()).points).toBe(40);
    // Missing fields in existing persisted documents must not opt customers into stacking.
    await VoucherModel.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(saved.id) },
      { $unset: { allowPointRedemption: '' } },
    );
    const legacy = await priceBenefits(60000, { memberId, voucherCode: 'SAVE10' });
    expect(legacy.voucherAllowsPoints).toBe(false);
    expect(legacy.maxRedeemPoints).toBe(0);
    await expect(
      priceBenefits(60000, { memberId, voucherCode: 'SAVE10', redeemPoints: 10 }),
    ).rejects.toMatchObject({ status: 422 });
  });
  it('returns both benefits exactly once on unpaid cancellation and paid refund/cancellation', async () => {
    await MemberModel.updateOne({ _id: memberId }, { $set: { points: 20 } });
    await saveVoucher(null, voucher({ allowPointRedemption: true }), actor);
    const unpaid = (await order({ memberId, voucherCode: 'SAVE10', redeemPoints: 10 })).order;
    await cancelOrderByGuest(unpaid.id, unpaid.participantId);
    expect((await MemberModel.findById(memberId).orFail()).points).toBe(20);
    expect((await VoucherModel.findOne().orFail()).usedCount).toBe(0);
    const paid = (await order({ memberId, voucherCode: 'SAVE10', redeemPoints: 10 })).order;
    await pay(paid.id);
    const version = (await OrderModel.findById(paid.id).orFail()).version;
    await refundAndCancelOrder(
      paid.id,
      actor,
      version,
      40000,
      'CASH',
      'Hoàn đơn dùng voucher và điểm',
    );
    await refundAndCancelOrder(
      paid.id,
      actor,
      version,
      40000,
      'CASH',
      'Hoàn đơn dùng voucher và điểm',
    );
    expect((await MemberModel.findById(memberId).orFail()).points).toBe(20);
    expect((await VoucherModel.findOne().orFail()).usedCount).toBe(0);
    expect(await PointEntryModel.countDocuments({ type: 'RETURN' })).toBe(2);
    expect(await PointEntryModel.countDocuments({ type: 'EARN' })).toBe(0);
  });
  it('serializes mixed-benefit orders competing for the final slot without spending the loser points', async () => {
    await MemberModel.updateOne({ _id: memberId }, { $set: { points: 20 } });
    await saveVoucher(null, voucher({ maxUses: 1, allowPointRedemption: true }), actor);
    const outcomes = await Promise.allSettled([
      order({ memberId, voucherCode: 'SAVE10', redeemPoints: 10 }),
      order({ memberId, voucherCode: 'SAVE10', redeemPoints: 10 }),
    ]);
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await MemberModel.findById(memberId).orFail()).points).toBe(10);
    expect((await VoucherModel.findOne().orFail()).usedCount).toBe(1);
    expect(await PointEntryModel.countDocuments({ type: 'REDEEM' })).toBe(1);
  });
  it('rolls back point/voucher reservations if order creation fails before commit', async () => {
    await MemberModel.updateOne({ _id: memberId }, { $set: { points: 10 } });
    await saveVoucher(null, voucher({ allowPointRedemption: true }), actor);
    const spy = vi
      .spyOn(orderRepository, 'createWithSession')
      .mockRejectedValue(new Error('isolated write failure'));
    try {
      await expect(order({ memberId, redeemPoints: 10 })).rejects.toThrow('isolated write failure');
      await expect(order({ voucherCode: 'SAVE10' })).rejects.toThrow('isolated write failure');
      await expect(order({ memberId, voucherCode: 'SAVE10', redeemPoints: 10 })).rejects.toThrow(
        'isolated write failure',
      );
    } finally {
      spy.mockRestore();
    }
    expect((await MemberModel.findById(memberId).orFail()).points).toBe(10);
    expect((await VoucherModel.findOne().orFail()).usedCount).toBe(0);
    expect(await VoucherUseModel.countDocuments()).toBe(0);
    expect(await PointEntryModel.countDocuments()).toBe(0);
  });
  it('voiding payment retains redemption until the order is cancelled and never awards early', async () => {
    await MemberModel.updateOne({ _id: memberId }, { $set: { points: 10 } });
    const placed = (await order({ memberId, redeemPoints: 10 })).order;
    const payment = (await pay(placed.id)).payment;
    const correction = await requestPaymentCorrection(payment.id, actor, {
      kind: 'VOID',
      reason: 'Thu nhầm đơn thử nghiệm',
    });
    const reviewer = await UserModel.create({
      name: 'Admin duyệt',
      email: 'reviewer@promotion.test',
      role: 'ADMIN',
      passwordHash: await hashPassword(pass),
    });
    await decidePaymentCorrection(correction.id, reviewer.id, {
      expectedVersion: correction.version,
      approve: true,
      note: 'Đã kiểm tra',
    });
    expect((await OrderModel.findById(placed.id).orFail()).paymentStatus).toBe('UNPAID');
    expect((await MemberModel.findById(memberId).orFail()).points).toBe(0);
    expect(await PointEntryModel.countDocuments({ type: 'EARN' })).toBe(0);
    await cancelOrderByGuest(placed.id, placed.participantId);
    expect((await MemberModel.findById(memberId).orFail()).points).toBe(10);
  });
  it('can cancel a fully discounted zero-total paid order and returns its voucher slot', async () => {
    await saveVoucher(null, voucher({ value: 100000 }), actor);
    const placed = (await order({ voucherCode: 'SAVE10', memberId })).order;
    await pay(placed.id, 0);
    await refundAndCancelOrder(
      placed.id,
      actor,
      (await OrderModel.findById(placed.id).orFail()).version,
      0,
      'CASH',
      'Hủy đơn được giảm toàn bộ',
    );
    expect((await OrderModel.findById(placed.id).orFail()).status).toBe('CANCELLED');
    expect((await VoucherModel.findOne().orFail()).usedCount).toBe(0);
  });
  it('prices fixed/% with cap, minimum/date/active/member restrictions and disallows stacking', async () => {
    await saveVoucher(
      null,
      voucher({
        type: 'PERCENT',
        value: 30,
        maxDiscount: 15000,
        minSubtotal: 50000,
        memberRequired: true,
      }),
      actor,
    );
    expect((await priceBenefits(60000, { voucherCode: 'save10', memberId })).total).toBe(45000);
    await expect(priceBenefits(60000, { voucherCode: 'SAVE10' })).rejects.toMatchObject({
      status: 401,
    });
    await expect(priceBenefits(40000, { voucherCode: 'SAVE10', memberId })).rejects.toMatchObject({
      status: 422,
    });
    await expect(
      priceBenefits(60000, { voucherCode: 'SAVE10', memberId, redeemPoints: 1 }),
    ).rejects.toMatchObject({ status: 422 });
    await saveVoucher(
      null,
      voucher({
        code: 'EXPIRED',
        startsAt: new Date(Date.now() - 86400000).toISOString(),
        endsAt: new Date(Date.now() - 1000).toISOString(),
      }),
      actor,
    );
    await expect(priceBenefits(60000, { voucherCode: 'EXPIRED' })).rejects.toMatchObject({
      code: 'VOUCHER_INVALID',
    });
    await saveVoucher(null, voucher({ code: 'OFF', isActive: false }), actor);
    await expect(priceBenefits(60000, { voucherCode: 'OFF' })).rejects.toMatchObject({
      code: 'VOUCHER_INVALID',
    });
  });
  it('binds quote to member and benefit selection/configuration', async () => {
    await saveVoucher(null, voucher(), actor);
    const input = {
      tableSessionId: sid,
      participantId: key(),
      items: [line()],
      voucherCode: 'SAVE10',
      memberId,
    };
    const quote = await createOrderQuote(input);
    await expect(
      placeOrder({ ...input, memberId: null, quoteToken: quote.quoteToken, idempotencyKey: key() }),
    ).rejects.toMatchObject({ code: 'QUOTE_CHANGED' });
    await expect(
      placeOrder({
        ...input,
        voucherCode: undefined,
        quoteToken: quote.quoteToken,
        idempotencyKey: key(),
      }),
    ).rejects.toMatchObject({ code: 'QUOTE_CHANGED' });
    const v = await VoucherModel.findOne().orFail();
    await saveVoucher(v.id, { ...voucher({ value: 20000 }), expectedVersion: v.version }, actor);
    await expect(
      placeOrder({ ...input, quoteToken: quote.quoteToken, idempotencyKey: key() }),
    ).rejects.toMatchObject({ code: 'QUOTE_CHANGED' });
    expect(await OrderModel.countDocuments()).toBe(0);
    expect((await VoucherModel.findOne().orFail()).usedCount).toBe(0);
  });
  it('replays placement without using a second voucher or spending twice; altered selection conflicts', async () => {
    await saveVoucher(null, voucher(), actor);
    const pid = key(),
      idem = key();
    const first = await order({ voucherCode: 'SAVE10' }, pid, idem);
    const second = await order({ voucherCode: 'SAVE10' }, pid, idem);
    expect(second.created).toBe(false);
    expect(second.order.id).toBe(first.order.id);
    expect((await VoucherModel.findOne().orFail()).usedCount).toBe(1);
    await expect(
      placeOrder({
        tableSessionId: sid,
        participantId: pid,
        items: [line()],
        idempotencyKey: idem,
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
  it('serializes the final global voucher slot and releases it on unpaid cancellation', async () => {
    await saveVoucher(null, voucher({ maxUses: 1 }), actor);
    const outcomes = await Promise.allSettled([
      order({ voucherCode: 'SAVE10' }),
      order({ voucherCode: 'SAVE10' }),
    ]);
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await VoucherModel.findOne().orFail()).usedCount).toBe(1);
    const winner = outcomes.find((r) => r.status === 'fulfilled');
    if (winner?.status !== 'fulfilled') throw new Error('No winner');
    await cancelOrderByGuest(winner.value.order.id, winner.value.order.participantId);
    expect((await VoucherModel.findOne().orFail()).usedCount).toBe(0);
    expect((await order({ voucherCode: 'SAVE10' })).order.total).toBe(50000);
  });
  it('serializes per-member quota and protects optimistic admin updates', async () => {
    await saveVoucher(null, voucher({ memberRequired: true, perMemberLimit: 1 }), actor);
    const outcomes = await Promise.allSettled([
      order({ voucherCode: 'SAVE10', memberId }),
      order({ voucherCode: 'SAVE10', memberId }),
    ]);
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const v = await VoucherModel.findOne().orFail();
    await expect(
      saveVoucher(v.id, { ...voucher(), expectedVersion: v.version + 1 }, actor),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await VoucherUseModel.countDocuments({ state: 'RESERVED' })).toBe(1);
  });
  it('enforces points balance/cap and prevents two orders spending the same balance', async () => {
    await MemberModel.updateOne({ _id: memberId }, { $set: { points: 40 } });
    await expect(priceBenefits(60000, { memberId, redeemPoints: 31 })).rejects.toMatchObject({
      status: 422,
    });
    await expect(priceBenefits(60000, { memberId, redeemPoints: 41 })).rejects.toMatchObject({
      code: 'POINTS_INSUFFICIENT',
    });
    const outcomes = await Promise.allSettled([
      order({ memberId, redeemPoints: 30 }),
      order({ memberId, redeemPoints: 30 }),
    ]);
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await MemberModel.findById(memberId).orFail()).points).toBe(10);
    expect(await PointEntryModel.countDocuments({ type: 'REDEEM' })).toBe(1);
  });
  it('restores redeemed points exactly once when an unpaid order is cancelled', async () => {
    await MemberModel.updateOne({ _id: memberId }, { $set: { points: 20 } });
    const placed = (await order({ memberId, redeemPoints: 10 })).order;
    expect(placed.total).toBe(50000);
    await cancelOrderByGuest(placed.id, placed.participantId);
    await expect(cancelOrderByGuest(placed.id, placed.participantId)).rejects.toBeTruthy();
    expect((await MemberModel.findById(memberId).orFail()).points).toBe(20);
    expect(await PointEntryModel.countDocuments({ type: 'RETURN' })).toBe(1);
  });
  it('partial/full payment does not earn early; paid+served earns net points once', async () => {
    await MemberModel.updateOne({ _id: memberId }, { $set: { points: 10 } });
    const placed = (await order({ memberId, redeemPoints: 10 })).order;
    await pay(placed.id, 20000);
    expect((await MemberModel.findById(memberId).orFail()).points).toBe(0);
    await pay(placed.id, 30000);
    expect(await PointEntryModel.countDocuments({ type: 'EARN' })).toBe(0);
    await serve(placed.id);
    expect((await MemberModel.findById(memberId).orFail()).points).toBe(5);
    expect((await OrderModel.findById(placed.id).orFail()).earnedPoints).toBe(5);
    await expect(transitionByStaff(placed.id, 'SERVED', { id: actor })).rejects.toBeTruthy();
    expect(await PointEntryModel.countDocuments({ type: 'EARN' })).toBe(1);
  });
  it('paid refund/cancel returns points and voucher slot without awarding points', async () => {
    await MemberModel.updateOne({ _id: memberId }, { $set: { points: 10 } });
    const first = (await order({ memberId, redeemPoints: 10 })).order;
    await pay(first.id);
    await refundAndCancelOrder(
      first.id,
      actor,
      (await OrderModel.findById(first.id).orFail()).version,
      50000,
      'CASH',
      'Khách hủy thử nghiệm',
    );
    expect((await MemberModel.findById(memberId).orFail()).points).toBe(10);
    await saveVoucher(null, voucher(), actor);
    const second = (await order({ voucherCode: 'SAVE10', memberId })).order;
    await pay(second.id);
    await refundAndCancelOrder(
      second.id,
      actor,
      (await OrderModel.findById(second.id).orFail()).version,
      50000,
      'CASH',
      'Khách hủy thử nghiệm',
    );
    expect((await VoucherModel.findOne().orFail()).usedCount).toBe(0);
    expect(await PointEntryModel.countDocuments({ type: 'EARN' })).toBe(0);
  });
  it('preserves discount in paid immutable bill, guest receipt and admin reprint after promotion changes', async () => {
    await MemberModel.updateOne({ _id: memberId }, { $set: { points: 10 } });
    await saveVoucher(null, voucher({ allowPointRedemption: true }), actor);
    const placed = (await order({ voucherCode: 'SAVE10', memberId, redeemPoints: 10 })).order;
    await pay(placed.id);
    await serve(placed.id);
    await unitOfWork.withTransaction(async (session) => {
      const tableSession = await TableSessionModel.findById(sid).session(session).orFail();
      await finalizeSessionBill(tableSession, actor, session);
      await TableSessionModel.updateOne(
        { _id: sid },
        { $set: { status: 'CLOSED', closedAt: new Date() } },
        { session },
      );
    });
    const bill = await BillModel.findOne().orFail();
    expect(bill.subtotal).toBe(60000);
    expect(bill.total).toBe(40000);
    expect(bill.paidAmount).toBe(40000);
    await VoucherModel.updateMany({}, { $set: { value: 40000, isActive: false } });
    expect((await buildBill(sid)).orders[0]?.voucherDiscount).toBe(10000);
    expect((await buildBill(sid)).orders[0]?.pointsDiscount).toBe(10000);
    const receipt = await buildParticipantReceipt(sid, placed.participantId);
    expect(receipt.orders[0]?.voucherCode).toBe('SAVE10');
    expect(receipt.total).toBe(40000);
    expect(receipt.orders[0]?.pointsDiscount).toBe(10000);
    expect((await getBillHistory(bill.id)).orders[0]?.voucherDiscount).toBe(10000);
    expect((await getBillHistory(bill.id)).orders[0]?.pointsDiscount).toBe(10000);
  });
  it('supports a zero-total voucher order and does not invent loyalty earnings', async () => {
    await saveVoucher(null, voucher({ value: 100000 }), actor);
    const placed = (await order({ voucherCode: 'SAVE10', memberId })).order;
    expect(placed.total).toBe(0);
    await pay(placed.id, 0);
    await serve(placed.id);
    expect((await MemberModel.findById(memberId).orFail()).points).toBe(0);
    expect((await VoucherUseModel.findOne().orFail()).state).toBe('CONSUMED');
  });
});
