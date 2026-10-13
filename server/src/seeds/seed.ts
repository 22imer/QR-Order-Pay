/**
 * Demo seed for Mây Café.
 * - Creates categories, products (24+), toppings, tables, users
 * - Generates ~100 orders/payments across 30 days
 * - Creates one OPEN table session for live demo
 */
import mongoose from 'mongoose';
import { hashPassword, randomToken, sha256, randomShortCode } from '../utils/crypto.js';
import { config } from '../config/index.js';
import { CategoryModel } from '../models/Category.js';
import { ProductModel } from '../models/Product.js';
import { ToppingModel } from '../models/Topping.js';
import { TableModel } from '../models/Table.js';
import { UserModel } from '../models/User.js';
import { OrderModel } from '../models/Order.js';
import { PaymentModel } from '../models/Payment.js';
import { TableSessionModel } from '../models/TableSession.js';
import { ReviewModel } from '../models/Review.js';
import { AuditLogModel } from '../models/AuditLog.js';
import { ServiceRequestModel } from '../models/ServiceRequest.js';
import { GuestSessionModel } from '../models/GuestSession.js';
import { RefreshSessionModel } from '../models/RefreshSession.js';
import { connectMongo, disconnectMongo } from '../infrastructure/mongo.js';
import { logger } from '../infrastructure/logger.js';

const STAFF_PASSWORD = config.seedDemoPassword;

const CATEGORIES = [
  { name: 'Cà phê', slug: 'cafe' },
  { name: 'Trà & Trà sữa', slug: 'tra' },
  { name: 'Đồ xay & Sinh tố', slug: 'sinh-to' },
  { name: 'Nước ép', slug: 'nuoc-ep' },
  { name: 'Bánh ngọt', slug: 'banh' },
];

const SEED = 20260101;
function rng(): () => number {
  let s = SEED;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}
const rand = rng();
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)] as T;
}

const TOPPINGS = [
  { name: 'Trân châu đen', price: 8000, isAvailable: true, isArchived: false },
  { name: 'Trân châu trắng', price: 8000, isAvailable: true, isArchived: false },
  { name: 'Thạch cà phê', price: 9000, isAvailable: true, isArchived: false },
  { name: 'Pudding trứng', price: 12000, isAvailable: true, isArchived: false },
  { name: 'Kem cheese', price: 15000, isAvailable: true, isArchived: false },
  { name: 'Sốt caramel', price: 7000, isAvailable: true, isArchived: false },
];

