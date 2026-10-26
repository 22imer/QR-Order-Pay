import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { buildApp } from '../../app.js';
import { config } from '../../config/index.js';
import { CupPhotoModel, CupPhotoOwnerModel, CupPrintAttemptModel } from '../../models/CupPhoto.js';
import { TableModel } from '../../models/Table.js';
import { TableSessionModel } from '../../models/TableSession.js';
import { GuestSessionModel } from '../../models/GuestSession.js';
import { UserModel } from '../../models/User.js';
import { CategoryModel } from '../../models/Category.js';
import { ProductModel } from '../../models/Product.js';
import { OrderModel } from '../../models/Order.js';
import { PaymentModel } from '../../models/Payment.js';
import { BillModel } from '../../models/Bill.js';
import { sha256, signAccessToken } from '../../utils/crypto.js';
import {
  normalizeCupPhoto,
  uploadCupPhoto,
  ownCupPhoto,
  photoOwner,
  cupPrintFeed,
  requestCupPrint,
  staffCupPhoto,
  exportCupLatteArt,
  type PhotoActor,
} from '../../services/cupPhotoService.js';
import { generateLatteArt, renderLatteArtVariants } from '../../services/latteArtService.js';
import { createOrderQuote } from '../../services/orderPricingService.js';
import { placeOrder, type PlaceOrderItemInput } from '../../services/orderService.js';
import { quotePickup, createPickup } from '../../services/pickupService.js';
import { createGift, decideGift } from '../../services/giftService.js';
import { toGuestOrder } from '../../services/orderDto.js';
import { auditRepository } from '../../repositories/auditRepository.js';

let repl: MongoMemoryReplSet,
  app: ReturnType<typeof buildApp>,
  actor: PhotoActor,
  png: Buffer,
  staff: string,
  staffToken: string,
  adminToken: string,
  sid: string,
  recipientSid: string,
  recipientTable: string,
  productId: string;
