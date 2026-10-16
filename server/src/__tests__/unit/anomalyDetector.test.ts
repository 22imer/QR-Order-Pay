import { describe, expect, it, vi } from 'vitest';
import type { AnomalyEvaluation } from '@may-cafe/contracts';
import type { AIProvider } from '../../providers/aiProvider.js';
import { evaluateAnomalies, type AnomalySettings, type OrderSignal } from '../../services/anomalyDetector.js';
import { explainAnomaly } from '../../services/anomalyExplanationService.js';
import { config } from '../../config/index.js';
import { HttpAIProvider } from '../../providers/aiProvider.js';

const now = new Date('2026-09-22T12:00:00.000Z');
const settings: AnomalySettings = {
  windowMinutes: 15,
  baselineMinutes: 60,
  minSamples: 20,
  errorRateThreshold: 0.1,
  latencyP95Ms: 1_000,
  preparationP95Seconds: 900,
  cancellationRateThreshold: 0.25,
  baselineMultiplier: 2,
};

describe('anomaly detectors with labeled synthetic data', () => {
  it('does not alert for a normal labeled window', () => {
    const result = evaluateAnomalies({
      now,
      settings,
      http: [...httpWindow('baseline', 40, { errors: 1, latencyMs: 100 }), ...httpWindow('current', 40, { errors: 1, latencyMs: 120 })],
      orders: [...orderWindow('baseline', 20, { cancelled: 1, preparationSeconds: 100 }), ...orderWindow('current', 20, { cancelled: 1, preparationSeconds: 120 })],
    });
    expect(result).toHaveLength(4);
    expect(result.every((item) => item.state === 'OK')).toBe(true);
  });

  it('detects a labeled HTTP 5xx spike without false alerts from other detectors', () => {
    const result = evaluateAnomalies({
      now,
      settings,
      http: [...httpWindow('baseline', 40, { errors: 1, latencyMs: 100 }), ...httpWindow('current', 40, { errors: 12, latencyMs: 100 })],
      orders: [...orderWindow('baseline', 20, { cancelled: 1, preparationSeconds: 100 }), ...orderWindow('current', 20, { cancelled: 1, preparationSeconds: 100 })],
    });
    expect(alerts(result)).toEqual(['HTTP_ERROR_RATE']);
    expect(byDetector(result, 'HTTP_ERROR_RATE').evidence).toMatchObject({ errors: 12, requests: 40 });
  });

  it('detects labeled p95 latency and slow preparation independently', () => {
    const commonOrders = [...orderWindow('baseline', 20, { cancelled: 1, preparationSeconds: 100 }), ...orderWindow('current', 20, { cancelled: 1, preparationSeconds: 1_200 })];
    const result = evaluateAnomalies({
      now,
      settings,
      http: [...httpWindow('baseline', 40, { latencyMs: 100 }), ...httpWindow('current', 40, { latencyMs: 2_000 })],
      orders: commonOrders,
    });
    expect(alerts(result)).toEqual(['HTTP_LATENCY_P95', 'PREPARATION_P95']);
  });

  it('detects a labeled cancellation-rate spike', () => {
    const result = evaluateAnomalies({
      now,
      settings,
      http: [...httpWindow('baseline', 40, {}), ...httpWindow('current', 40, {})],
      orders: [...orderWindow('baseline', 20, { cancelled: 1 }), ...orderWindow('current', 20, { cancelled: 8 })],
    });
    expect(alerts(result)).toEqual(['CANCELLATION_RATE']);
  });

  it('reports insufficient data rather than inferring from a tiny sample', () => {
    const result = evaluateAnomalies({ now, settings, http: httpWindow('current', 3, { errors: 3, latencyMs: 5_000 }), orders: orderWindow('current', 3, { cancelled: 3, preparationSeconds: 5_000 }) });
    expect(result.every((item) => item.state === 'INSUFFICIENT_DATA')).toBe(true);
    expect(result.every((item) => item.observedValue === null)).toBe(true);
  });

  it('falls back to evidence-based text when the AI provider times out', async () => {
    const timeoutProvider: AIProvider = { name: 'timeout-test', chat: async () => { throw new DOMException('timed out', 'AbortError'); } };
    const explanation = await explainAnomaly(alertEvaluation(), timeoutProvider);
    expect(explanation.mode).toBe('fallback');
    expect(explanation.evidence).toHaveLength(3);
  });
  it.each(['fallback', 'off'])('keeps anomaly %s independent of live Barista', async (mode) => {
    const previousAI = { ...config.ai };
    const previousAnomaly = { ...config.anomaly };
    Object.assign(config.ai, { mode: 'live', apiKey: 'unit-test-key', model: 'test-model' });
    Object.assign(config.anomaly, { aiMode: mode });
    const chat = vi.spyOn(HttpAIProvider.prototype, 'chat').mockResolvedValue(JSON.stringify({
      summary: 'Observed error rate', evidence: ['12 errors in 40 requests'],
      hypotheses: ['Inspect workload'], checks: ['Inspect logs'],
    }));
    try {
      expect((await explainAnomaly(alertEvaluation())).mode).toBe('fallback');
      expect(chat).not.toHaveBeenCalled();
    } finally {
      Object.assign(config.ai, previousAI);
      Object.assign(config.anomaly, previousAnomaly);
      chat.mockRestore();
    }
  });
  it.each(['fallback', 'off'])('allows opt-in anomaly inference while Barista is %s', async (mode) => {
    const previousAI = { ...config.ai };
    const previousAnomaly = { ...config.anomaly };
    Object.assign(config.ai, { mode, apiKey: 'unit-test-key', model: 'test-model' });
    Object.assign(config.anomaly, { aiMode: 'live' });
    const chat = vi.spyOn(HttpAIProvider.prototype, 'chat').mockResolvedValue(JSON.stringify({
      summary: 'Observed error rate', evidence: ['12 errors in 40 requests'],
      hypotheses: ['Inspect workload'], checks: ['Inspect logs'],
    }));
    try {
      expect((await explainAnomaly(alertEvaluation())).mode).toBe('llm');
      expect(chat).toHaveBeenCalledTimes(1);
    } finally {
      Object.assign(config.ai, previousAI);
      Object.assign(config.anomaly, previousAnomaly);
      chat.mockRestore();
    }
  });
});

