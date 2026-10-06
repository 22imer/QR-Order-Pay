import assert from 'node:assert/strict';
import { config } from '../src/config/index.js';
import { connectMongo, disconnectMongo } from '../src/infrastructure/mongo.js';
import { buildAIService, type RecommendInput } from '../src/services/aiService.js';
const cases: Array<{ name: string; input: RecommendInput }> = [
  { name: 'budget', input: { prompt: 'Gợi ý đồ uống dễ uống dưới 45 nghìn', maxBudget: 45_000 } },
  { name: 'no-caffeine', input: { prompt: 'Tôi muốn món không caffeine', preferences: { noCaffeine: true } } },
  { name: 'no-dairy', input: { prompt: 'Gợi ý món không sữa dưới 60 nghìn', preferences: { noDairy: true }, maxBudget: 60_000 } },
];

async function main(): Promise<void> {
  try {
    assert.equal(config.ai.mode, 'live', 'AI_SMOKE_REQUIRES_LIVE_MODE');
    await connectMongo();
    const service = buildAIService();
    const summaries = [];
    for (const testCase of cases) {
      const result = await service.recommend(testCase.input);
      assert.equal(result.mode, 'llm', `AI_SMOKE_NOT_LIVE:${testCase.name}`);
      assert(
        result.recommendations.length >= 1 && result.recommendations.length <= 3,
        `AI_SMOKE_INVALID_RESULT_COUNT:${testCase.name}`,
      );
      for (const item of result.recommendations) {
        assert.equal(item.unitPrice, item.evidence.price, 'AI_SMOKE_PRICE_EVIDENCE_MISMATCH');
        assert(
          item.unitPrice <= (testCase.input.maxBudget ?? Infinity),
          'AI_SMOKE_OVER_BUDGET',
        );
        assert(item.evidence.withinBudget, 'AI_SMOKE_INVALID_BUDGET_EVIDENCE');
        if (testCase.input.preferences?.noCaffeine) {
          assert.equal(item.evidence.caffeine, false, 'AI_SMOKE_CAFFEINE_CONSTRAINT');
        }
        if (testCase.input.preferences?.noDairy) {
          assert.equal(item.evidence.dairy, false, 'AI_SMOKE_DAIRY_CONSTRAINT');
        }
      }
      summaries.push({
        name: testCase.name,
        mode: result.mode,
        latencyMs: result.latencyMs,
        constraints: {
          budget: true,
          priceEvidence: true,
          noCaffeine: testCase.input.preferences?.noCaffeine ? true : null,
          noDairy: testCase.input.preferences?.noDairy ? true : null,
        },
        recommendations: result.recommendations.map((item) => ({
          productId: item.productId,
          variantId: item.variantId,
        })),
      });
    }
    process.stdout.write(JSON.stringify({ recommendationCases: summaries }) + '\n');
  } finally {
    await disconnectMongo();
  }
}

void main().catch((error) => {
  const message =
    error instanceof Error && error.message.startsWith('AI_SMOKE_')
      ? error.message
      : 'AI_SMOKE_FAILED';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
