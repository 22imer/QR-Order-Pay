// Additive historical demo data for #11. Default is read-only preview; never resets a DB.
// Run with the application's compiled models inside its local API container (see docs).
import mongoose from 'mongoose';
import { createHash, randomBytes } from 'node:crypto';
const apply = process.argv.includes('--apply');
const base = '/app/server/dist/src';
const { OrderModel } = await import(`${base}/models/Order.js`);
const { PaymentModel } = await import(`${base}/models/Payment.js`);
const { BillModel } = await import(`${base}/models/Bill.js`);
const { TableSessionModel } = await import(`${base}/models/TableSession.js`);
const { TableModel } = await import(`${base}/models/Table.js`);
const { ProductModel } = await import(`${base}/models/Product.js`);
const { CategoryModel } = await import(`${base}/models/Category.js`);
const { UserModel } = await import(`${base}/models/User.js`);
const { AuditLogModel } = await import(`${base}/models/AuditLog.js`);
const { StaffingPolicyModel } = await import(`${base}/models/WorkShift.js`);
const { workforcePeaks } = await import(`${base}/services/workforceReportsService.js`);
const sha = (value) => createHash('sha256').update(value).digest('hex');
const id = (name) =>
  new mongoose.Types.ObjectId(sha(`fantastic-workforce-history-demo-v1:${name}`).slice(0, 24));
const marker = '[DEMO #11] Lịch sử gợi ý nhân sự — 0đ, không thu tiền thực';
const categoryId = id('category'),
  productId = id('product'),
  tableId = id('table');
const catalogSlug = 'demo-workforce-history-v1';
const activeCollections = [
  'users',
  'orders',
  'payments',
  'bills',
  'tables',
  'tablesessions',
  'products',
  'categories',
  'toppings',
  'ingredients',
  'recipes',
  'stockmovements',
  'members',
  'vouchers',
  'pointentries',
  'voucheruses',
  'cashshifts',
  'workshifts',
  'workactivities',
  'staffingpolicies',
  'workschedulecopies',
];

