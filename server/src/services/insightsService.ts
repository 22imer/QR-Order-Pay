import {
  insightsQuerySchema,
  companionQuerySchema,
  type InsightsReport,
  type InsightPair,
  type CompanionResult,
} from '@may-cafe/contracts';
import { OrderModel } from '../models/Order.js';
import { IngredientModel } from '../models/Ingredient.js';
import { RecipeModel } from '../models/Recipe.js';
import { productRepository } from '../repositories/productRepository.js';
import { cachedJson } from '../infrastructure/jsonCache.js';
const DAY = 86400000,
  LIMIT = 2000,
  MIN_ORDERS = 20,
  MIN_PAIR = 5;
const vnDay = (d: Date) => new Date(d.getTime() + 7 * 3600000).toISOString().slice(0, 10);
const start = (s: string) => new Date(`${s}T00:00:00+07:00`);
const pct = (a: number, b: number) => Math.round((a / b) * 1000) / 10;
const rounded = (n: number) => Math.round(n * 100) / 100;
interface Sale {
  createdAt: Date;
  total: number;
  items: {
    productId: { toString(): string };
    nameSnapshot: string;
    quantity: number;
    lineTotal: number;
    freestyle?: unknown;
  }[];
}
async function sales(from: Date, until: Date, channel: string) {
  const fulfillment =
    channel === 'ALL'
      ? {}
      : channel === 'PICKUP_GROUP'
        ? { fulfillmentType: { $in: ['TAKEAWAY', 'PICKUP'] } }
        : channel === 'DINE_IN'
          ? { $or: [{ fulfillmentType: 'DINE_IN' }, { fulfillmentType: { $exists: false } }] }
          : { fulfillmentType: channel };
  const rows = await OrderModel.find({
    createdAt: { $gte: from, $lt: until },
    status: 'SERVED',
    paymentStatus: 'PAID',
    'pickup.outcome': { $ne: 'NO_SHOW' },
    ...fulfillment,
  })
    .select(
      'createdAt total items.productId items.nameSnapshot items.quantity items.lineTotal items.freestyle.name',
    )
    .sort({ createdAt: -1, _id: -1 })
    .limit(LIMIT + 1)
    .maxTimeMS(5000)
    .lean<Sale[]>();
  return { rows: rows.slice(0, LIMIT), capped: rows.length > LIMIT };
}
function summarize(rows: Sale[]) {
  const products = new Map<string, InsightsReport['topProducts'][number]>(),
    counts = new Map<string, number>(),
    pairs = new Map<string, number>();
  const days = new Set<string>(),
    hours = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0, cups: 0 }));
  let orderValue = 0,
    cups = 0,
    patternOrders = 0,
    skippedLargeBaskets = 0;
  for (const order of rows) {
    days.add(vnDay(order.createdAt));
    orderValue += order.total;
    const hour = new Date(order.createdAt.getTime() + 7 * 3600000).getUTCHours(),
      seen = new Set<string>(),
      basket = new Set<string>();
    hours[hour]!.orders++;
    for (const item of order.items) {
      const id = String(item.productId),
        p = products.get(id) ?? {
          productId: id,
          name: item.nameSnapshot,
          quantity: 0,
          orders: 0,
          grossValue: 0,
          freestyle: !!item.freestyle,
        };
      p.quantity += item.quantity;
      p.grossValue += item.lineTotal;
      p.orders += seen.has(id) ? 0 : 1;
      products.set(id, p);
      seen.add(id);
      if (!item.freestyle) basket.add(id);
      cups += item.quantity;
      hours[hour]!.cups += item.quantity;
    }
    if (basket.size > 12) {
      skippedLargeBaskets++;
      continue;
    }
    if (!basket.size) continue;
    patternOrders++;
    const ids = [...basket].sort();
    for (let i = 0; i < ids.length; i++) {
      const a = ids[i]!;
      counts.set(a, (counts.get(a) ?? 0) + 1);
      for (let j = i + 1; j < ids.length; j++) {
        const key = `${a}:${ids[j]}`;
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }
    }
  }
  const qualified: InsightPair[] = [];
  if (patternOrders >= MIN_ORDERS)
    for (const [key, count] of pairs) {
      const [a, b] = key.split(':') as [string, string],
        ca = counts.get(a)!,
        cb = counts.get(b)!,
        lift = (count * patternOrders) / (ca * cb);
      if (count < MIN_PAIR || ca < 10 || cb < 10 || lift < 1.05) continue;
      qualified.push({
        a,
        b,
        nameA: products.get(a)!.name,
        nameB: products.get(b)!.name,
        orders: count,
        ordersA: ca,
        ordersB: cb,
        confidenceAB: pct(count, ca),
        confidenceBA: pct(count, cb),
        lift: rounded(lift),
      });
    }
  qualified.sort(
    (a, b) =>
      b.orders - a.orders || b.lift - a.lift || a.a.localeCompare(b.a) || a.b.localeCompare(b.b),
  );
  return {
    orderValue,
    cups,
    hours,
    activeDays: days.size,
    patternOrders,
    skippedLargeBaskets,
    counts: [...counts.entries()],
    pairs: qualified,
    products: [...products.values()].sort(
      (a, b) =>
        b.quantity - a.quantity || b.orders - a.orders || a.productId.localeCompare(b.productId),
    ),
  };
}
async function currentMargins(): Promise<InsightsReport['margins']> {
  const [products, recipes, ingredients] = await Promise.all([
    productRepository.listPublic({ applyInventory: false }),
    RecipeModel.find({ enabled: true }).lean(),
    IngredientModel.find().lean(),
  ]);
  const recipeMap = new Map(
      recipes.filter((r) => r.targetType === 'PRODUCT').map((r) => [String(r.targetId), r]),
    ),
    ingredientMap = new Map(ingredients.map((i) => [String(i._id), i]));
  const items: InsightsReport['margins']['items'] = [];
  for (const p of products)
    for (const variant of p.variants.length
      ? p.variants.filter((v) => v.isAvailable !== false && p.allowedOptions.sizes.includes(v.name))
      : [null]) {
      const recipe = recipeMap.get(p.id),
        lines =
          recipe?.variants.find((v) => String(v.variantId) === String(variant?._id))?.components ??
          recipe?.components;
      const missing: string[] = [];
      let cost = 0;
      if (!lines?.length) missing.push('Chưa có công thức đang bật');
      for (const line of lines ?? []) {
        const ingredient = ingredientMap.get(String(line.ingredientId));
        if (
          !ingredient?.isActive ||
          ingredient.unitCost === null ||
          ingredient.unitCost === undefined ||
          !Number.isFinite(ingredient.unitCost) ||
          ingredient.unitCost < 0
        )
          missing.push(ingredient?.name ?? 'Nguyên liệu không tồn tại');
        else cost += (line.quantity / 1000) * ingredient.unitCost;
      }
      if (!Number.isFinite(cost) || cost > Number.MAX_SAFE_INTEGER)
        missing.push('Chi phí vượt giới hạn tính toán');
      const price = variant?.price ?? p.basePrice,
        complete = missing.length === 0;
      items.push({
        productId: p.id,
        variantId: variant?._id?.toString() ?? null,
        name: p.name,
        size: variant?.name ?? null,
        price,
        ingredientCost: complete ? rounded(cost) : null,
        grossMargin: complete ? rounded(price - cost) : null,
        marginPct: complete && price > 0 ? pct(price - cost, price) : null,
        missing: [...new Set(missing)],
      });
    }
  items.sort(
    (a, b) =>
      (b.grossMargin ?? -Infinity) - (a.grossMargin ?? -Infinity) ||
      a.name.localeCompare(b.name) ||
      (a.variantId ?? '').localeCompare(b.variantId ?? ''),
  );
  return {
    totalVariants: items.length,
    completeVariants: items.filter((i) => i.ingredientCost !== null).length,
    items: items.slice(0, 50),
  };
}
export async function smartInsights(raw: unknown, now = new Date()): Promise<InsightsReport> {
  const query = insightsQuerySchema.parse(raw),
    from = start(query.from),
    until = new Date(start(query.to).getTime() + DAY),
    prevFrom = new Date(from.getTime() - (until.getTime() - from.getTime()));
  const [current, previous, margins] = await Promise.all([
    sales(from, until, query.channel),
    sales(prevFrom, from, query.channel),
    currentMargins(),
  ]);
  const s = summarize(current.rows),
    completePeriod = query.to < vnDay(now);
  const change =
    completePeriod &&
    !current.capped &&
    !previous.capped &&
    current.rows.length >= MIN_ORDERS &&
    previous.rows.length >= MIN_ORDERS
      ? pct(current.rows.length - previous.rows.length, previous.rows.length)
      : null;
  const advice: InsightsReport['advice'] = [];
  if (current.rows.length < MIN_ORDERS || s.activeDays < 3)
    advice.push({
      code: 'LOW_SAMPLE',
      text: `Chưa đủ dữ liệu để kết luận xu hướng: ${current.rows.length} đơn trên ${s.activeDays} ngày; cần ít nhất 20 đơn và 3 ngày.`,
    });
  else {
    const peak = [...s.hours].sort((a, b) => b.orders - a.orders || a.hour - b.hour)[0]!;
    if (peak.orders >= 5)
      advice.push({
        code: 'PEAK',
        text: `${peak.hour}:00–${peak.hour + 1}:00 có ${peak.orders}/${current.rows.length} đơn trong mẫu. Cân nhắc chuẩn bị nguyên liệu và bố trí ca trước khung này.`,
      });
    const top = s.products[0];
    if (top && top.orders >= 5)
      advice.push({
        code: 'BESTSELLER',
        text: `${top.name}: ${top.quantity} phần trong ${top.orders} đơn. Kiểm tra tồn và công thức trước giờ cao điểm.`,
      });
  }
  if (s.pairs.length && !current.capped) {
    const p = s.pairs[0]!;
    advice.push({
      code: 'PAIR',
      text: `${p.nameA} và ${p.nameB} cùng xuất hiện trong ${p.orders}/${s.patternOrders} đơn có món thường. Có thể thử giới thiệu kèm và đo lại kết quả; đây là tương quan.`,
    });
  }
  if (change !== null)
    advice.push({
      code: 'COMPARISON',
      text: `Số đơn hoàn tất ${change >= 0 ? 'tăng' : 'giảm'} ${Math.abs(change)}% so với kỳ liền trước cùng số ngày (${previous.rows.length} → ${current.rows.length} đơn).`,
    });
  if (margins.completeVariants < margins.totalVariants)
    advice.push({
      code: 'MISSING_COST',
      text: `${margins.totalVariants - margins.completeVariants}/${margins.totalVariants} cấu hình món chưa đủ giá vốn/công thức. Bổ sung tại Kho & công thức để xem lãi gộp nguyên liệu dự kiến.`,
    });
  if (current.capped)
    advice.push({
      code: 'CAPPED',
      text: `Kỳ có hơn ${LIMIT} đơn; đang xem ${LIMIT} đơn mới nhất. Thu hẹp ngày để so sánh đầy đủ; không phát gợi ý bán kèm từ mẫu bị giới hạn.`,
    });
  return {
    ...query,
    generatedAt: now.toISOString(),
    sample: {
      orders: current.rows.length,
      activeDays: s.activeDays,
      patternOrders: s.patternOrders,
      capped: current.capped,
      limit: LIMIT,
      skippedLargeBaskets: s.skippedLargeBaskets,
      minimumOrders: MIN_ORDERS,
      minimumPairOrders: MIN_PAIR,
    },
    summary: {
      orderValue: s.orderValue,
      cups: s.cups,
      averageOrderValue: current.rows.length ? Math.round(s.orderValue / current.rows.length) : 0,
    },
    comparison: {
      from: vnDay(prevFrom),
      to: vnDay(new Date(from.getTime() - DAY)),
      orders: previous.rows.length,
      capped: previous.capped,
      orderChangePct: change,
    },
    hours: s.hours,
    topProducts: s.products.slice(0, 10),
    pairs: current.capped ? [] : s.pairs.slice(0, 10),
    margins,
    advice,
  };
}
export async function companions(raw: unknown, now = new Date()): Promise<CompanionResult> {
  const query = companionQuerySchema.parse(raw),
    ids = new Set(query.productIds),
    until = start(vnDay(now)),
    from = new Date(until.getTime() - 30 * DAY);
  const graph = await cachedJson(
    `maycafe:insights:v1:${query.context}:${vnDay(until)}`,
    60,
    async () => {
      const sample = await sales(
        from,
        until,
        query.context === 'TABLE' ? 'DINE_IN' : 'PICKUP_GROUP',
      );
      const s = summarize(sample.rows);
      return { capped: sample.capped, pairs: s.pairs };
    },
  );
  if (graph.capped) return { items: [] };
  // Catalog and stock are always fresh; the statistical graph alone may lag by 60 seconds.
  const products = await productRepository.listPublic();
  const active = new Map(
    products
      .filter(
        (p) =>
          !p.variants.length ||
          p.variants.some(
            (v) => v.isAvailable !== false && p.allowedOptions.sizes.includes(v.name),
          ),
      )
      .map((p) => [p.id, p]),
  );
  const scores = new Map<string, number>();
  for (const pair of graph.pairs)
    for (const [anchor, target, confidence] of [
      [pair.a, pair.b, pair.confidenceAB],
      [pair.b, pair.a, pair.confidenceBA],
    ] as const) {
      if (
        !ids.has(anchor) ||
        !active.has(anchor) ||
        ids.has(target) ||
        !active.has(target) ||
        pair.orders / (anchor === pair.a ? pair.ordersA : pair.ordersB) < 0.2
      )
        continue;
      // Max score across cart anchors; a basket with many anchors must not inflate confidence.
      scores.set(target, Math.max(scores.get(target) ?? 0, confidence * pair.lift));
    }
  return {
    items: [...scores]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([id]) => {
        const p = active.get(id)!,
          variants = p.variants.filter(
            (v) => v.isAvailable !== false && p.allowedOptions.sizes.includes(v.name),
          );
        return {
          productId: p.id,
          name: p.name,
          image: p.image,
          unitPrice: variants.length ? Math.min(...variants.map((v) => v.price)) : p.basePrice,
        };
      }),
  };
}
