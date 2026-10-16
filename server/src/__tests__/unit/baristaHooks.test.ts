import { describe, expect, it } from 'vitest';
import { afterBaristaResponse } from '../../ai/baristaHooks.js';

describe('Barista model-output boundary', () => {
  it.each([
    'not-json',
    JSON.stringify({ message: 'x', recommendations: 'not-an-array' }),
    JSON.stringify({ message: 'x', recommendations: [{ productId: 'p' }] }),
    JSON.stringify({ message: 'x', recommendations: [{ productId: 'p', reason: 'x', variantId: 12 }] }),
  ])('rejects invalid structured output without echoing it', (raw) => {
    expect(() => afterBaristaResponse(raw)).toThrow('AI schema invalid');
  });
  it('rejects more than three model recommendations', () => {
    const raw = JSON.stringify({
      message: 'x',
      recommendations: Array.from({ length: 4 }, (_, i) => ({
        productId: `product-${i}`, variantId: null, reason: 'x',
      })),
    });
    expect(() => afterBaristaResponse(raw)).toThrow('AI schema invalid');
  });
  it('keeps a valid empty result without inventing recommendations', () => {
    expect(afterBaristaResponse('{"message":"Không có món phù hợp","recommendations":[]}'))
      .toEqual({ message: 'Không có món phù hợp', recommendations: [] });
  });
});