await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false });
try {
  if (mongoose.connection.db.databaseName !== 'maycafe')
    throw new Error('Refusing non-local project database; expected maycafe.');
  const now = new Date();
  const today = new Date(
    `${new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 10)}T00:00:00+07:00`,
  );
  const weekday = new Date(today.getTime() + 7 * 3600000).getUTCDay() || 7;
  const monday = new Date(today.getTime() - (weekday - 1) * 86400000);
  const selectedFrom = new Date(monday.getTime() + 7 * 3600000).toISOString().slice(0, 10);
  const stamp = selectedFrom.replaceAll('-', '');
  const datasetId = `workforce-history-demo-v1-${stamp}`;
  const policy = await StaffingPolicyModel.findById('default').lean();
  const capacity = policy?.ordersPerStaffHour ?? 6;
  const before = await workforcePeaks(monday, now, capacity);
  const report = {
    mode: apply ? 'apply' : 'preview',
    datasetId,
    selectedFrom,
    before,
    added: { orders: 0, payments: 0, bills: 0, sessions: 0 },
    moneyAdded: 0,
  };
  const preserved = [];
  if (apply)
    for (const name of activeCollections) {
      const docs = await mongoose.connection.db.collection(name).find().sort({ _id: 1 }).toArray();
      preserved.push({
        name,
        ids: docs.map((d) => d._id),
        hash: sha(mongoose.mongo.BSON.EJSON.stringify(docs, { relaxed: false })),
      });
    }
  async function makePlan(session = null) {
    const rows = await OrderModel.aggregate([
      {
        $match: {
          createdAt: { $gte: new Date(before.from), $lt: new Date(before.until) },
          paymentStatus: 'PAID',
          status: { $ne: 'CANCELLED' },
        },
      },
      {
        $group: {
          _id: {
            day: { $isoDayOfWeek: { date: '$createdAt', timezone: 'Asia/Ho_Chi_Minh' } },
            hour: { $hour: { date: '$createdAt', timezone: 'Asia/Ho_Chi_Minh' } },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1, '_id.day': 1, '_id.hour': 1 } },
    ]).session(session);
    const total = rows.reduce((n, r) => n + r.count, 0),
      top = rows[0];
    return {
      total,
      count: Math.max(0, 20 - total, 3 - (top?.count ?? 0)),
      day: top?._id.day ?? 1,
      hour: top?._id.hour ?? 7,
    };
  }
  report.plan = await makePlan();
  if (apply && report.plan.count) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const plan = await makePlan(session);
        report.plan = plan;
        report.added = { orders: 0, payments: 0, bills: 0, sessions: 0 };
        if (!plan.count) return;
        const actor = await UserModel.findOne({
          role: 'ADMIN',
          isActive: true,
          isDeleted: { $ne: true },
        })
          .select('_id')
          .session(session);
        if (!actor)
          throw new Error('An active project admin is required for demo payment references.');
        const category = await CategoryModel.findOne({
          $or: [{ _id: categoryId }, { slug: catalogSlug }],
        }).session(session);
        if (
          category &&
          (String(category._id) !== String(categoryId) ||
            category.isActive ||
            category.name !== marker)
        )
          throw new Error('Conflicting demo category; refusing overwrite.');
        if (!category)
          await CategoryModel.create(
            [{ _id: categoryId, name: marker, slug: catalogSlug, isActive: false }],
            { session },
          );
        const product = await ProductModel.findOne({
          $or: [{ _id: productId }, { slug: catalogSlug }],
        }).session(session);
        if (
          product &&
          (String(product._id) !== String(productId) ||
            product.basePrice !== 0 ||
            !product.isArchived ||
            product.isAvailable ||
            product.name !== marker)
        )
          throw new Error('Conflicting demo product; refusing overwrite.');
        if (!product)
          await ProductModel.create(
            [
              {
                _id: productId,
                categoryId,
                name: marker,
                slug: catalogSlug,
                description: marker,
                image: '/favicon.svg',
                basePrice: 0,
                isAvailable: false,
                isArchived: true,
                tags: ['DEMO-WF11'],
                allowedOptions: { sugarLevels: ['0%'], iceLevels: ['no-ice'] },
              },
            ],
            { session },
          );
        const table = await TableModel.findOne({
          $or: [{ _id: tableId }, { code: 'DEMO-WF11' }],
        }).session(session);
        if (
          table &&
          (String(table._id) !== String(tableId) || table.isActive || table.name !== marker)
        )
          throw new Error('Conflicting demo table; refusing overwrite.');
        if (!table)
          await TableModel.create(
            [
              {
                _id: tableId,
                code: 'DEMO-WF11',
                name: marker,
                capacity: 1,
                isActive: false,
                publicTokenHash: sha(randomBytes(32)),
              },
            ],
            { session },
          );
        const oldSlots = await OrderModel.countDocuments({
          code: { $regex: `^D11-${stamp}-` },
        }).session(session);
        for (let i = 0; i < plan.count; i++) {
          const slot = oldSlots + i + 1,
            key = `${datasetId}:${slot}`;
          const orderId = id(`${key}:order`),
            sessionId = id(`${key}:session`),
            billId = id(`${key}:bill`),
            paymentId = id(`${key}:payment`);
          const at = new Date(
            monday.getTime() -
              7 * 86400000 +
              (plan.day - 1) * 86400000 +
              plan.hour * 3600000 +
              (10 + i) * 60000,
          );
          const paidAt = new Date(at.getTime() + 8000),
            closedAt = new Date(at.getTime() + 50000);
          if (at < new Date(before.from) || closedAt >= new Date(before.until))
            throw new Error('Demo timestamps outside selected history.');
          const participantId = `DEMO-WF11-${stamp}-${slot}`,
            code = `D11-${stamp}-${String(slot).padStart(2, '0')}`;
          const item = {
            productId,
            variantId: null,
            sizeName: null,
            sugarLevel: '0%',
            iceLevel: 'no-ice',
            toppingIds: [],
            toppingNamesSnapshot: [],
            note: marker,
            quantity: 1,
            unitPrice: 0,
            lineTotal: 0,
            nameSnapshot: marker,
            variantNameSnapshot: '',
          };
          const history = [
            'AWAITING_PAYMENT',
            'PENDING',
            'CONFIRMED',
            'PREPARING',
            'READY',
            'SERVED',
          ].map((to, j, states) => ({
            from: j ? states[j - 1] : null,
            to,
            at: new Date(at.getTime() + j * 8000),
            by: null,
            byParticipantId: j ? null : participantId,
            reason: marker,
          }));
          await TableSessionModel.create(
            [
              {
                _id: sessionId,
                tableId,
                status: 'CLOSED',
                source: 'STAFF',
                startedAt: new Date(at.getTime() - 10000),
                closedAt,
                closedReason: 'PAID',
                billId,
                createdAt: at,
                updatedAt: closedAt,
              },
            ],
            { session },
          );
          await OrderModel.create(
            [
              {
                _id: orderId,
                code,
                tableSessionId: sessionId,
                tableId,
                participantId,
                items: [item],
                total: 0,
                subtotal: 0,
                paidAmount: 0,
                status: 'SERVED',
                paymentStatus: 'PAID',
                inventoryState: 'NONE',
                statusHistory: history,
                idempotencyKey: key,
                requestHash: sha(key),
                createdAt: at,
                updatedAt: closedAt,
              },
            ],
            { session },
          );
          await PaymentModel.create(
            [
              {
                _id: paymentId,
                tableSessionId: sessionId,
                orderIds: [orderId],
                amount: 0,
                method: 'OTHER',
                status: 'SUCCESS',
                confirmedBy: actor._id,
                paidAt,
                note: marker,
                idempotencyKey: `${key}:payment`,
                createdAt: paidAt,
                updatedAt: paidAt,
              },
            ],
            { session },
          );
          await BillModel.create(
            [
              {
                _id: billId,
                invoiceCode: `DEMO-WF11-${stamp}-${String(slot).padStart(2, '0')}`,
                tableSessionId: sessionId,
                tableId,
                tableCode: 'DEMO-WF11',
                tableName: marker,
                cashierName: marker,
                source: 'STAFF',
                openedAt: new Date(at.getTime() - 10000),
                closedAt,
                participants: [participantId],
                orders: [
                  {
                    orderId,
                    code,
                    status: 'SERVED',
                    paymentStatus: 'PAID',
                    total: 0,
                    subtotal: 0,
                    createdAt: at,
                    participantId,
                    items: [item],
                  },
                ],
                subtotal: 0,
                total: 0,
                paidAmount: 0,
                paymentIds: [paymentId],
                payments: [{ paymentId, method: 'OTHER', amount: 0, paidAt }],
                createdAt: closedAt,
                updatedAt: closedAt,
              },
            ],
            { session },
          );
        }
        report.added = {
          orders: plan.count,
          payments: plan.count,
          bills: plan.count,
          sessions: plan.count,
        };
        await AuditLogModel.create(
          [
            {
              actorType: 'SYSTEM',
              action: 'demo.workforceHistoryAdded',
              entityType: 'DemoDataset',
              entityId: datasetId,
              metadata: {
                reason:
                  'User explicitly requested enough historical demo data for workforce suggestions',
                ...report.added,
                moneyAdded: 0,
                marker,
                historyFrom: before.from,
                historyUntil: before.until,
              },
            },
          ],
          { session },
        );
      });
    } finally {
      await session.endSession();
    }
  }
  if (apply) {
    report.preservedExisting = [];
    for (const record of preserved) {
      const docs = await mongoose.connection.db
        .collection(record.name)
        .find({ _id: { $in: record.ids } })
        .sort({ _id: 1 })
        .toArray();
      report.preservedExisting.push({
        collection: record.name,
        count: record.ids.length,
        unchanged:
          sha(mongoose.mongo.BSON.EJSON.stringify(docs, { relaxed: false })) === record.hash,
      });
    }
    if (report.preservedExisting.some((p) => !p.unchanged))
      throw new Error(
        'An existing collection changed during demo setup; inspect concurrent activity before continuing.',
      );
    report.after = await workforcePeaks(monday, new Date(), capacity);
    if (!report.after.enoughData || !report.after.items.length)
      throw new Error('Demo setup did not produce a usable workforce suggestion.');
    report.demoIntegrity = await OrderModel.aggregate([
      { $match: { tableId } },
      {
        $lookup: { from: 'payments', localField: '_id', foreignField: 'orderIds', as: 'payments' },
      },
      {
        $lookup: {
          from: 'bills',
          localField: 'tableSessionId',
          foreignField: 'tableSessionId',
          as: 'bills',
        },
      },
      {
        $project: {
          _id: 0,
          code: 1,
          total: 1,
          paidAmount: 1,
          status: 1,
          paymentStatus: 1,
          paymentCount: { $size: '$payments' },
          billCount: { $size: '$bills' },
        },
      },
    ]);
    if (
      report.demoIntegrity.some(
        (o) =>
          o.total !== 0 ||
          o.paidAmount !== 0 ||
          o.paymentCount !== 1 ||
          o.billCount !== 1 ||
          o.status !== 'SERVED' ||
          o.paymentStatus !== 'PAID',
      )
    )
      throw new Error('Demo payment/bill integrity failed.');
  }
  console.log(JSON.stringify(report));
} finally {
  await mongoose.disconnect();
}