const PRODUCTS: Array<Record<string, unknown>> = [
  // Cafe
  {
    categorySlug: 'cafe',
    name: 'Espresso Mây',
    slug: 'espresso-may',
    description: 'Espresso đậm đà, hậu chocolate, phù hợp buổi sáng.',
    image: 'https://images.unsplash.com/photo-1510707577719-ae7c14805e3a?w=600&q=70&auto=format',
    basePrice: 35000,
    variants: [
      { name: 'S', price: 35000, isAvailable: true },
      { name: 'M', price: 45000, isAvailable: true },
      { name: 'L', price: 55000, isAvailable: true },
    ],
    sizes: ['S', 'M', 'L'],
    toppingIds: [],
    caffeine: true,
    dairy: false,
    flavor: ['đắng', 'đậm'],
    tags: ['signature', 'no-dairy'],
    featured: true,
  },
  {
    categorySlug: 'cafe',
    name: 'Bạc Xỉu Đá',
    slug: 'bac-xiu-da',
    description: 'Bạc xỉu truyền thống, sữa đặc, cà phê robusta.',
    image: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=600&q=70&auto=format',
    basePrice: 38000,
    variants: [{ name: 'M', price: 38000, isAvailable: true }],
    sizes: ['M'],
    toppingIds: ['pudding'],
    caffeine: true,
    dairy: true,
    flavor: ['ngọt', 'đậm'],
    tags: ['best-seller'],
    featured: true,
  },
  {
    categorySlug: 'cafe',
    name: 'Cà phê Dừa',
    slug: 'ca-phe-dua',
    description: 'Cà phê Việt kết hợp cốt dừa béo, ít ngọt.',
    image: 'https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=600&q=70&auto=format',
    basePrice: 45000,
    variants: [{ name: 'M', price: 45000, isAvailable: true }],
    sizes: ['M'],
    toppingIds: [],
    caffeine: true,
    dairy: true,
    flavor: ['ngọt', 'béo'],
    tags: ['signature'],
    featured: true,
  },
  {
    categorySlug: 'cafe',
    name: 'Americano',
    slug: 'americano',
    description: 'Espresso pha loãng với nước nóng, hậu nhẹ.',
    image: 'https://images.unsplash.com/photo-1517701604599-bb29b565090c?w=600&q=70&auto=format',
    basePrice: 32000,
    variants: [
      { name: 'M', price: 32000, isAvailable: true },
      { name: 'L', price: 42000, isAvailable: true },
    ],
    sizes: ['M', 'L'],
    toppingIds: [],
    caffeine: true,
    dairy: false,
    flavor: ['đắng nhẹ'],
    tags: [],
  },
  {
    categorySlug: 'cafe',
    name: 'Cappuccino',
    slug: 'cappuccino',
    description: 'Espresso, sữa nóng, bọt sữa mịn.',
    image: 'https://images.unsplash.com/photo-1534778101976-62847782c213?w=600&q=70&auto=format',
    basePrice: 48000,
    variants: [{ name: 'M', price: 48000, isAvailable: true }],
    sizes: ['M'],
    toppingIds: [],
    caffeine: true,
    dairy: true,
    flavor: ['béo', 'ngọt nhẹ'],
    tags: [],
  },
  // Tra
  {
    categorySlug: 'tra',
    name: 'Trà Đào Cam Sả',
    slug: 'tra-dao-cam-sa',
    description: 'Trào đào tươi, cam vàng, sả thơm.',
    image: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=600&q=70&auto=format',
    basePrice: 42000,
    variants: [
      { name: 'M', price: 42000, isAvailable: true },
      { name: 'L', price: 52000, isAvailable: true },
    ],
    sizes: ['M', 'L'],
    toppingIds: ['tran-chau-trang'],
    caffeine: false,
    dairy: false,
    flavor: ['chua', 'thơm'],
    tags: ['best-seller', 'no-caffeine', 'no-dairy'],
    featured: true,
  },
  {
    categorySlug: 'tra',
    name: 'Trà Vải Hoa Hồng',
    slug: 'tra-vai-hoa-hong',
    description: 'Trà vải, syrup hoa hồng, thanh nhẹ.',
    image: 'https://images.unsplash.com/photo-1595981234057-1cb4ffa6c64b?w=600&q=70&auto=format',
    basePrice: 45000,
    variants: [{ name: 'M', price: 45000, isAvailable: true }],
    sizes: ['M'],
    toppingIds: ['thach-ca-phe'],
    caffeine: false,
    dairy: false,
    flavor: ['chua', 'hoa'],
    tags: ['no-caffeine'],
  },
  {
    categorySlug: 'tra',
    name: 'Trà Sữa Oolong',
    slug: 'tra-sua-oolong',
    description: 'Trà oolong ủ lạnh, sữa tươi, vị chát dịu.',
    image: 'https://images.unsplash.com/photo-1571805341302-f857308690e3?w=600&q=70&auto=format',
    basePrice: 45000,
    variants: [{ name: 'M', price: 45000, isAvailable: true }],
    sizes: ['M'],
    toppingIds: ['tran-chau-den', 'pudding'],
    caffeine: true,
    dairy: true,
    flavor: ['chát', 'béo'],
    tags: [],
  },
  {
    categorySlug: 'tra',
    name: 'Trà Xanh Matcha Latte',
    slug: 'matcha-latte',
    description: 'Matcha Nhật, sữa tươi, không ngọt đường.',
    image: 'https://images.unsplash.com/photo-1536013455834-d44bbf3c8b06?w=600&q=70&auto=format',
    basePrice: 55000,
    variants: [{ name: 'M', price: 55000, isAvailable: true }],
    sizes: ['M'],
    toppingIds: [],
    caffeine: true,
    dairy: true,
    flavor: ['đắng nhẹ', 'béo'],
    tags: [],
  },
  // Sinh to
  {
    categorySlug: 'sinh-to',
    name: 'Sinh tố Bơ',
    slug: 'sinh-to-bo',
    description: 'Bơ sáp Đắk Lắk, sữa đặc, đá xay mịn.',
    image: 'https://images.unsplash.com/photo-1623065422902-30a2d299bbe4?w=600&q=70&auto=format',
    basePrice: 50000,
    variants: [{ name: 'L', price: 50000, isAvailable: true }],
    sizes: ['L'],
    toppingIds: [],
    caffeine: false,
    dairy: true,
    flavor: ['béo', 'ngọt'],
    tags: ['fruit'],
  },
  {
    categorySlug: 'sinh-to',
    name: 'Sinh tố Xoài',
    slug: 'sinh-to-xoai',
    description: 'Xoài chín, sữa tươi, đá xay.',
    image: 'https://images.unsplash.com/photo-1546039907-7fa05f864c02?w=600&q=70&auto=format',
    basePrice: 48000,
    variants: [{ name: 'L', price: 48000, isAvailable: true }],
    sizes: ['L'],
    toppingIds: [],
    caffeine: false,
    dairy: true,
    flavor: ['chua nhẹ', 'ngọt'],
    tags: ['fruit'],
  },
  {
    categorySlug: 'sinh-to',
    name: 'Sinh tố Dâu',
    slug: 'sinh-to-dau',
    description: 'Dâu tây Đà Lạt, sữa chua, mật ong.',
    image: 'https://images.unsplash.com/photo-1623065422902-30a2d299bbe4?w=600&q=70&auto=format',
    basePrice: 55000,
    variants: [{ name: 'L', price: 55000, isAvailable: true }],
    sizes: ['L'],
    toppingIds: [],
    caffeine: false,
    dairy: true,
    flavor: ['chua', 'ngọt'],
    tags: ['fruit'],
  },
  // Nuoc ep
  {
    categorySlug: 'nuoc-ep',
    name: 'Nước ép Cam',
    slug: 'nuoc-ep-cam',
    description: 'Cam tươi vắt, không đường.',
    image: 'https://images.unsplash.com/photo-1600271886742-f049cd451bba?w=600&q=70&auto=format',
    basePrice: 40000,
    variants: [{ name: 'M', price: 40000, isAvailable: true }],
    sizes: ['M'],
    toppingIds: [],
    caffeine: false,
    dairy: false,
    flavor: ['chua', 'tươi'],
    tags: ['fruit', 'no-caffeine', 'no-dairy', 'low-sugar'],
    featured: true,
  },
  {
    categorySlug: 'nuoc-ep',
    name: 'Nước ép Dưa hấu',
    slug: 'nuoc-ep-dua-hau',
    description: 'Dưa hấu tươi mát, không đá.',
    image: 'https://images.unsplash.com/photo-1502741224143-90386d7f8c82?w=600&q=70&auto=format',
    basePrice: 35000,
    variants: [{ name: 'M', price: 35000, isAvailable: true }],
    sizes: ['M'],
    toppingIds: [],
    caffeine: false,
    dairy: false,
    flavor: ['ngọt nhẹ'],
    tags: ['fruit', 'no-caffeine', 'no-dairy'],
  },
  {
    categorySlug: 'nuoc-ep',
    name: 'Nước ép Cà rốt',
    slug: 'nuoc-ep-ca-rot',
    description: 'Cà rốt, cam, gừng nhẹ.',
    image: 'https://images.unsplash.com/photo-1622597467836-f3285f2131b8?w=600&q=70&auto=format',
    basePrice: 45000,
    variants: [{ name: 'M', price: 45000, isAvailable: true }],
    sizes: ['M'],
    toppingIds: [],
    caffeine: false,
    dairy: false,
    flavor: ['ngọt'],
    tags: ['fruit'],
  },
  // Banh
  {
    categorySlug: 'banh',
    name: 'Bánh Croissant',
    slug: 'croissant',
    description: 'Bánh sừng bò bơ Pháp, nướng trong ngày.',
    image: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=600&q=70&auto=format',
    basePrice: 35000,
    variants: [],
    sizes: [],
    toppingIds: [],
    caffeine: false,
    dairy: true,
    flavor: ['béo'],
    tags: [],
    available: true,
  },
  {
    categorySlug: 'banh',
    name: 'Bánh Tiramisu',
    slug: 'tiramisu',
    description: 'Tiramisu cà phê, mascarpone, cacao.',
    image: 'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?w=600&q=70&auto=format',
    basePrice: 55000,
    variants: [],
    sizes: [],
    toppingIds: [],
    caffeine: true,
    dairy: true,
    flavor: ['đắng', 'béo'],
    tags: [],
  },
  {
    categorySlug: 'banh',
    name: 'Bánh Mousse Chanh dây',
    slug: 'mousse-chanh-day',
    description: 'Mousse chanh dây chua nhẹ, vỏ biscuit.',
    image: 'https://images.unsplash.com/photo-1565958011703-44f9829ba187?w=600&q=70&auto=format',
    basePrice: 48000,
    variants: [],
    sizes: [],
    toppingIds: [],
    caffeine: false,
    dairy: true,
    flavor: ['chua', 'béo'],
    tags: [],
  },
  {
    categorySlug: 'cafe',
    name: 'Cold Brew Cam',
    slug: 'cold-brew-cam',
    description: 'Cold brew ủ 12 giờ, kết hợp cam tươi.',
    image: 'https://images.unsplash.com/photo-1517701604599-bb29b565090c?w=600&q=70&auto=format',
    basePrice: 52000,
    variants: [{ name: 'L', price: 52000, isAvailable: true }],
    sizes: ['L'],
    toppingIds: [],
    caffeine: true,
    dairy: false,
    flavor: ['đắng nhẹ', 'chua'],
    tags: ['no-dairy'],
  },
  {
    categorySlug: 'cafe',
    name: 'Latte Hazelnut',
    slug: 'latte-hazelnut',
    description: 'Latte vị hạt phỉ, ít đường.',
    image: 'https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=600&q=70&auto=format',
    basePrice: 52000,
    variants: [{ name: 'M', price: 52000, isAvailable: true }],
    sizes: ['M'],
    toppingIds: [],
    caffeine: true,
    dairy: true,
    flavor: ['ngọt nhẹ', 'béo'],
    tags: [],
  },
  {
    categorySlug: 'cafe',
    name: 'Mocha',
    slug: 'mocha',
    description: 'Espresso, sữa, sốt chocolate.',
    image: 'https://images.unsplash.com/photo-1572442388796-11668a67e53d?w=600&q=70&auto=format',
    basePrice: 52000,
    variants: [{ name: 'M', price: 52000, isAvailable: true }],
    sizes: ['M'],
    toppingIds: ['kem-cheese'],
    caffeine: true,
    dairy: true,
    flavor: ['ngọt', 'đắng nhẹ'],
    tags: [],
  },
  {
    categorySlug: 'tra',
    name: 'Hồng Trà Sữa',
    slug: 'hong-tra-sua',
    description: 'Hồng trà sữa truyền thống, đá viên.',
    image: 'https://images.unsplash.com/photo-1571805341302-f857308690e3?w=600&q=70&auto=format',
    basePrice: 38000,
    variants: [{ name: 'M', price: 38000, isAvailable: true }],
    sizes: ['M'],
    toppingIds: ['tran-chau-den'],
    caffeine: true,
    dairy: true,
    flavor: ['ngọt'],
    tags: [],
  },
  {
    categorySlug: 'sinh-to',
    name: 'Smoothie Berry',
    slug: 'smoothie-berry',
    description: 'Việt quất, dâu, chuối, sữa chua.',
    image: 'https://images.unsplash.com/photo-1502741224143-90386d7f8c82?w=600&q=70&auto=format',
    basePrice: 60000,
    variants: [{ name: 'L', price: 60000, isAvailable: true }],
    sizes: ['L'],
    toppingIds: [],
    caffeine: false,
    dairy: true,
    flavor: ['chua', 'ngọt'],
    tags: ['fruit'],
  },
  {
    categorySlug: 'banh',
    name: 'Bánh Cookie Socola',
    slug: 'cookie-socola',
    description: 'Cookie chip socola đen, giòn ngoài mềm trong.',
    image: 'https://images.unsplash.com/photo-1499636136210-6f4ee915583e?w=600&q=70&auto=format',
    basePrice: 28000,
    variants: [],
    sizes: [],
    toppingIds: [],
    caffeine: false,
    dairy: true,
    flavor: ['ngọt'],
    tags: [],
  },
  {
    categorySlug: 'cafe',
    name: 'Cà phê Sữa Đá (Hết)',
    slug: 'ca-phe-sua-da',
    description: 'Tạm hết nguyên liệu cho ca sáng nay.',
    image: 'https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=600&q=70&auto=format',
    basePrice: 29000,
    variants: [{ name: 'M', price: 29000, isAvailable: false }],
    sizes: ['M'],
    toppingIds: [],
    caffeine: true,
    dairy: true,
    flavor: ['đậm', 'ngọt'],
    tags: [],
    available: false,
  },
];

