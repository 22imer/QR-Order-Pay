import dotenv from 'dotenv';
import path from 'node:path';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });
dotenv.config({ path: path.resolve(here, '../.env') });

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const parsed = Number(v);
  if (Number.isNaN(parsed)) throw new Error(`Invalid number env ${name}=${v}`);
  return parsed;
}

function nonNegativeInt(name: string, fallback: number): number {
  const value = num(name, fallback);
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`Invalid non-negative integer env ${name}=${value}`);
  return value;
}

function positiveInt(name: string, fallback: number): number {
  const value = nonNegativeInt(name, fallback);
  if (value === 0) throw new Error(`Invalid positive integer env ${name}=${value}`);
  return value;
}

function positiveNumber(name: string, fallback: number): number {
  const value = num(name, fallback);
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`Invalid positive number env ${name}=${value}`);
  return value;
}

function fraction(name: string, fallback: number): number {
  const value = num(name, fallback);
  if (!Number.isFinite(value) || value < 0 || value > 1)
    throw new Error(`Invalid fraction env ${name}=${value}`);
  return value;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return v === 'true' || v === '1';
}

function trafficClass(): 'guest' | 'internal' | 'unified' {
  const value = required('TRAFFIC_CLASS', 'unified');
  if (value !== 'guest' && value !== 'internal' && value !== 'unified') {
    throw new Error(`Invalid TRAFFIC_CLASS=${value}`);
  }
  return value;
}

const environment = required('NODE_ENV', 'development');
const publicAppUrl = required('PUBLIC_APP_URL', 'http://localhost:5173');
const serverOrigin = required('SERVER_ORIGIN', 'http://localhost:4000');
const staffAppUrl = required('STAFF_APP_URL', publicAppUrl);
const adminAppUrl = required('ADMIN_APP_URL', publicAppUrl);
const allowedOrigins = [...new Set([publicAppUrl, staffAppUrl, adminAppUrl, serverOrigin])];

function authSecret(name: string, developmentFallback: string): string {
  const value = required(name, developmentFallback);
  if (environment === 'production' && (value.length < 32 || /^(change-me|dev-)/i.test(value))) {
    throw new Error(
      `${name} must be at least 32 characters and must not use a development placeholder in production`,
    );
  }
  return value;
}

type AIMode = 'live' | 'fallback' | 'off';

function readAIMode(name: string): AIMode {
  const value = required(name, 'fallback').trim();
  if (value !== 'live' && value !== 'fallback' && value !== 'off')
    throw new Error(`Invalid ${name}: expected live, fallback or off`);
  return value;
}

const anomalyAiMode = readAIMode('ANOMALY_AI_MODE');
const aiSettings = {
  mode: readAIMode('AI_MODE'),
  provider: required('AI_PROVIDER', 'openai').trim(),
  model: required('AI_MODEL', '').trim(),
  apiKey: (process.env.AI_API_KEY ?? '').trim(),
  baseUrl: required('AI_BASE_URL', 'https://api.openai.com/v1').trim(),
  timeoutMs: positiveInt('AI_TIMEOUT_MS', 15000),
};
if (aiSettings.mode === 'live' || anomalyAiMode === 'live') {
  if (!aiSettings.apiKey) throw new Error('Missing required env var: AI_API_KEY');
  if (!aiSettings.model) throw new Error('Missing required env var: AI_MODEL');
}
let aiUrl: URL;
try {
  aiUrl = new URL(aiSettings.baseUrl);
} catch {
  throw new Error('Invalid AI_BASE_URL');
}
if (!['http:', 'https:'].includes(aiUrl.protocol) || aiUrl.username || aiUrl.password)
  throw new Error('Invalid AI_BASE_URL: expected HTTP(S) URL without userinfo');