const item = (extra = {}): PlaceOrderItemInput => ({
  productId,
  variantId: null,
  sugarLevel: '50%',
  iceLevel: 'normal-ice',
  toppingIds: [],
  quantity: 2,
  note: '',
  ...extra,
});
const upload = (key: string = randomUUID()) => uploadCupPhoto(actor, key, png, 'image/png');
const command = (orderId: string, extra = {}) => ({
  requestId: randomUUID(),
  orderId,
  itemIndex: 0,
  copies: 2,
  paper: 'A4',
  ...extra,
});
async function orderWithPhoto(paid = false) {
  const photo = await upload(),
    items = [item({ cupPhotoId: photo.id })];
  const quote = await createOrderQuote({ tableSessionId: sid, participantId: 'guest-a', items });
  const result = await placeOrder({
    tableSessionId: sid,
    participantId: 'guest-a',
    items,
    idempotencyKey: randomUUID(),
    quoteToken: quote.quoteToken,
  });
  if (paid)
    await OrderModel.updateOne(
      { _id: result.order._id },
      { paymentStatus: 'PAID', status: 'PENDING', paidAmount: result.order.total },
    );
  return { order: await OrderModel.findById(result.order.id).orFail(), photo, items };
}
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(repl.getUri());
  app = buildApp();
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  png = await sharp({ create: { width: 200, height: 120, channels: 3, background: '#aa5522' } })
    .png()
    .toBuffer();
}, 120000);
beforeEach(async () => {
  vi.restoreAllMocks();
  for (const c of Object.values(mongoose.connection.collections)) await c.deleteMany({});
  const table = await TableModel.create({
    code: 'PH1',
    name: 'Bàn ảnh',
    capacity: 4,
    publicTokenHash: 'photo',
  });
  sid = (await TableSessionModel.create({ tableId: table._id })).id;
  actor = { owner: photoOwner(sid, 'guest-a'), tableSessionId: sid };
  for (const p of ['guest-a', 'guest-b'])
    await GuestSessionModel.create({
      tableSessionId: sid,
      participantId: p,
      tokenHash: sha256(`photo-${p}`),
      expiresAt: new Date(Date.now() + 3600000),
    });
  const target = await TableModel.create({
    code: 'PH2',
    name: 'Bàn nhận',
    capacity: 4,
    publicTokenHash: 'photo-target',
  });
  recipientTable = target.id;
  recipientSid = (await TableSessionModel.create({ tableId: target._id })).id;
  await GuestSessionModel.create({
    tableSessionId: recipientSid,
    participantId: 'receiver',
    tokenHash: sha256('photo-receiver'),
    expiresAt: new Date(Date.now() + 3600000),
  });
  const u = await UserModel.create({
    name: 'Staff',
    email: 'photo-staff@test.vn',
    role: 'STAFF',
    passwordHash: 'unused',
  });
  staff = u.id;
  staffToken = signAccessToken({ sub: staff, role: 'STAFF', name: u.name });
  const admin = await UserModel.create({
    name: 'Admin',
    email: 'photo-admin@test.vn',
    role: 'ADMIN',
    passwordHash: 'unused',
  });
  adminToken = signAccessToken({ sub: admin.id, role: 'ADMIN', name: admin.name });
  const category = await CategoryModel.create({ name: 'Cà phê', slug: 'coffee' });
  productId = (
    await ProductModel.create({
      categoryId: category._id,
      name: 'Cà phê',
      slug: 'coffee',
      image: '/favicon.svg',
      basePrice: 30000,
      allowedOptions: {
        sizes: [],
        sugarLevels: ['50%'],
        iceLevels: ['normal-ice'],
        toppingIds: [],
      },
    })
  ).id;
});
afterAll(async () => {
  await mongoose.disconnect();
  await repl.stop();
});
describe('private cup photo upload, binding and printable labels', () => {
  it('renders three deterministic coffee styles inside a white square without changing the source', async () => {
    const original = await sharp(
      Buffer.from(
        '<svg width="300" height="180"><rect width="150" height="180" fill="#222"/><rect x="150" width="150" height="180" fill="#ddd"/><circle cx="150" cy="90" r="35" fill="#777"/></svg>',
      ),
    )
      .png()
      .toBuffer();
    const copy = Buffer.from(original);
    const variants = await renderLatteArtVariants(original);
    expect(original.equals(copy)).toBe(true);
    expect(variants.map((variant) => variant.style)).toEqual(['SOFT', 'BOLD', 'DOTS']);
    expect(new Set(variants.map((variant) => sha256(variant.data.toString('base64')))).size).toBe(
      3,
    );
    for (const variant of variants) {
      const image = await sharp(variant.data).raw().toBuffer({ resolveWithObject: true });
      expect(image.info).toMatchObject({ width: 1024, height: 1024, channels: 3 });
      expect([...image.data.subarray(0, 3)]).toEqual([255, 255, 255]);
      const at = (x: number, y: number) => image.data[(y * 1024 + x) * 3]!;
      expect(at(280, 512)).toBeLessThan(at(730, 512));
    }
    expect((await renderLatteArtVariants(original)).map((v) => v.data)).toEqual(
      variants.map((v) => v.data),
    );
  });
  it('generates private variants once under concurrent retry, validates owner/body and rejects recursive effects', async () => {
    const source = await upload();
    const before = await ownCupPhoto(actor, source.id);
    const [one, two] = await Promise.all([
      generateLatteArt(actor, source.id, {}),
      generateLatteArt(actor, source.id, {}),
    ]);
    expect(one).toEqual(two);
    expect(one.variants).toHaveLength(3);
    expect(one.variants.every((v) => v.kind === 'LATTE_ART' && v.id !== source.id)).toBe(true);
    expect(await CupPhotoModel.countDocuments()).toBe(4);
    expect((await ownCupPhoto(actor, source.id)).equals(before)).toBe(true);
    await expect(
      generateLatteArt({ ...actor, owner: photoOwner(sid, 'guest-b') }, source.id, {}),
    ).rejects.toThrow();
    await expect(generateLatteArt(actor, source.id, { style: 'invented' })).rejects.toThrow();
    await expect(generateLatteArt(actor, one.variants[0]!.id, {})).rejects.toThrow();
    expect(await OrderModel.countDocuments()).toBe(0);
    expect(await PaymentModel.countDocuments()).toBe(0);
    expect(await BillModel.countDocuments()).toBe(0);
  });
  it('rolls back all generated images if the audit fails and refuses generation when the table is not open', async () => {
    const source = await upload();
    vi.spyOn(auditRepository, 'log').mockRejectedValueOnce(new Error('audit rollback'));
    await expect(generateLatteArt(actor, source.id, {})).rejects.toThrow('audit rollback');
    expect(await CupPhotoModel.countDocuments()).toBe(1);
    await TableSessionModel.updateOne({ _id: sid }, { status: 'CHECKOUT' });
    await expect(generateLatteArt(actor, source.id, {})).rejects.toThrow();
    expect(await CupPhotoModel.countDocuments()).toBe(1);
  });
  it('binds the selected latte design to one order and exports exact pixels only after payment, with replay and no financial changes', async () => {
    const source = await upload();
    const chosen = (await generateLatteArt(actor, source.id, {})).variants[1]!;
    const items = [item({ cupPhotoId: chosen.id })];
    const quote = await createOrderQuote({ tableSessionId: sid, participantId: 'guest-a', items });
    const placed = await placeOrder({
      tableSessionId: sid,
      participantId: 'guest-a',
      items,
      idempotencyKey: randomUUID(),
      quoteToken: quote.quoteToken,
    });
    const order = placed.order;
    const input = { requestId: randomUUID(), orderId: order.id, itemIndex: 0 };
    await expect(exportCupLatteArt(staff, input)).rejects.toThrow();
    expect(await CupPrintAttemptModel.countDocuments()).toBe(0);
    await OrderModel.updateOne(
      { _id: order.id },
      { status: 'PENDING', paymentStatus: 'PAID', paidAmount: order.total },
    );
    const before = await OrderModel.findById(order.id).orFail();
    const first = await exportCupLatteArt(staff, input),
      again = await exportCupLatteArt(staff, input);
    expect(first.data.equals(again.data)).toBe(true);
    expect(await sharp(first.data).metadata()).toMatchObject({
      format: 'png',
      width: 1024,
      height: 1024,
    });
    expect(await sharp(first.data).raw().toBuffer()).toEqual(
      await sharp(await ownCupPhoto(actor, chosen.id))
        .raw()
        .toBuffer(),
    );
    expect(first.filename).toContain('line-1.png');
    expect(await CupPrintAttemptModel.countDocuments()).toBe(1);
    expect((await cupPrintFeed(1)).items[0]!.items[0]).toMatchObject({
      kind: 'LATTE_ART',
      latteStyle: 'BOLD',
      attempts: 1,
    });
    const after = await OrderModel.findById(order.id).orFail();
    expect(after.toObject().items).toEqual(before.toObject().items);
    expect([after.total, after.paidAmount, after.status, after.paymentStatus]).toEqual([
      before.total,
      before.paidAmount,
      before.status,
      before.paymentStatus,
    ]);
    expect(await PaymentModel.countDocuments()).toBe(0);
    expect(await BillModel.countDocuments()).toBe(0);
    await expect(requestCupPrint(staff, command(order.id))).rejects.toThrow();
    await OrderModel.updateOne(
      { _id: order.id },
      { paymentStatus: 'REFUNDED', status: 'CANCELLED' },
    );
    await expect(exportCupLatteArt(staff, input)).rejects.toThrow();
  });
  it('guards latte HTTP generation, metadata and export with existing portal, owner, CSRF and paid-order rules', async () => {
    const source = await upload();
    const path = `/api/v1/cup-photos/${source.id}/latte-art`;
    expect((await request(app).post(path).send({})).status).toBe(401);
    expect(
      (
        await request(app)
          .post(path)
          .set('Cookie', 'mc_guest=photo-guest-a')
          .set('Origin', 'https://evil.test')
          .send({})
      ).status,
    ).toBe(403);
    expect(
      (await request(app).post(path).set('Cookie', 'mc_guest=photo-guest-b').send({})).status,
    ).toBe(404);
    const generated = await request(app)
      .post(path)
      .set('Cookie', 'mc_guest=photo-guest-a')
      .send({});
    expect(generated.status).toBe(200);
    expect(generated.headers['cache-control']).toBe('no-store');
    const id = generated.body.data.variants[0].id;
    const details = await request(app)
      .get(`/api/v1/cup-photos/${id}/details`)
      .set('Cookie', 'mc_guest=photo-guest-a');
    expect(details.body.data).toMatchObject({ kind: 'LATTE_ART', latteStyle: 'SOFT' });
    expect(JSON.stringify(details.body)).not.toMatch(
      /sourcePhotoId|sourceHash|requestId|owner|data:image/,
    );
    expect(
      (
        await request(app)
          .get(`/api/v1/cup-photos/${id}/details`)
          .set('Cookie', 'mc_guest=photo-guest-b')
      ).status,
    ).toBe(404);
    expect(
      (await request(app).post('/api/v1/staff/cup-prints/latte-art/exports').send({})).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post('/api/v1/admin/cup-prints/latte-art/exports')
          .auth(staffToken, { type: 'bearer' })
          .send({})
      ).status,
    ).toBe(403);
    const ordinary = await orderWithPhoto(true);
    expect(
      (
        await request(app)
          .post('/api/v1/staff/cup-prints/latte-art/exports')
          .auth(staffToken, { type: 'bearer' })
          .send({ requestId: randomUUID(), orderId: ordinary.order.id, itemIndex: 0 })
      ).status,
    ).toBe(422);
  });
  it('requires QR/member/staff, protects CSRF and portal/role separation before upload parsing', async () => {
    expect(
      (await request(app).post('/api/v1/cup-photos').set('Content-Type', 'image/png').send(png))
        .status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post('/api/v1/pickup/cup-photos')
          .set('Content-Type', 'image/png')
          .send(png)
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post('/api/v1/cup-photos')
          .set('Cookie', 'mc_guest=photo-guest-a')
          .set('Origin', 'https://evil.test')
          .set('Content-Type', 'image/png')
          .send(png)
      ).status,
    ).toBe(403);
    expect((await request(app).get('/api/v1/staff/cup-prints')).status).toBe(401);
    expect(
      (await request(app).get('/api/v1/admin/cup-prints').auth(staffToken, { type: 'bearer' }))
        .status,
    ).toBe(403);
    const old = config.trafficClass;
    try {
      Object.assign(config, { trafficClass: 'internal' });
      expect((await request(app).get('/api/v1/cup-photos/507f1f77bcf86cd799439011')).status).toBe(
        404,
      );
      Object.assign(config, { trafficClass: 'guest' });
      expect(
        (await request(app).get('/api/v1/admin/cup-prints').auth(adminToken, { type: 'bearer' }))
          .status,
      ).toBe(404);
    } finally {
      Object.assign(config, { trafficClass: old });
    }
  });
  it('serves only normalized JPEG with no-store and no original filename/metadata/public path', async () => {
    const response = await request(app)
      .post('/api/v1/cup-photos')
      .set('Cookie', 'mc_guest=photo-guest-a')
      .set('Idempotency-Key', randomUUID())
      .set('Content-Type', 'image/png')
      .send(png);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(Object.keys(response.body.data).sort()).toEqual(['expiresAt', 'height', 'id', 'width']);
    const id = response.body.data.id;
    const image = await request(app)
      .get(`/api/v1/cup-photos/${id}`)
      .set('Cookie', 'mc_guest=photo-guest-a');
    expect(image.status).toBe(200);
    expect(image.headers['content-type']).toMatch(/image\/jpeg/);
    expect(image.headers['cache-control']).toBe('no-store');
    expect(image.headers['x-content-type-options']).toBe('nosniff');
    expect((await sharp(image.body as Buffer).metadata()).format).toBe('jpeg');
    expect(
      (await request(app).get(`/api/v1/cup-photos/${id}`).set('Cookie', 'mc_guest=photo-guest-b'))
        .status,
    ).toBe(404);
    expect((await request(app).get(`/api/v1/cup-photos/${id}`)).status).toBe(401);
  });
  it('auto-orients and removes EXIF/ICC while bounding dimensions, preserving image aspect', async () => {
    const input = await sharp({
      create: { width: 1800, height: 1200, channels: 3, background: '#225588' },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const photo = await normalizeCupPhoto(input, 'image/jpeg'),
      meta = await sharp(photo.data).metadata();
    expect(photo.height).toBe(1024);
    expect(photo.width).toBe(683);
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
  });
  it('rejects vector/disguised/truncated/empty/oversized images and too many pixels', async () => {
    await expect(normalizeCupPhoto(Buffer.from('<svg/>'), 'image/svg+xml')).rejects.toMatchObject({
      status: 415,
    });
    await expect(normalizeCupPhoto(png, 'image/jpeg')).rejects.toMatchObject({ status: 422 });
    await expect(normalizeCupPhoto(png.subarray(0, 25), 'image/png')).rejects.toMatchObject({
      status: 422,
    });
    await expect(normalizeCupPhoto(Buffer.alloc(0), 'image/png')).rejects.toMatchObject({
      status: 413,
    });
    await expect(
      normalizeCupPhoto(Buffer.alloc(4 * 1024 * 1024 + 1), 'image/png'),
    ).rejects.toMatchObject({ status: 413 });
    const large = await sharp({
      create: { width: 4100, height: 4100, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    await expect(normalizeCupPhoto(large, 'image/png')).rejects.toMatchObject({ status: 422 });
    const tooSmall = await sharp({
      create: { width: 63, height: 100, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    await expect(normalizeCupPhoto(tooSmall, 'image/png')).rejects.toMatchObject({ status: 422 });
  });
  it('rejects animated WebP and invalid raw body types/size before they reach storage', async () => {
    const animation = await sharp([png, await sharp(png).negate().png().toBuffer()], {
      join: { animated: true },
    })
      .webp()
      .toBuffer();
    await expect(normalizeCupPhoto(animation, 'image/webp')).rejects.toMatchObject({ status: 422 });
    expect(
      (
        await request(app)
          .post('/api/v1/cup-photos')
          .set('Cookie', 'mc_guest=photo-guest-a')
          .set('Idempotency-Key', randomUUID())
          .set('Content-Type', 'image/svg+xml')
          .send('<svg/>')
      ).status,
    ).toBe(415);
    expect(
      (
        await request(app)
          .post('/api/v1/cup-photos')
          .set('Cookie', 'mc_guest=photo-guest-a')
          .set('Idempotency-Key', randomUUID())
          .set('Content-Type', 'image/png')
          .send(Buffer.alloc(4 * 1024 * 1024 + 1))
      ).status,
    ).toBe(413);
    expect(await CupPhotoModel.countDocuments()).toBe(0);
  });
  it('replays identical concurrent uploads but rejects changed bytes for the same key', async () => {
    const key = randomUUID();
    const [a, b] = await Promise.all([upload(key), upload(key)]);
    expect(a.id).toBe(b.id);
    expect(await CupPhotoModel.countDocuments()).toBe(1);
    await expect(
      uploadCupPhoto(actor, key, await sharp(png).negate().png().toBuffer(), 'image/png'),
    ).rejects.toMatchObject({ status: 409 });
    await expect(uploadCupPhoto(actor, 'invalid', png, 'image/png')).rejects.toThrow();
  });
  it('enforces daily quota under concurrent uploads and never creates financial records', async () => {
    const source = await upload();
    const data = await CupPhotoModel.findById(source.id).select('+data').orFail();
    await CupPhotoModel.insertMany(
      Array.from({ length: 18 }, () => ({
        owner: actor.owner,
        requestId: randomUUID(),
        sourceHash: 'fixture',
        data: data.data,
        width: 200,
        height: 120,
        expiresAt: new Date(Date.now() + 86400000),
      })),
    );
    const result = await Promise.allSettled([upload(), upload()]);
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await CupPhotoModel.countDocuments()).toBe(20);
    for (const model of [OrderModel, PaymentModel, BillModel])
      expect(await model.countDocuments()).toBe(0);
  });
  it('denies upload for checkout/closed sessions and expires images even before TTL cleanup', async () => {
    const photo = await upload();
    await CupPhotoModel.updateOne({ _id: photo.id }, { expiresAt: new Date(Date.now() - 1) });
    await expect(ownCupPhoto(actor, photo.id)).rejects.toMatchObject({ status: 404 });
    await TableSessionModel.updateOne({ _id: sid }, { status: 'CHECKOUT' });
    await expect(upload()).rejects.toMatchObject({ status: 403 });
    await TableSessionModel.updateOne({ _id: sid }, { status: 'CLOSED' });
    await expect(upload()).rejects.toMatchObject({ status: 403 });
  });
  it('binds to the exact quoted line, retains thirty days and exposes a flag without private image IDs', async () => {
    const { order, photo } = await orderWithPhoto();
    expect(String(order.items[0]!.cupPhotoId)).toBe(photo.id);
    expect(order.total).toBe(60000);
    expect((await CupPhotoModel.findById(photo.id).orFail()).expiresAt.getTime()).toBeGreaterThan(
      Date.now() + 29 * 86400000,
    );
    const dto = toGuestOrder(order);
    expect(dto.items[0]?.hasCupPhoto).toBe(true);
    expect(JSON.stringify(dto)).not.toContain(photo.id);
    expect((await cupPrintFeed(1)).items).toHaveLength(0);
    await expect(staffCupPhoto(order.id, 0)).rejects.toMatchObject({ status: 404 });
  });
  it('rejects cross-participant/expired attachments and changed image after quote', async () => {
    const photo = await upload();
    const items = [item({ cupPhotoId: photo.id })];
    await expect(
      createOrderQuote({ tableSessionId: sid, participantId: 'guest-b', items }),
    ).rejects.toMatchObject({ status: 422 });
    const quote = await createOrderQuote({ tableSessionId: sid, participantId: 'guest-a', items });
    const second = await upload();
    await expect(
      placeOrder({
        tableSessionId: sid,
        participantId: 'guest-a',
        items: [item({ cupPhotoId: second.id })],
        idempotencyKey: randomUUID(),
        quoteToken: quote.quoteToken,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await CupPhotoModel.updateOne({ _id: photo.id }, { expiresAt: new Date(Date.now() - 1) });
    await expect(
      placeOrder({
        tableSessionId: sid,
        participantId: 'guest-a',
        items,
        idempotencyKey: randomUUID(),
        quoteToken: quote.quoteToken,
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(await OrderModel.countDocuments()).toBe(0);
  });
  it('uses member/counter owner scopes in pickup quote and placement', async () => {
    const owner = { owner: `counter:${staff}`, userId: staff };
    const photo = await uploadCupPhoto(owner, randomUUID(), png, 'image/png');
    const body = {
      requestId: randomUUID(),
      pickup: {
        fulfillmentType: 'TAKEAWAY',
        name: 'Khách',
        phone: '0901234567',
        scheduledAt: null,
      },
      items: [item({ cupPhotoId: photo.id })],
    };
    const quote = await quotePickup({ staff: true, id: staff }, body);
    const order = await createPickup(
      { staff: true, id: staff },
      { ...body, quoteToken: quote.quoteToken },
    );
    expect(String(order.order.items[0]!.cupPhotoId)).toBe(photo.id);
    await expect(ownCupPhoto(actor, photo.id)).rejects.toMatchObject({ status: 404 });
    const memberPhoto = await uploadCupPhoto(
      { owner: 'member:fixture' },
      randomUUID(),
      png,
      'image/png',
    );
    expect(await ownCupPhoto({ owner: 'member:fixture' }, memberPhoto.id)).toBeTruthy();
    await expect(
      quotePickup(
        { staff: true, id: staff },
        { ...body, items: [item({ cupPhotoId: memberPhoto.id })] },
      ),
    ).rejects.toMatchObject({ status: 422 });
  });
  it('keeps gift images immutable, hides private IDs from receiver and binds sender order', async () => {
    const photo = await upload(),
      items = [item({ cupPhotoId: photo.id })];
    const gift = await createGift(
      { tableSessionId: sid, participantId: 'guest-a' },
      {
        requestId: randomUUID(),
        recipientTableId: recipientTable,
        recipientSessionId: recipientSid,
        items,
      },
    );
    expect(gift.items[0]?.cupPhotoId).toBe(photo.id);
    const received = await decideGift(
      { tableSessionId: recipientSid, participantId: 'receiver' },
      gift.id,
      { expectedVersion: 0, decision: 'ACCEPT' },
    );
    expect(received.items[0]?.hasCupPhoto).toBe(true);
    expect(JSON.stringify(received)).not.toContain(photo.id);
    const quote = await createOrderQuote({ tableSessionId: sid, participantId: 'guest-a', items });
    const result = await placeOrder({
      tableSessionId: sid,
      participantId: 'guest-a',
      giftId: gift.id,
      items,
      quoteToken: quote.quoteToken,
      idempotencyKey: randomUUID(),
    });
    expect(String(result.order.items[0]!.cupPhotoId)).toBe(photo.id);
  });
  it('lists only paid live orders with availability and serves protected print bytes', async () => {
    const { order, photo } = await orderWithPhoto(true);
    const feed = await cupPrintFeed('1');
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0]?.items[0]).toMatchObject({
      index: 0,
      quantity: 2,
      available: true,
      attempts: 0,
    });
    expect(JSON.stringify(feed)).not.toContain(photo.id);
    expect(await staffCupPhoto(order.id, 0)).toBeTruthy();
    const image = await request(app)
      .get(`/api/v1/staff/cup-prints/${order.id}/0/image`)
      .auth(staffToken, { type: 'bearer' });
    expect(image.status).toBe(200);
    expect(image.headers['cache-control']).toBe('no-store');
    await expect(staffCupPhoto(order.id, 1)).rejects.toMatchObject({ status: 404 });
    await CupPhotoModel.updateOne({ _id: photo.id }, { expiresAt: new Date(Date.now() - 1) });
    expect((await cupPrintFeed(1)).items[0]?.items[0]?.available).toBe(false);
    await expect(staffCupPhoto(order.id, 0)).rejects.toMatchObject({ status: 404 });
  });
  it('journals print intent once on replay, permits explicit reprint but never marks actual printer success', async () => {
    const { order } = await orderWithPhoto(true),
      body = command(order.id),
      beforeTotal = order.total;
    const [a, b] = await Promise.all([requestCupPrint(staff, body), requestCupPrint(staff, body)]);
    expect(a.id).toBe(b.id);
    expect(a.state).toBe('REQUESTED');
    expect(await CupPrintAttemptModel.countDocuments()).toBe(1);
    await expect(requestCupPrint(staff, { ...body, copies: 1 })).rejects.toMatchObject({
      status: 409,
    });
    await requestCupPrint(staff, command(order.id));
    expect((await cupPrintFeed(1)).items[0]?.items[0]?.attempts).toBe(2);
    const saved = await OrderModel.findById(order.id).orFail();
    expect(saved.total).toBe(beforeTotal);
    expect(saved.status).toBe('PENDING');
    expect(await PaymentModel.countDocuments()).toBe(0);
    expect(await BillModel.countDocuments()).toBe(0);
  });
  it('rejects excess copies/cancelled/refunded orders, including replay after cancellation', async () => {
    const { order } = await orderWithPhoto(true);
    await expect(requestCupPrint(staff, command(order.id, { copies: 3 }))).rejects.toMatchObject({
      status: 422,
    });
    const body = command(order.id);
    await requestCupPrint(staff, body);
    await OrderModel.updateOne(
      { _id: order._id },
      { status: 'CANCELLED', paymentStatus: 'REFUNDED' },
    );
    expect((await cupPrintFeed(1)).items).toHaveLength(0);
    await expect(requestCupPrint(staff, body)).rejects.toMatchObject({ status: 404 });
  });
  it('rolls back normalized storage and print journals on audit failure', async () => {
    vi.spyOn(auditRepository, 'log').mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(upload()).rejects.toThrow('audit unavailable');
    expect(await CupPhotoModel.countDocuments()).toBe(0);
    expect(await CupPhotoOwnerModel.countDocuments()).toBe(0);
    const { order } = await orderWithPhoto(true),
      version = order.version;
    vi.spyOn(auditRepository, 'log').mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(requestCupPrint(staff, command(order.id))).rejects.toThrow('audit unavailable');
    expect(await CupPrintAttemptModel.countDocuments()).toBe(0);
    expect((await OrderModel.findById(order.id).orFail()).version).toBe(version);
  });
});
