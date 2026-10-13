import mongoose from 'mongoose';
import { connectMongo, disconnectMongo } from '../infrastructure/mongo.js';
import { CategoryModel } from '../models/Category.js';
import { ProductModel } from '../models/Product.js';
import { TableModel } from '../models/Table.js';
import { sha256 } from '../utils/crypto.js';
import '../models/AnomalyAlert.js';
import '../models/AuditLog.js';
import '../models/Bill.js';
import '../models/GuestSession.js';
import '../models/Order.js';
import '../models/OutboxEvent.js';
import '../models/Payment.js';
import '../models/RefreshSession.js';
import '../models/Review.js';
import '../models/ServiceRequest.js';
import '../models/TableSession.js';
import '../models/Topping.js';
import '../models/User.js';

const productCount = Number(process.env.BENCHMARK_PRODUCT_COUNT ?? 200);
const displayToken = process.env.BENCHMARK_DISPLAY_TOKEN;

async function main(): Promise<void> {
  await connectMongo();
  const databaseName = mongoose.connection.db?.databaseName ?? '';
  if (!databaseName.includes('benchmark'))
    throw new Error(`Refusing to reset non-benchmark database: ${databaseName}`);
  if (!Number.isInteger(productCount) || productCount < 1 || productCount > 10_000)
    throw new Error('BENCHMARK_PRODUCT_COUNT must be 1..10000');
  if (!displayToken || !/^[A-Za-z0-9_-]{43}$/.test(displayToken))
    throw new Error('BENCHMARK_DISPLAY_TOKEN must be a private 32-byte base64url credential');
  await mongoose.connection.db?.dropDatabase();
  // dropDatabase removes every index. Rebuild them before accepting concurrent
  // benchmark traffic so production invariants (notably one active session per
  // table) are exercised instead of accidentally disabled by the seed itself.
  await Promise.all(Object.values(mongoose.models).map((model) => model.syncIndexes()));
  const category = await CategoryModel.create({
    name: 'Benchmark',
    slug: 'benchmark',
    sortOrder: 0,
    isActive: true,
  });
  await ProductModel.insertMany(
    Array.from({ length: productCount }, (_, index) => ({
      categoryId: category._id,
      name: `Benchmark product ${index + 1}`,
      slug: `benchmark-product-${index + 1}`,
      description: 'Synthetic load-test product',
      image: 'https://example.invalid/benchmark.webp',
      basePrice: 30_000 + (index % 10) * 1_000,
      variants: [],
      allowedOptions: {
        sizes: [],
        sugarLevels: ['50%'],
        iceLevels: ['normal-ice'],
        toppingIds: [],
      },
      toppingIds: [],
      tags: ['benchmark'],
      ingredientMetadata: {
        caffeine: false,
        dairy: false,
        flavorProfile: [],
        allergens: [],
        notes: '',
      },
      isAvailable: true,
      isArchived: false,
      isFeatured: index < 6,
      sortOrder: index,
    })),
  );
  await TableModel.create({
    code: 'BENCH-01',
    name: 'Benchmark table',
    capacity: 10_000,
    publicTokenHash: sha256(`unused-legacy-${displayToken}`),
    displayTokenHash: sha256(displayToken),
    isActive: true,
  });
  process.stdout.write(
    JSON.stringify({ databaseName, productCount, tableCode: 'BENCH-01' }) + '\n',
  );
  await disconnectMongo();
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
