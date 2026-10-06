import { config } from '../config/index.js';
import { HttpAIProvider, type AIProvider } from '../providers/aiProvider.js';
import { productRepository } from '../repositories/productRepository.js';
import { logger } from '../infrastructure/logger.js';
import type { ProductDoc } from '../models/Product.js';
import { beforeBaristaRequest, afterBaristaResponse } from '../ai/baristaHooks.js';

export interface RecommendInput {
  prompt: string;
  preferences?: {
    noCaffeine?: boolean;
    noDairy?: boolean;
    lowSugar?: boolean;
    flavor?: string;
  };
  maxBudget?: number;
}

export interface RecommendResult {
  mode: 'llm' | 'fallback';
  message: string;
  recommendations: Array<{
    productId: string;
    variantId: string | null;
    reason: string;
    unitPrice: number;
    name: string;
    image: string;
    evidence: {
      variant: string | null;
      price: number;
      withinBudget: boolean;
      caffeine: boolean | null;
      dairy: boolean | null;
    };
  }>;
  followUpQuestion?: string;
  latencyMs: number;
}


export class AIService {
  constructor(
    private readonly provider: AIProvider | null,
    private readonly mode: 'live' | 'fallback' | 'off',
  ) {}

  async recommend(input: RecommendInput): Promise<RecommendResult> {
    input = normalizePreferences(input);
    const started = Date.now();
    if (this.mode === 'off') {
      return fallbackResult(
        input,
        'Chế độ AI đang tắt. Đang hiển thị gợi ý theo menu.',
        Date.now() - started,
      );
    }
    if (!this.provider) {
      return fallbackResult(
        input,
        'AI Barista đang dùng gợi ý theo menu (fallback).',
        Date.now() - started,
      );
    }
    try {
      return await this.llmRecommend(input, started);
    } catch (e) {
      logger.warn({ err: (e as Error).message }, 'ai recommend failed; using fallback');
      return fallbackResult(
        input,
        'AI tạm thời không khả dụng, đang dùng gợi ý theo menu.',
        Date.now() - started,
      );
    }
  }

  private async llmRecommend(input: RecommendInput, started: number): Promise<RecommendResult> {
    const candidates = await productRepository.listPublic({});
    const filtered = candidates.filter((p) => matchesPreferences(p, input));
    const candidateJson = filtered.map((p) => ({
      id: p._id.toString(),
      name: p.name,
      description: p.description,
      basePrice: p.basePrice,
      variants: p.variants
        .filter((v) => v.isAvailable !== false && p.allowedOptions.sizes.includes(v.name))
        .map((v) => ({
          id: v._id?.toString() ?? null,
          name: v.name,
          price: v.price,
        })),
      caffeine: p.ingredientMetadata?.caffeine ?? null,
      dairy: p.ingredientMetadata?.dairy ?? null,
      flavorProfile: p.ingredientMetadata?.flavorProfile ?? [],
      tags: p.tags ?? [],
    }));
    const budget = input.maxBudget ?? null;
    const preferences = input.preferences ?? {};
    const messages = beforeBaristaRequest({
      prompt: input.prompt,
      budget,
      preferences,
      menu: candidateJson,
    });
    const raw = await this.provider!.chat(messages, {
      model: config.ai.model,
      jsonMode: true,
      temperature: 0.3,
    });
    const validated = afterBaristaResponse(raw);
    const candidateMap = new Map(filtered.map((p) => [p._id.toString(), p]));
    const seen = new Set<string>();
    const recommendations = [];
    for (const rec of validated.recommendations) {
      const product = candidateMap.get(rec.productId);
      if (!product) continue;
      if (seen.has(rec.productId)) continue;
      seen.add(rec.productId);
      const variantId = rec.variantId ?? null;
      const variant = variantId
        ? (product.variants.find(
            (v) =>
              v._id?.toString() === variantId &&
              v.isAvailable !== false &&
              product.allowedOptions.sizes.includes(v.name),
          ) ?? null)
        : availableVariant(product);
      if ((variantId && !variant) || (product.variants.length > 0 && !variant)) continue;
      const unitPrice = variant ? variant.price : product.basePrice;
      if (budget && unitPrice > budget) continue;
      recommendations.push({
        productId: product._id.toString(),
        variantId: variant?._id?.toString() ?? null,
        reason: verifiedReason(product, variant?.name ?? null, unitPrice, preferences, budget),
        unitPrice,
        name: product.name,
        image: product.image,
        evidence: recommendationEvidence(product, variant?.name ?? null, unitPrice, budget),
      });
      if (recommendations.length >= 3) break;
    }
    if (recommendations.length === 0) {
      return await fallbackResult(
        input,
        'AI chưa tìm được món phù hợp ràng buộc của bạn. Dưới đây là các món đang bán:',
        Date.now() - started,
      );
    }
    return {
      mode: 'llm',
      message: validated.message,
      recommendations,
      followUpQuestion: validated.followUpQuestion,
      latencyMs: Date.now() - started,
    };
  }
}