export async function seed(): Promise<void> {
  await connectMongo();
  logger.info('clearing collections...');
  await Promise.all([
    CategoryModel.deleteMany({}),
    ProductModel.deleteMany({}),
    ToppingModel.deleteMany({}),
    TableModel.deleteMany({}),
    UserModel.deleteMany({}),
    OrderModel.deleteMany({}),
    PaymentModel.deleteMany({}),
    TableSessionModel.deleteMany({}),
    ReviewModel.deleteMany({}),
    AuditLogModel.deleteMany({}),
    ServiceRequestModel.deleteMany({}),
    GuestSessionModel.deleteMany({}),
    RefreshSessionModel.deleteMany({}),
  ]);

  logger.info('seeding categories...');
  const cats = await CategoryModel.insertMany(
    CATEGORIES.map((c, idx) => ({ ...c, sortOrder: idx, isActive: true })),
  );
  const catMap = new Map(cats.map((c) => [c.slug, c._id]));

  logger.info('seeding toppings...');
  const toppings = await ToppingModel.insertMany(TOPPINGS);
  const toppingMap = new Map<string, string>();
  for (const t of toppings) {
    toppingMap.set(t.name, t._id.toString());
    toppingMap.set(t.name.toLowerCase().split(' ')[0] ?? t.name, t._id.toString());
    toppingMap.set(slugify(t.name), t._id.toString());
  }
  function toppingId(name: string): string | undefined {
    return toppingMap.get(name) ?? toppingMap.get(name.toLowerCase().split(' ')[0] ?? name);
  }
  function slugify(s: string): string {
    return s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  logger.info('seeding products...');
  const productDocs = PRODUCTS.map((p, idx) => {
    const toppingIdsRaw = (p.toppingIds as string[] | undefined) ?? [];
    const toppingIdsResolved = toppingIdsRaw.map((n) => toppingId(n)).filter(Boolean) as string[];
    return {
      categoryId: catMap.get(p.categorySlug as string),
      name: p.name,
      slug: p.slug,
      description: p.description,
      image: p.image,
      basePrice: p.basePrice,
      variants: p.variants ?? [],
      allowedOptions: {
        sizes: p.sizes ?? [],
        sugarLevels: ['0%', '30%', '50%', '70%', '100%'],
        iceLevels: ['no-ice', 'less-ice', 'normal-ice'],
        toppingIds: toppingIdsResolved,
      },
      toppingIds: toppingIdsResolved,
      tags: p.tags ?? [],
      ingredientMetadata: {
        caffeine: !!p.caffeine,
        dairy: !!p.dairy,
        flavorProfile: (p.flavor as string[]) ?? [],
        allergens: [],
        notes: '',
      },
      isAvailable: p.available === false ? false : true,
      isArchived: false,
      isFeatured: !!p.featured,
      sortOrder: idx,
    };
  });
  await ProductModel.insertMany(productDocs);

  logger.info('seeding users...');
  const adminHash = await hashPassword(STAFF_PASSWORD);
  const staffHash = await hashPassword(STAFF_PASSWORD);
  await UserModel.insertMany([
    {
      name: 'Admin Mây',
      email: 'admin@maycafe.vn',
      passwordHash: adminHash,
      role: 'ADMIN',
      isActive: true,
    },
    {
      name: 'Nhân viên A',
      email: 'staff.a@maycafe.vn',
      passwordHash: staffHash,
      role: 'STAFF',
      isActive: true,
    },
    {
      name: 'Nhân viên B',
      email: 'staff.b@maycafe.vn',
      passwordHash: staffHash,
      role: 'STAFF',
      isActive: true,
    },
  ]);

  logger.info('seeding tables...');
  const tables = [];
  for (let i = 1; i <= 10; i++) {
    const publicToken = randomToken(24);
    const displayToken = randomToken(32);
    tables.push({
      code: `B${i.toString().padStart(2, '0')}`,
      name: `Bàn ${i.toString().padStart(2, '0')}`,
      capacity: i % 2 === 0 ? 4 : 2,
      publicTokenHash: sha256(publicToken),
      displayTokenHash: sha256(displayToken),
      isActive: true,
    });
    // Demo-only credential: show it to the operator, but never send it through
    // the structured application logger where logs may be retained centrally.
    process.stdout.write(
      `Table ${i.toString().padStart(2, '0')} display setup (operator only): ${config.publicAppUrl}/display#${displayToken}\n`,
    );
  }
  await TableModel.insertMany(tables);

  logger.info('seeding historical orders (30 days)...');
  const productList = await ProductModel.find();
  const staffUser = await UserModel.findOne({ role: 'STAFF' });
  if (!staffUser) throw new Error('staff user not found');

  const orderStatuses = [
    'PENDING',
    'CONFIRMED',
    'PREPARING',
    'READY',
    'SERVED',
    'CANCELLED',
  ] as const;
  const orders: unknown[] = [];
  const payments: unknown[] = [];

  for (let d = 0; d < 30; d++) {
    const date = new Date();
    date.setDate(date.getDate() - d);
    const count = 2 + Math.floor(rand() * 4); // 2..5 orders per day
    for (let k = 0; k < count; k++) {
      const product = pick(productList.filter((p) => p.isAvailable));
      if (!product) continue;
      const variant = product.variants.length > 0 ? pick(product.variants) : null;
      const toppingCount = Math.floor(rand() * 3);
      const toppingIds = [];
      for (let t = 0; t < toppingCount; t++) {
        const tpick = pick(toppings);
        toppingIds.push(tpick._id);
      }
      const qty = 1 + Math.floor(rand() * 3);
      const unit = variant?.price ?? product.basePrice;
      const toppingSum = toppingIds.reduce((s, id) => {
        const tp = toppings.find((x) => x._id.equals(id));
        return s + (tp?.price ?? 0);
      }, 0);
      const unitPrice = unit + toppingSum;
      const lineTotal = unitPrice * qty;
      const total = lineTotal;
      const createdAt = new Date(date);
      createdAt.setHours(8 + Math.floor(rand() * 12));
      createdAt.setMinutes(Math.floor(rand() * 60));
      const status = d === 0 ? 'SERVED' : pick([...orderStatuses]);
      const isPaid = status === 'SERVED' && rand() > 0.1;
      const paymentStatus = isPaid
        ? 'PAID'
        : status === 'CANCELLED'
          ? 'UNPAID'
          : pick(['UNPAID', 'UNPAID', 'PAID']);
      const code = `MC${randomShortCode(5)}`;
      const orderId = new mongoose.Types.ObjectId();
      const history: unknown[] = [
        {
          from: null,
          to: 'PENDING',
          at: createdAt,
          by: null,
          byParticipantId: 'demo-participant',
          reason: '',
        },
      ];
      if (status !== 'PENDING')
        history.push({
          from: 'PENDING',
          to: 'CONFIRMED',
          at: new Date(createdAt.getTime() + 60000),
          by: staffUser._id,
          byParticipantId: null,
          reason: '',
        });
      if (['PREPARING', 'READY', 'SERVED'].includes(status))
        history.push({
          from: 'CONFIRMED',
          to: 'PREPARING',
          at: new Date(createdAt.getTime() + 120000),
          by: staffUser._id,
          byParticipantId: null,
          reason: '',
        });
      if (['READY', 'SERVED'].includes(status))
        history.push({
          from: 'PREPARING',
          to: 'READY',
          at: new Date(createdAt.getTime() + 180000),
          by: staffUser._id,
          byParticipantId: null,
          reason: '',
        });
      if (status === 'SERVED')
        history.push({
          from: 'READY',
          to: 'SERVED',
          at: new Date(createdAt.getTime() + 240000),
          by: staffUser._id,
          byParticipantId: null,
          reason: '',
        });
      if (status === 'CANCELLED')
        history.push({
          from: 'PENDING',
          to: 'CANCELLED',
          at: new Date(createdAt.getTime() + 30000),
          by: null,
          byParticipantId: 'demo-participant',
          reason: 'demo',
        });

      const sessionId = new mongoose.Types.ObjectId();
      const tableId = (await TableModel.findOne())!._id;
      orders.push({
        _id: orderId,
        code,
        tableSessionId: sessionId,
        participantId: 'demo-participant',
        tableId,
        items: [
          {
            productId: product._id,
            variantId: variant?._id ?? null,
            sizeName: variant?.name ?? null,
            sugarLevel: pick(['0%', '50%', '100%']),
            iceLevel: pick(['no-ice', 'less-ice', 'normal-ice']),
            toppingIds,
            note: '',
            quantity: qty,
            unitPrice,
            lineTotal,
            nameSnapshot: product.name,
            variantNameSnapshot: variant?.name ?? '',
          },
        ],
        total,
        status,
        paymentStatus,
        statusHistory: history,
        idempotencyKey: `seed-${orderId}`,
        requestHash: 'seed',
        version: 0,
        cancelReason: status === 'CANCELLED' ? 'demo' : '',
        createdAt,
        updatedAt: createdAt,
      });
      if (paymentStatus === 'PAID') {
        payments.push({
          tableSessionId: sessionId,
          orderIds: [orderId],
          amount: total,
          method: pick(['CASH', 'BANK_TRANSFER', 'OTHER']),
          status: 'SUCCESS',
          confirmedBy: staffUser._id,
          paidAt: new Date(createdAt.getTime() + 300000),
          idempotencyKey: `seed-pay-${orderId}`,
          note: 'seed',
        });
      }
    }
  }
  await OrderModel.insertMany(orders);
  await PaymentModel.insertMany(payments);

  // Open one demo table session for table B01
  const demoTable = await TableModel.findOne({ code: 'B01' });
  if (demoTable) {
    const session = await TableSessionModel.create({
      tableId: demoTable._id,
      status: 'OPEN',
      startedAt: new Date(),
      openedBy: staffUser._id,
      version: 0,
    });
    logger.info(
      { sessionId: session._id.toString(), code: demoTable.code },
      'demo OPEN session ready',
    );
  }

  await disconnectMongo();
  logger.info('Seed done.');
  process.stdout.write(
    [
      `Demo accounts (password: ${STAFF_PASSWORD}):`,
      ' - admin@maycafe.vn (ADMIN)',
      ' - staff.a@maycafe.vn (STAFF)',
      ' - staff.b@maycafe.vn (STAFF)',
      'Display setup links were printed above; customers scan the rotating QR on those displays.',
      '',
    ].join('\n'),
  );
}
