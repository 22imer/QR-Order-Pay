import type mongoose from 'mongoose';
type Db = NonNullable<typeof mongoose.connection.db>;

/** Replaces only the two formerly table-only uniqueness constraints; no document rewrite. */
export async function migratePickupIndexes(db: Db) {
  for (const [collection, name, key] of [
    ['orders', 'tableSessionId_1_idempotencyKey_1', { tableSessionId: 1, idempotencyKey: 1 }],
    ['bills', 'tableSessionId_1', { tableSessionId: 1 }],
  ] as const) {
    const c = db.collection(collection);
    const existing = await c
      .listIndexes()
      .toArray()
      .catch((e: { code?: number }) => {
        if (e.code === 26) return [];
        throw e;
      });
    // Create the replacement first so table uniqueness remains enforced across interruption.
    await c.createIndex(key, {
      name: `${name}_dine_in`,
      unique: true,
      partialFilterExpression: { tableSessionId: { $type: 'objectId' } },
    });
    if (existing.some((i) => i.name === name && !i.partialFilterExpression))
      await c.dropIndex(name);
  }
  await db
    .collection('orders')
    .createIndex(
      { participantId: 1, idempotencyKey: 1 },
      {
        name: 'pickup_request_unique',
        unique: true,
        partialFilterExpression: { fulfillmentType: { $in: ['TAKEAWAY', 'PICKUP'] } },
      },
    );
  await db
    .collection('orders')
    .createIndex({
      fulfillmentType: 1,
      'pickup.outcome': 1,
      'pickup.scheduledAt': 1,
      createdAt: -1,
    });
  await db
    .collection('bills')
    .createIndex(
      { pickupOrderId: 1 },
      {
        name: 'pickupOrderId_1',
        unique: true,
        partialFilterExpression: { pickupOrderId: { $type: 'objectId' } },
      },
    );
}