export const config = {
  env: environment,
  port: num('PORT', 4000),
  trustProxyHops: nonNegativeInt('TRUST_PROXY_HOPS', 0),
  shutdownTimeoutMs: nonNegativeInt('SHUTDOWN_TIMEOUT_MS', 10_000),
  publicAppUrl,
  staffAppUrl,
  adminAppUrl,
  serverOrigin,
  allowedOrigins,
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,
  cookieSecure: bool('COOKIE_SECURE', false),
  logLevel: required('LOG_LEVEL', 'info'),
  instanceId: process.env.INSTANCE_ID?.trim() || hostname(),
  trafficClass: trafficClass(),
  mongoUri: required(
    'MONGODB_URI',
    'mongodb://127.0.0.1:27017/maycafe?replicaSet=rs0&directConnection=true',
  ),
  redisUrl: required('REDIS_URL', 'redis://127.0.0.1:6379'),
  rateLimits: {
    authPerMinute: positiveInt('RATE_LIMIT_AUTH_MAX', 30),
    guestMutationPerMinute: positiveInt('RATE_LIMIT_GUEST_MUTATION_MAX', 60),
    guestJoinPerMinute: positiveInt('RATE_LIMIT_GUEST_JOIN_MAX', 20),
    guestOrderPerMinute: positiveInt('RATE_LIMIT_GUEST_ORDER_MAX', 12),
    guestServicePerMinute: positiveInt('RATE_LIMIT_GUEST_SERVICE_MAX', 6),
    menuSearchPerMinute: positiveInt('RATE_LIMIT_MENU_SEARCH_MAX', 120),
    aiPerMinute: positiveInt('RATE_LIMIT_AI_MAX', 20),
  },
  menuCacheTtlSeconds: positiveInt('MENU_CACHE_TTL_SECONDS', 60),
  orderQuoteTtlMs: positiveInt('ORDER_QUOTE_TTL_MS', 120_000),
  backgroundJobs: {
    pollIntervalMs: positiveInt('BACKGROUND_JOB_POLL_MS', 250),
    maxAttempts: positiveInt('BACKGROUND_JOB_MAX_ATTEMPTS', 3),
    resultTtlSeconds: positiveInt('BACKGROUND_JOB_RESULT_TTL_SECONDS', 900),
    resultMaxBytes: positiveInt('BACKGROUND_JOB_RESULT_MAX_BYTES', 5 * 1024 * 1024),
    leaseMs: positiveInt('BACKGROUND_JOB_LEASE_MS', 30_000),
    retryBaseMs: positiveInt('BACKGROUND_JOB_RETRY_BASE_MS', 1_000),
    retryMaxMs: positiveInt('BACKGROUND_JOB_RETRY_MAX_MS', 60_000),
    heartbeatIntervalMs: positiveInt('WORKER_HEARTBEAT_INTERVAL_MS', 5_000),
    heartbeatTtlMs: positiveInt('WORKER_HEARTBEAT_TTL_MS', 20_000),
  },
  outbox: {
    pollIntervalMs: positiveInt('OUTBOX_POLL_MS', 250),
    batchSize: positiveInt('OUTBOX_BATCH_SIZE', 50),
    leaseMs: positiveInt('OUTBOX_LEASE_MS', 30_000),
    maxAttempts: positiveInt('OUTBOX_MAX_ATTEMPTS', 20),
    retryBaseMs: positiveInt('OUTBOX_RETRY_BASE_MS', 1_000),
    retryMaxMs: positiveInt('OUTBOX_RETRY_MAX_MS', 60_000),
  },
  jwtAccessSecret: authSecret('JWT_ACCESS_SECRET', 'dev-access-secret'),
  jwtRefreshSecret: authSecret('JWT_REFRESH_SECRET', 'dev-refresh-secret'),
  accessTokenTtl: required('ACCESS_TOKEN_TTL', '15m'),
  refreshTokenTtl: required('REFRESH_TOKEN_TTL', '30d'),
  seedDemoPassword: required('SEED_DEMO_PASSWORD', 'MayCafe@2025'),
  guestAutoOpen: bool('GUEST_AUTO_OPEN', true),
  sessionIdleTimeoutMin: num('SESSION_IDLE_TIMEOUT_MIN', 60),
  ai: aiSettings,
  anomaly: {
    aiMode: anomalyAiMode,
    enabled: bool('ANOMALY_ENABLED', true),
    intervalMs: positiveInt('ANOMALY_INTERVAL_MS', 60_000),
    windowMinutes: positiveInt('ANOMALY_WINDOW_MIN', 15),
    baselineMinutes: positiveInt('ANOMALY_BASELINE_MIN', 60),
    minSamples: positiveInt('ANOMALY_MIN_SAMPLES', 20),
    errorRateThreshold: fraction('ANOMALY_ERROR_RATE', 0.1),
    latencyP95Ms: positiveInt('ANOMALY_LATENCY_P95_MS', 1_000),
    preparationP95Seconds: positiveInt('ANOMALY_PREPARATION_P95_SECONDS', 900),
    cancellationRateThreshold: fraction('ANOMALY_CANCELLATION_RATE', 0.25),
    baselineMultiplier: positiveNumber('ANOMALY_BASELINE_MULTIPLIER', 2),
    cooldownMinutes: nonNegativeInt('ANOMALY_COOLDOWN_MIN', 30),
    aiMaxPerRun: nonNegativeInt('ANOMALY_AI_MAX_PER_RUN', 3),
  },
} as const;

export type AppConfig = typeof config;