function httpWindow(window: 'baseline' | 'current', count: number, options: { errors?: number; latencyMs?: number }) {
  const base = window === 'current' ? now.getTime() - 5 * 60_000 : now.getTime() - 30 * 60_000;
  return Array.from({ length: count }, (_, index) => ({
    at: new Date(base + index),
    method: 'GET',
    route: '/api/v1/products',
    statusCode: index < (options.errors ?? 0) ? 500 : 200,
    durationMs: options.latencyMs ?? 100,
  }));
}

function orderWindow(window: 'baseline' | 'current', count: number, options: { cancelled?: number; preparationSeconds?: number }): OrderSignal[] {
  const createdBase = window === 'current' ? now.getTime() - 10 * 60_000 : now.getTime() - 40 * 60_000;
  const completedBase = window === 'current' ? now.getTime() - 5 * 60_000 : now.getTime() - 30 * 60_000;
  return Array.from({ length: count }, (_, index) => {
    const preparationSeconds = options.preparationSeconds ?? 100;
    const completedAt = new Date(completedBase + index);
    return {
      createdAt: new Date(createdBase + index),
      status: index < (options.cancelled ?? 0) ? 'CANCELLED' : 'READY',
      preparationStartedAt: new Date(completedAt.getTime() - preparationSeconds * 1_000),
      preparationCompletedAt: completedAt,
      cancelledAt: index < (options.cancelled ?? 0) ? new Date(completedAt.getTime() - 1_000) : null,
    };
  });
}

function alerts(values: AnomalyEvaluation[]) {
  return values.filter((item) => item.state === 'ALERT').map((item) => item.detector);
}

function byDetector(values: AnomalyEvaluation[], detector: AnomalyEvaluation['detector']) {
  return values.find((item) => item.detector === detector)!;
}

function alertEvaluation(): AnomalyEvaluation {
  return {
    detector: 'HTTP_ERROR_RATE', target: 'all', state: 'ALERT', severity: 'WARNING',
    windowStart: '2026-09-22T11:45:00.000Z', windowEnd: now.toISOString(), observedValue: 0.3,
    thresholdValue: 0.1, baselineValue: 0.02, sampleCount: 40, baselineSampleCount: 40,
    method: 'synthetic test', evidence: { errors: 12, requests: 40 },
  };
}