function fallbackResult(
  input: RecommendInput,
  message: string,
  latencyMs: number,
): Promise<RecommendResult> {
  return productRepository.listPublic({}).then((products) => {
    const filtered = products.filter((p) => matchesPreferences(p, input));
    const budget = input.maxBudget ?? Number.POSITIVE_INFINITY;
    const pref = input.preferences ?? {};
    const promptLow = input.prompt.toLowerCase();
    const candidates: { p: ProductDoc; score: number }[] = [];
    for (const p of filtered) {
      const basePrice = availableVariant(p)?.price ?? p.basePrice;
      if (basePrice > budget) continue;
      if (pref.noCaffeine && p.ingredientMetadata?.caffeine) continue;
      if (pref.noDairy && p.ingredientMetadata?.dairy) continue;
      const flavor = (p.ingredientMetadata?.flavorProfile ?? []).map((x) => x.toLowerCase());
      const tags = (p.tags ?? []).map((x) => x.toLowerCase());
      const haystack =
        `${p.name} ${p.description} ${flavor.join(' ')} ${tags.join(' ')}`.toLowerCase();
      let score = 0;
      if (pref.lowSugar && /ít ngọt|low sugar/.test(haystack)) score += 2;
      if (pref.flavor && haystack.includes(pref.flavor.toLowerCase())) score += 2;
      if (pref.noCaffeine && !p.ingredientMetadata?.caffeine) score += 1;
      if (pref.noDairy && !p.ingredientMetadata?.dairy) score += 1;
      if (/chua/.test(promptLow) && flavor.some((f) => f.includes('chua'))) score += 2;
      if (
        /đắng|manly|đậm/.test(promptLow) &&
        flavor.some((f) => f.includes('đắng') || f.includes('đậm'))
      )
        score += 2;
      if (/ngọt/.test(promptLow) && flavor.some((f) => f.includes('ngọt'))) score += 1;
      if (
        /trái cây|fruit/.test(promptLow) &&
        tags.some((t) => t.includes('fruit') || t.includes('trái cây'))
      )
        score += 2;
      if (p.isFeatured) score += 1;
      candidates.push({ p, score });
    }
    candidates.sort((a, b) => b.score - a.score || a.p.basePrice - b.p.basePrice);
    const picks = candidates.slice(0, 3).map((c) => c.p);
    if (picks.length === 0) {
      return {
        mode: 'fallback',
        message:
          'Hiện chưa có món phù hợp tất cả lựa chọn. Bạn có thể đổi ngân sách hoặc khẩu vị rồi thử lại.',
        recommendations: [],
        latencyMs,
      };
    }
    return {
      mode: 'fallback',
      message,
      recommendations: picks.map((p) => ({
        productId: p._id.toString(),
        variantId: availableVariant(p)?._id?.toString() ?? null,
        reason: buildReason(p, pref, budget),
        unitPrice: availableVariant(p)?.price ?? p.basePrice,
        name: p.name,
        image: p.image,
        evidence: recommendationEvidence(
          p,
          availableVariant(p)?.name ?? null,
          availableVariant(p)?.price ?? p.basePrice,
          Number.isFinite(budget) ? budget : null,
        ),
      })),
      latencyMs,
    };
  });
}

function availableVariant(p: ProductDoc) {
  return (
    p.variants
      .filter((v) => v.isAvailable !== false && p.allowedOptions.sizes.includes(v.name))
      .sort((a, b) => a.price - b.price)[0] ?? null
  );
}

function matchesPreferences(p: ProductDoc, input: RecommendInput): boolean {
  if (!p.isAvailable || p.isArchived) return false;
  // Hydration defaults are not evidence of ingredient metadata stored in the database.
  if (input.preferences?.noCaffeine &&
      (p.$isDefault('ingredientMetadata') || p.$isDefault('ingredientMetadata.caffeine') ||
       p.ingredientMetadata?.caffeine !== false)) return false;
  if (input.preferences?.noDairy &&
      (p.$isDefault('ingredientMetadata') || p.$isDefault('ingredientMetadata.dairy') ||
       p.ingredientMetadata?.dairy !== false)) return false;
  const variant = availableVariant(p);
  if (p.variants.length > 0 && !variant) return false;
  return (variant?.price ?? p.basePrice) <= (input.maxBudget ?? Infinity);
}

function normalizePreferences(input: RecommendInput): RecommendInput {
  const prompt = input.prompt.toLowerCase();
  const budget = /(?:dưới|tối đa|ngân sách)\s*(\d+(?:[.,]\d+)?)\s*(k|nghìn|ngàn|đ|vnd)?/.exec(
    prompt,
  );
  return {
    ...input,
    maxBudget:
      input.maxBudget ??
      (budget
        ? Number(budget[1]!.replace(',', '.')) *
          (/^(k|nghìn|ngàn)$/.test(budget[2] ?? '') ? 1000 : 1)
        : undefined),
    preferences: {
      ...input.preferences,
      // "không cà phê" loại nhóm coffee, không đồng nghĩa "không caffeine" (trà/matcha vẫn có thể chứa caffeine).
      noCaffeine:
        input.preferences?.noCaffeine ||
        /(?:không (?:có |uống )?(?:caffeine|cafein)|decaf)/.test(prompt),
      noDairy: input.preferences?.noDairy || /không (?:có |uống )?sữa/.test(prompt),
      lowSugar: input.preferences?.lowSugar || /ít (?:ngọt|đường)/.test(prompt),
    },
  };
}

