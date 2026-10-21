import { anomalyDashboardResponseSchema, type AnomalyAlert, type AnomalyDashboardResponse, type AnomalyEvaluation } from '@may-cafe/contracts';
import { config } from '../config/index.js';
import { getHttpObservations } from '../infrastructure/metrics.js';
import { getSharedHttpObservations } from '../infrastructure/sharedHttpMetrics.js';
import { isRedisReady } from '../infrastructure/redis.js';
import { logger } from '../infrastructure/logger.js';
import { AnomalyAlertModel, type AnomalyAlertDoc } from '../models/AnomalyAlert.js';
import { OrderModel } from '../models/Order.js';
import { isValidObjectId } from 'mongoose';
import { evaluateAnomalies, type OrderSignal } from './anomalyDetector.js';
import { explainAnomaly, fallbackExplanation } from './anomalyExplanationService.js';

let latestEvaluations: AnomalyEvaluation[] = [];
let lastRunAt: Date | null = null;

export async function runAnomalyDetection(now = new Date()): Promise<AnomalyEvaluation[]> {
  const baselineStart = new Date(now.getTime() - (Math.max(1, config.anomaly.windowMinutes) + Math.max(1, config.anomaly.baselineMinutes)) * 60_000);
  const [http, rawOrders] = await Promise.all([
    isRedisReady() ? getSharedHttpObservations(baselineStart, now) : Promise.resolve(getHttpObservations(baselineStart)),
    OrderModel.find({
      'pickup.outcome': { $ne: 'NO_SHOW' },
      $or: [
        { createdAt: { $gte: baselineStart } },
        { 'statusHistory.at': { $gte: baselineStart } },
        { status: 'PREPARING' },
      ],
    }).select('createdAt status statusHistory').lean(),
  ]);
  const orders: OrderSignal[] = rawOrders.map((order) => {
    const history = order.statusHistory ?? [];
    const preparing = history.find((entry) => entry.to === 'PREPARING')?.at ?? null;
    const ready = history.find((entry) => entry.to === 'READY')?.at ?? null;
    const cancelled = history.find((entry) => entry.to === 'CANCELLED')?.at ?? null;
    return {
      createdAt: new Date(order.createdAt),
      status: order.status,
      preparationStartedAt: preparing ? new Date(preparing) : null,
      preparationCompletedAt: ready ? new Date(ready) : null,
      cancelledAt: cancelled ? new Date(cancelled) : null,
    };
  });
  const evaluations = evaluateAnomalies({ now, http, orders, settings: config.anomaly });
  latestEvaluations = evaluations;
  lastRunAt = now;

  let liveExplanationBudget = config.anomaly.aiMaxPerRun;
  for (const evaluation of evaluations.filter((item) => item.state === 'ALERT')) {
    const isNew = await persistAnomalyAlert(evaluation, now, liveExplanationBudget > 0);
    if (isNew) liveExplanationBudget -= 1;
  }
  return evaluations;
}

