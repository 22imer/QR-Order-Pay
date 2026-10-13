import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { connectMongo, disconnectMongo } from '../src/infrastructure/mongo.js';
import { MigrationStateModel } from '../src/models/MigrationState.js';
import '../src/models/Bill.js';
import '../src/models/CashShift.js';
import '../src/models/CancelRequest.js';
import '../src/models/OutboxEvent.js';
import '../src/models/Payment.js';
import '../src/models/PaymentCorrection.js';
import '../src/models/TableSession.js';
import '../src/models/AnomalyAlert.js';
import '../src/models/AuditLog.js';
import '../src/models/Category.js';
import '../src/models/GuestSession.js';
import '../src/models/Order.js';
import '../src/models/Product.js';
import '../src/models/RefreshSession.js';
import '../src/models/Review.js';
import '../src/models/ServiceRequest.js';
import '../src/models/Table.js';
import '../src/models/Topping.js';
import '../src/models/User.js';

interface Migration {
  id: string;
  description: string;
  checksumSource: string;
  up: () => Promise<void>;
}
const migrations: Migration[] = [
  {
    id: '20261013-001-payment-correction-indexes',
    description: 'Create unique pending payment correction and accounting lookup indexes',
    checksumSource: 'v1:paymentcorrections-paymentId-unique-requested,payments-refundedAt-orderIds',
    up: async () => {
      await mongoose.models['PaymentCorrection']!.createIndexes();
      await mongoose.connection
        .db!.collection('payments')
        .createIndex({ refundedAt: -1 }, { name: 'refundedAt_1' });
      await mongoose.connection
        .db!.collection('payments')
        .createIndex({ orderIds: 1 }, { name: 'orderIds_1' });
    },
  },
  {
    id: '20260923-001-reliability-indexes',
    description: 'Preflight active sessions and create outbox/cancel/shift indexes',
    checksumSource:
      'v2:active-session-preflight,active-session,outbox,cancel-request,cash-shift,bill-invoice-indexes',
    up: async () => {
      const db = mongoose.connection.db!;
      const duplicates = await db
        .collection('tablesessions')
        .aggregate([
          { $match: { status: { $in: ['OPEN', 'CHECKOUT'] } } },
          { $group: { _id: '$tableId', count: { $sum: 1 }, ids: { $push: '$_id' } } },
          { $match: { count: { $gt: 1 } } },
        ])
        .toArray();
      if (duplicates.length > 0)
        throw new Error(`PREFLIGHT_DUPLICATE_ACTIVE_TABLE_SESSIONS ${JSON.stringify(duplicates)}`);
      await Promise.all([
        db
          .collection('outboxevents')
          .createIndex({ eventId: 1 }, { unique: true, name: 'eventId_1' }),
        db
          .collection('outboxevents')
          .createIndex(
            { status: 1, nextAttemptAt: 1, leaseUntil: 1, createdAt: 1 },
            { name: 'outbox_due' },
          ),
        db.collection('cancelrequests').createIndex(
          { orderId: 1 },
          {
            unique: true,
            partialFilterExpression: { status: 'REQUESTED' },
            name: 'one_open_cancel_request_per_order',
          },
        ),
        db.collection('cashshifts').createIndex(
          { status: 1 },
          {
            unique: true,
            partialFilterExpression: { status: 'OPEN' },
            name: 'one_open_cash_shift',
          },
        ),
        db
          .collection('bills')
          .createIndex({ invoiceCode: 1 }, { unique: true, sparse: true, name: 'invoiceCode_1' }),
        db.collection('tablesessions').createIndex(
          { tableId: 1 },
          {
            unique: true,
            partialFilterExpression: { status: { $in: ['OPEN', 'CHECKOUT'] } },
            name: 'one_active_session_per_table',
          },
        ),
      ]);
    },
  },
  {
    id: '20260923-002-payment-shift-index',
    description: 'Add non-unique lookup index for shift reconciliation',
    checksumSource: 'v1:payments-shiftId-paidAt-index',
    up: async () => {
      await mongoose.connection
        .db!.collection('payments')
        .createIndex({ shiftId: 1, paidAt: -1 }, { name: 'shift_paidAt' });
    },
  },
  {
    id: '20260923-003-declared-model-indexes',
    description: 'Create every declared Mongoose index without dropping existing indexes',
    checksumSource: 'v1:all-registered-model-createIndexes',
    up: async () => {
      await Promise.all(
        Object.values(mongoose.models).map((registeredModel) => registeredModel.createIndexes()),
      );
    },
  },
];

async function main(): Promise<void> {
  await connectMongo();
  await MigrationStateModel.collection.createIndex({ name: 1 }, { unique: true, name: 'name_1' });
  const owner = `${process.pid}-${crypto.randomUUID()}`;
  const now = new Date();
  let state;
  try {
    state = await MigrationStateModel.findOneAndUpdate(
      {
        name: 'main',
        $or: [{ lockUntil: { $lte: now } }, { lockUntil: null }, { lockUntil: { $exists: false } }],
      },
      {
        $setOnInsert: { name: 'main', applied: [] },
        $set: { lockOwner: owner, lockUntil: new Date(now.getTime() + 10 * 60_000) },
      },
      { upsert: true, new: true },
    );
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw new Error('MIGRATION_LOCKED');
    throw error;
  }
  if (!state || state.lockOwner !== owner) throw new Error('MIGRATION_LOCKED');
  try {
    for (const migration of migrations) {
      const checksum = crypto
        .createHash('sha256')
        .update(`${migration.id}:${migration.description}:${migration.checksumSource}`)
        .digest('hex');
      const previous = state.applied.find((item) => item.id === migration.id);
      if (previous) {
        if (previous.checksum !== checksum)
          throw new Error(`MIGRATION_CHECKSUM_MISMATCH ${migration.id}`);
        process.stdout.write(`skip ${migration.id}\n`);
        continue;
      }
      process.stdout.write(`apply ${migration.id}: ${migration.description}\n`);
      await migration.up();
      await MigrationStateModel.updateOne(
        { name: 'main', lockOwner: owner },
        {
          $push: { applied: { id: migration.id, appliedAt: new Date(), checksum } },
          $set: { lockUntil: new Date(Date.now() + 10 * 60_000) },
        },
      );
    }
  } finally {
    await MigrationStateModel.updateOne(
      { name: 'main', lockOwner: owner },
      { $set: { lockOwner: null, lockUntil: null } },
    );
    await disconnectMongo();
  }
}
void main().catch(async (error) => {
  process.stderr.write(`${(error as Error).message}\n`);
  await disconnectMongo();
  process.exitCode = 1;
});