function buildReason(
  p: ProductDoc,
  pref: NonNullable<RecommendInput['preferences']>,
  budget: number,
): string {
  const reasons: string[] = [];
  if (pref.noCaffeine && !p.ingredientMetadata?.caffeine) reasons.push('không caffeine');
  if (pref.noDairy && !p.ingredientMetadata?.dairy) reasons.push('không sữa');
  if (pref.lowSugar) reasons.push('chọn mức đường thấp khi thêm món');
  if (pref.flavor) reasons.push(`hương ${pref.flavor}`);
  if (Number.isFinite(budget) && p.basePrice <= budget)
    reasons.push(`trong tầm ${budget.toLocaleString('vi-VN')}đ`);
  if (reasons.length === 0) reasons.push('đề xuất của quán');
  return reasons.join(', ');
}

function verifiedReason(
  p: ProductDoc,
  variant: string | null,
  price: number,
  pref: NonNullable<RecommendInput['preferences']>,
  budget: number | null,
): string {
  const reasons: string[] = [];
  if (variant) reasons.push(`size ${variant}`);
  reasons.push(`${price.toLocaleString('vi-VN')}đ`);
  if (budget !== null) reasons.push(`không vượt ngân sách ${budget.toLocaleString('vi-VN')}đ`);
  if (pref.noCaffeine) reasons.push('metadata xác nhận không caffeine');
  if (pref.noDairy) reasons.push('metadata xác nhận không sữa');
  if (pref.lowSugar) reasons.push('có thể chọn mức đường thấp');
  if (pref.flavor) reasons.push(`hương ${pref.flavor}`);
  return reasons.join(' · ');
}

function recommendationEvidence(
  p: ProductDoc,
  variant: string | null,
  price: number,
  budget: number | null,
) {
  return {
    variant,
    price,
    withinBudget: budget === null || price <= budget,
    caffeine: p.ingredientMetadata?.caffeine ?? null,
    dairy: p.ingredientMetadata?.dairy ?? null,
  };
}

export function buildAIService(): AIService {
  if (config.ai.mode === 'live') {
    const provider = new HttpAIProvider({
      name: config.ai.provider,
      apiKey: config.ai.apiKey,
      baseUrl: config.ai.baseUrl,
    });
    return new AIService(provider, 'live');
  }
  return new AIService(null, config.ai.mode);
}

export async function validateRecommendedConfiguration(input: {
  productId: string;
  variantId: string | null;
  toppingIds: string[];
  constraints: { noCaffeine?: boolean; noDairy?: boolean; maxBudget?: number };
}) {
  const [product, toppings] = await Promise.all([
    productRepository.findById(input.productId),
    input.toppingIds.length > 0
      ? (await import('../repositories/toppingRepository.js')).toppingRepository.findManyByIds(
          input.toppingIds,
        )
      : Promise.resolve([]),
  ]);
  const violations: string[] = [];
  if (!product || product.isArchived || !product.isAvailable)
    return { valid: false, total: 0, violations: ['Món không còn khả dụng.'] };
  const variant = input.variantId
    ? product.variants.find(
        (item) => item._id?.toString() === input.variantId && item.isAvailable !== false,
      )
    : null;
  if (product.variants.length > 0 && !variant) violations.push('Size không còn khả dụng.');
  let total = variant?.price ?? product.basePrice;
  for (const toppingId of input.toppingIds) {
    const topping = toppings.find((item) => item.id === toppingId);
    if (
      !topping ||
      topping.isArchived ||
      !topping.isAvailable ||
      !product.allowedOptions.toppingIds.map(String).includes(toppingId)
    )
      violations.push(`Topping ${toppingId} không khả dụng.`);
    else {
      total += topping.price;
      if (input.constraints.noDairy && topping.ingredientMetadata?.dairy !== false)
        violations.push(`Không thể xác nhận topping ${topping.name} là không sữa.`);
    }
  }
  if (input.constraints.noCaffeine && product.ingredientMetadata?.caffeine !== false)
    violations.push('Cấu hình không đáp ứng yêu cầu không caffeine.');
  if (input.constraints.noDairy && product.ingredientMetadata?.dairy !== false)
    violations.push('Món nền không đáp ứng yêu cầu không sữa.');
  if (input.constraints.maxBudget !== undefined && total > input.constraints.maxBudget)
    violations.push(`Tổng cấu hình ${total.toLocaleString('vi-VN')}đ vượt ngân sách.`);
  return { valid: violations.length === 0, total, violations };
}