export function startAnomalyScheduler(): () => void {
  if (!config.anomaly.enabled || config.anomaly.intervalMs <= 0) return () => undefined;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await runAnomalyDetection();
    } catch (error) {
      logger.error({ err: error }, 'anomaly detection run failed');
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(() => void run(), config.anomaly.intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

export async function anomalyDashboard(): Promise<AnomalyDashboardResponse> {
  const alerts = await AnomalyAlertModel.find().sort({ lastDetectedAt: -1 }).limit(50).lean();
  return anomalyDashboardResponseSchema.parse({
    observedAt: new Date().toISOString(),
    lastRunAt: lastRunAt?.toISOString() ?? null,
    evaluations: latestEvaluations,
    alerts: alerts.map(serializeAlert),
    schedule: {
      intervalMs: config.anomaly.intervalMs,
      windowMinutes: config.anomaly.windowMinutes,
      baselineMinutes: config.anomaly.baselineMinutes,
    },
  });
}

export async function updateAnomalyStatus(id: string, status: 'ACKNOWLEDGED' | 'CLOSED', userId: string): Promise<AnomalyAlert | null> {
  if (!isValidObjectId(id)) return null;
  const now = new Date();
  const update = status === 'ACKNOWLEDGED'
    ? { status, acknowledgedAt: now, acknowledgedBy: userId }
    : { status, closedAt: now, closedBy: userId };
  const allowedStatuses = status === 'ACKNOWLEDGED' ? ['OPEN'] : ['OPEN', 'ACKNOWLEDGED'];
  const alert = await AnomalyAlertModel.findOneAndUpdate({ _id: id, status: { $in: allowedStatuses } }, update, { new: true }).lean();
  return alert ? serializeAlert(alert) : null;
}

export async function persistAnomalyAlert(evaluation: AnomalyEvaluation, now: Date, allowLiveExplanation: boolean): Promise<boolean> {
  const cooldownStart = new Date(now.getTime() - config.anomaly.cooldownMinutes * 60_000);
  const existing = await AnomalyAlertModel.findOne({
    detector: evaluation.detector,
    target: evaluation.target,
    status: { $in: ['OPEN', 'ACKNOWLEDGED'] },
    lastDetectedAt: { $gte: cooldownStart },
  }).sort({ lastDetectedAt: -1 });
  const values = evaluationValues(evaluation, now);
  if (existing) {
    Object.assign(existing, values);
    await existing.save();
    return false;
  }

  const explanation = allowLiveExplanation ? await explainAnomaly(evaluation) : fallbackExplanation(evaluation);
  try {
    await AnomalyAlertModel.create({
      bucketKey: `${evaluation.detector}:${evaluation.target}:${evaluation.windowStart}`,
      ...values,
      firstDetectedAt: now,
      explanation,
    });
    return true;
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return false;
    throw error;
  }
}

function evaluationValues(evaluation: AnomalyEvaluation, now: Date) {
  return {
    detector: evaluation.detector,
    target: evaluation.target,
    severity: evaluation.severity,
    windowStart: new Date(evaluation.windowStart),
    windowEnd: new Date(evaluation.windowEnd),
    observedValue: evaluation.observedValue,
    thresholdValue: evaluation.thresholdValue,
    baselineValue: evaluation.baselineValue,
    sampleCount: evaluation.sampleCount,
    baselineSampleCount: evaluation.baselineSampleCount,
    method: evaluation.method,
    evidence: evaluation.evidence,
    lastDetectedAt: now,
  };
}

function serializeAlert(alert: Pick<AnomalyAlertDoc, keyof AnomalyAlertDoc> | Record<string, unknown>): AnomalyAlert {
  const raw = alert as unknown as Record<string, unknown>;
  const date = (key: string): string | null => raw[key] ? new Date(raw[key] as string | Date).toISOString() : null;
  return {
    id: String(raw._id),
    detector: raw.detector as AnomalyAlert['detector'],
    target: String(raw.target),
    state: 'ALERT',
    severity: raw.severity as AnomalyAlert['severity'],
    windowStart: date('windowStart')!,
    windowEnd: date('windowEnd')!,
    observedValue: Number(raw.observedValue),
    thresholdValue: Number(raw.thresholdValue),
    baselineValue: raw.baselineValue === null || raw.baselineValue === undefined ? null : Number(raw.baselineValue),
    sampleCount: Number(raw.sampleCount),
    baselineSampleCount: Number(raw.baselineSampleCount),
    method: String(raw.method),
    evidence: raw.evidence as Record<string, unknown>,
    status: raw.status as AnomalyAlert['status'],
    firstDetectedAt: date('firstDetectedAt')!,
    lastDetectedAt: date('lastDetectedAt')!,
    acknowledgedAt: date('acknowledgedAt'),
    closedAt: date('closedAt'),
    explanation: raw.explanation as AnomalyAlert['explanation'],
  };
}
