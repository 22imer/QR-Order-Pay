import { randomUUID } from 'node:crypto';
import { config } from '../config/index.js';
import { isRedisReady, redisCommandClient } from './redis.js';

export const REALTIME_QUEUE = 'maycafe:queue:realtime';
export const REPORT_QUEUE = 'maycafe:queue:reports';
export const REALTIME_PROCESSING_QUEUE = `${REALTIME_QUEUE}:processing`;
export const REPORT_PROCESSING_QUEUE = `${REPORT_QUEUE}:processing`;
export const DEAD_LETTER_QUEUE = 'maycafe:queue:dead-letter';

export type RealtimeEvent =
  | 'reservation.changed'
  | 'gift.changed'
  | 'game.changed'
  | 'jukebox.changed'
  | 'workforce.changed'
  | 'order.created'
  | 'order.statusChanged'
  | 'menu.availabilityChanged'
  | 'serviceRequest.created'
  | 'serviceRequest.resolved'
  | 'payment.confirmed'
  | 'tableSession.statusChanged'
  | 'cancelRequest.created'
  | 'cancelRequest.resolved';

export type RealtimeTarget =
  | { scope: 'all' }
  | { scope: 'staff' }
  | { scope: 'session'; tableSessionId: string }
  | { scope: 'guest'; tableSessionId: string; participantId: string };

export interface RealtimeEnvelope<T = unknown> {
  eventId: string;
  eventType: RealtimeEvent;
  schemaVersion: number;
  entityId: string;
  entityVersion: number;
  occurredAt: string;
  data: T;
}

interface JobBase {
  id: string;
  attempts: number;
  createdAt: string;
  nextAttemptAt?: string;
}

export interface RealtimeJob extends JobBase {
  type: 'realtime.notify';
  payload: { target: RealtimeTarget; event: RealtimeEvent; envelope: RealtimeEnvelope };
}

export interface ReportJob extends JobBase {
  type: 'report.overview';
  payload: { from: string | null; to: string | null; format: 'json' | 'csv' };
}

export type BackgroundJob = RealtimeJob | ReportJob;

export interface ClaimedJob {
  raw: string;
  job: BackgroundJob;
  leaseToken: string;
  owner: string;
}

export interface DeadLetterRecord {
  job: BackgroundJob;
  error: string;
  failedAt: string;
}

export interface ReportJobState {
  id: string;
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  format: 'json' | 'csv';
  createdAt: string;
  updatedAt: string;
  result?: unknown;
  error?: string;
}

export async function enqueueRealtimeJob(
  target: RealtimeTarget,
  event: RealtimeEvent,
  data: unknown,
  options?: {
    id?: string;
    createdAt?: string;
    schemaVersion?: number;
    entityId?: string;
    entityVersion?: number;
  },
): Promise<boolean> {
  if (!isRedisReady()) return false;
  const id = options?.id ?? randomUUID();
  const createdAt = options?.createdAt ?? new Date().toISOString();
  const envelope: RealtimeEnvelope = {
    eventId: id,
    eventType: event,
    schemaVersion: options?.schemaVersion ?? 1,
    entityId: options?.entityId ?? inferEntityId(target, data),
    entityVersion: options?.entityVersion ?? inferEntityVersion(data),
    occurredAt: createdAt,
    data,
  };
  const job: RealtimeJob = {
    id,
    type: 'realtime.notify',
    attempts: 0,
    createdAt,
    payload: { target, event, envelope },
  };
  await redisCommandClient().lpush(REALTIME_QUEUE, JSON.stringify(job));
  return true;
}

export async function enqueueReportJob(input: ReportJob['payload']): Promise<ReportJobState> {
  if (!isRedisReady()) throw new Error('BACKGROUND_QUEUE_UNAVAILABLE');
  const now = new Date().toISOString();
  const job: ReportJob = {
    id: randomUUID(),
    type: 'report.overview',
    attempts: 0,
    createdAt: now,
    payload: input,
  };
  const state: ReportJobState = {
    id: job.id,
    status: 'QUEUED',
    format: input.format,
    createdAt: now,
    updatedAt: now,
  };
  await redisCommandClient()
    .multi()
    .set(reportStateKey(job.id), JSON.stringify(state))
    .lpush(REPORT_QUEUE, JSON.stringify(job))
    .exec();
  return state;
}

export async function getReportJobState(id: string): Promise<ReportJobState | null> {
  if (!isRedisReady()) return null;
  const raw = await redisCommandClient().get(reportStateKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ReportJobState;
  } catch {
    return null;
  }
}

export async function setReportJobState(state: ReportJobState): Promise<void> {
  const value = JSON.stringify({ ...state, updatedAt: new Date().toISOString() });
  if (state.status === 'COMPLETED' || state.status === 'FAILED') {
    await redisCommandClient().set(
      reportStateKey(state.id),
      value,
      'EX',
      config.backgroundJobs.resultTtlSeconds,
    );
  } else {
    await redisCommandClient().set(reportStateKey(state.id), value);
  }
}

export async function recoverExpiredJobs(queue: string, processingQueue: string): Promise<number> {
  const raws = await redisCommandClient().lrange(processingQueue, 0, -1);
  let recovered = 0;
  for (const raw of raws) {
    const job = parseJob(raw);
    if (!job) {
      await redisCommandClient()
        .multi()
        .lrem(processingQueue, 1, raw)
        .lpush(
          DEAD_LETTER_QUEUE,
          JSON.stringify({
            job: null,
            error: 'INVALID_JOB_PAYLOAD',
            failedAt: new Date().toISOString(),
            raw,
          }),
        )
        .exec();
      continue;
    }
    const moved = await redisCommandClient().eval(
      `if redis.call('EXISTS', KEYS[1]) == 0 then local removed = redis.call('LREM', KEYS[2], 1, ARGV[1]); if removed == 1 then redis.call('LPUSH', KEYS[3], ARGV[1]) end; return removed end; return 0`,
      3,
      leaseKey(job.id),
      processingQueue,
      queue,
      raw,
    );
    recovered += Number(moved);
  }
  return recovered;
}

export async function claimJob(
  queue: string,
  processingQueue: string,
  owner: string,
): Promise<ClaimedJob | null> {
  const leaseToken = randomUUID();
  const leaseValue = JSON.stringify({ leaseToken, owner });
  const raw = (await redisCommandClient().eval(
    `local raw = redis.call('RPOPLPUSH', KEYS[1], KEYS[2]); if not raw then return nil end; local ok, job = pcall(cjson.decode, raw); if ok and job.id then redis.call('SET', ARGV[1] .. job.id, ARGV[2], 'PX', ARGV[3]) end; return raw`,
    2,
    queue,
    processingQueue,
    'maycafe:queue:lease:',
    leaseValue,
    String(config.backgroundJobs.leaseMs),
  )) as string | null;
  if (!raw) return null;
  const job = parseJob(raw);
  if (!job) {
    await redisCommandClient()
      .multi()
      .lrem(processingQueue, 1, raw)
      .lpush(
        DEAD_LETTER_QUEUE,
        JSON.stringify({
          job: null,
          error: 'INVALID_JOB_PAYLOAD',
          failedAt: new Date().toISOString(),
          raw,
        }),
      )
      .exec();
    return null;
  }
  if (job.nextAttemptAt && new Date(job.nextAttemptAt).getTime() > Date.now()) {
    await redisCommandClient().eval(
      `local current = redis.call('GET', KEYS[1]); if current ~= ARGV[1] then return 0 end; local removed = redis.call('LREM', KEYS[2], 1, ARGV[2]); if removed == 1 then redis.call('LPUSH', KEYS[3], ARGV[2]) end; redis.call('DEL', KEYS[1]); return removed`,
      3,
      leaseKey(job.id),
      processingQueue,
      queue,
      leaseValue,
      raw,
    );
    return null;
  }
  return { raw, job, leaseToken, owner };
}

export async function renewJobLease(claim: ClaimedJob): Promise<boolean> {
  const value = JSON.stringify({ leaseToken: claim.leaseToken, owner: claim.owner });
  const result = await redisCommandClient().eval(
    `local current = redis.call('GET', KEYS[1]); if current == ARGV[1] then redis.call('PEXPIRE', KEYS[1], ARGV[2]); return 1 end; return 0`,
    1,
    leaseKey(claim.job.id),
    value,
    String(config.backgroundJobs.leaseMs),
  );
  return Number(result) === 1;
}

export async function acknowledgeJob(processingQueue: string, claim: ClaimedJob): Promise<boolean> {
  const value = JSON.stringify({ leaseToken: claim.leaseToken, owner: claim.owner });
  const result = await redisCommandClient().eval(
    `local current = redis.call('GET', KEYS[1]); if current ~= ARGV[1] then return 0 end; local removed = redis.call('LREM', KEYS[2], 1, ARGV[2]); redis.call('DEL', KEYS[1]); return removed`,
    2,
    leaseKey(claim.job.id),
    processingQueue,
    value,
    claim.raw,
  );
  return Number(result) === 1;
}

export async function retryOrDeadLetter(
  queue: string,
  processingQueue: string,
  claim: ClaimedJob,
  error: unknown,
): Promise<boolean> {
  const attempts = claim.job.attempts + 1;
  const retrying = attempts < config.backgroundJobs.maxAttempts;
  const delay = Math.min(
    config.backgroundJobs.retryMaxMs,
    config.backgroundJobs.retryBaseMs * 2 ** Math.max(0, attempts - 1),
  );
  const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(delay * 0.2)));
  const next = {
    ...claim.job,
    attempts,
    nextAttemptAt: new Date(Date.now() + delay + jitter).toISOString(),
  } as BackgroundJob;
  const payload = retrying
    ? JSON.stringify(next)
    : JSON.stringify({
        job: next,
        error: sanitizeError(error),
        failedAt: new Date().toISOString(),
      } satisfies DeadLetterRecord);
  const destination = retrying ? queue : DEAD_LETTER_QUEUE;
  const value = JSON.stringify({ leaseToken: claim.leaseToken, owner: claim.owner });
  const result = await redisCommandClient().eval(
    `local current = redis.call('GET', KEYS[1]); if current ~= ARGV[1] then return 0 end; local removed = redis.call('LREM', KEYS[2], 1, ARGV[2]); if removed == 1 then redis.call('LPUSH', KEYS[3], ARGV[3]) end; redis.call('DEL', KEYS[1]); return removed`,
    3,
    leaseKey(claim.job.id),
    processingQueue,
    destination,
    value,
    claim.raw,
    payload,
  );
  if (Number(result) !== 1) throw new Error('JOB_LEASE_LOST');
  return retrying;
}

export async function queueSnapshot(): Promise<{
  realtime: QueueRuntimeSnapshot;
  reports: QueueRuntimeSnapshot;
  deadLetters: number;
  workers: WorkerHeartbeat[];
  redisMemory: { usedBytes: number; maxBytes: number; policy: string; keyCount: number };
}> {
  const emptyQueue: QueueRuntimeSnapshot = {
    pending: 0,
    processing: 0,
    oldestPendingAgeSeconds: 0,
    expiredProcessing: 0,
    retryingSampleCount: 0,
  };
  if (!isRedisReady())
    return {
      realtime: emptyQueue,
      reports: emptyQueue,
      deadLetters: 0,
      workers: [],
      redisMemory: { usedBytes: 0, maxBytes: 0, policy: 'unknown', keyCount: 0 },
    };
  const redis = redisCommandClient();
  const [realtime, reports, deadLetters, keys, memoryInfo, keyCount] = await Promise.all([
    queueRuntimeSnapshot(REALTIME_QUEUE, REALTIME_PROCESSING_QUEUE),
    queueRuntimeSnapshot(REPORT_QUEUE, REPORT_PROCESSING_QUEUE),
    redis.llen(DEAD_LETTER_QUEUE),
    scanKeys('maycafe:worker:*'),
    redis.info('memory'),
    redis.dbsize(),
  ]);
  const values = keys.length > 0 ? await redis.mget(keys) : [];
  const workers = values.flatMap((value) => {
    if (!value) return [];
    try {
      return [JSON.parse(value) as WorkerHeartbeat];
    } catch {
      return [];
    }
  });
  return {
    realtime,
    reports,
    deadLetters,
    workers,
    redisMemory: {
      usedBytes: infoNumber(memoryInfo, 'used_memory'),
      maxBytes: infoNumber(memoryInfo, 'maxmemory'),
      policy: infoValue(memoryInfo, 'maxmemory_policy') || 'unknown',
      keyCount,
    },
  };
}

export interface WorkerHeartbeat {
  id: string;
  role: string;
  updatedAt: string;
  lastProgressAt?: string;
  activeJobId?: string | null;
  activeJobStartedAt?: string | null;
}

interface QueueRuntimeSnapshot {
  pending: number;
  processing: number;
  oldestPendingAgeSeconds: number;
  expiredProcessing: number;
  retryingSampleCount: number;
}

export async function writeWorkerHeartbeat(
  id: string,
  role: string,
  details: Omit<WorkerHeartbeat, 'id' | 'role' | 'updatedAt'> = {},
): Promise<void> {
  if (!isRedisReady()) return;
  await redisCommandClient().set(
    `maycafe:worker:${id}`,
    JSON.stringify({ id, role, updatedAt: new Date().toISOString(), ...details }),
    'PX',
    config.backgroundJobs.heartbeatTtlMs,
  );
}

export async function acquireSchedulerLeadership(owner: string): Promise<boolean> {
  const result = await redisCommandClient().set(
    'maycafe:scheduler:leader',
    owner,
    'PX',
    config.backgroundJobs.heartbeatTtlMs,
    'NX',
  );
  return result === 'OK';
}

export async function renewSchedulerLeadership(owner: string): Promise<boolean> {
  const result = await redisCommandClient().eval(
    `if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('PEXPIRE', KEYS[1], ARGV[2]); return 1 end; return 0`,
    1,
    'maycafe:scheduler:leader',
    owner,
    String(config.backgroundJobs.heartbeatTtlMs),
  );
  return Number(result) === 1;
}

export async function releaseSchedulerLeadership(owner: string): Promise<void> {
  await redisCommandClient().eval(
    `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end; return 0`,
    1,
    'maycafe:scheduler:leader',
    owner,
  );
}

export async function listDeadLetters(limit = 50): Promise<DeadLetterRecord[]> {
  if (!isRedisReady()) return [];
  const raws = await redisCommandClient().lrange(DEAD_LETTER_QUEUE, 0, Math.max(0, limit - 1));
  return raws.flatMap((raw) => {
    try {
      return [JSON.parse(raw) as DeadLetterRecord];
    } catch {
      return [];
    }
  });
}

export async function replayDeadLetter(jobId: string): Promise<boolean> {
  if (!isRedisReady()) return false;
  const redis = redisCommandClient();
  const raws = await redis.lrange(DEAD_LETTER_QUEUE, 0, -1);
  const raw = raws.find((candidate) => {
    try {
      return (JSON.parse(candidate) as DeadLetterRecord).job?.id === jobId;
    } catch {
      return false;
    }
  });
  if (!raw) return false;
  const record = JSON.parse(raw) as DeadLetterRecord;
  const job = { ...record.job, attempts: 0, nextAttemptAt: undefined } as BackgroundJob;
  const queue = job.type === 'realtime.notify' ? REALTIME_QUEUE : REPORT_QUEUE;
  const result = await redis.eval(
    `local removed = redis.call('LREM', KEYS[1], 1, ARGV[1]); if removed == 1 then redis.call('LPUSH', KEYS[2], ARGV[2]) end; return removed`,
    2,
    DEAD_LETTER_QUEUE,
    queue,
    raw,
    JSON.stringify(job),
  );
  return Number(result) === 1;
}

function parseJob(raw: string): BackgroundJob | null {
  try {
    const job = JSON.parse(raw) as BackgroundJob;
    return job && typeof job.id === 'string' && typeof job.type === 'string' ? job : null;
  } catch {
    return null;
  }
}

function inferEntityId(target: RealtimeTarget, data: unknown): string {
  if (data && typeof data === 'object') {
    for (const key of ['orderId', 'tableSessionId', 'requestId', 'id']) {
      const value = (data as Record<string, unknown>)[key];
      if (typeof value === 'string') return value;
    }
  }
  if (target.scope === 'session' || target.scope === 'guest') return target.tableSessionId;
  return 'catalog';
}

function inferEntityVersion(data: unknown): number {
  if (data && typeof data === 'object') {
    const value = (data as Record<string, unknown>).version;
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  }
  return 0;
}

function leaseKey(id: string): string {
  return `maycafe:queue:lease:${id}`;
}
function reportStateKey(id: string): string {
  return `maycafe:job:report:${id}`;
}
function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'UNKNOWN_JOB_ERROR';
  return message.replace(/(token|secret|password|cookie)=[^\s]+/gi, '$1=[REDACTED]').slice(0, 500);
}

async function scanKeys(pattern: string): Promise<string[]> {
  const redis = redisCommandClient();
  let cursor = '0';
  const keys: string[] = [];
  do {
    const [next, page] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = next;
    keys.push(...page);
  } while (cursor !== '0');
  return keys;
}

async function queueRuntimeSnapshot(
  queue: string,
  processingQueue: string,
): Promise<QueueRuntimeSnapshot> {
  const redis = redisCommandClient();
  const [pending, processing, oldestRaw, pendingSample, processingRaws] = await Promise.all([
    redis.llen(queue),
    redis.llen(processingQueue),
    redis.lindex(queue, -1),
    redis.lrange(queue, 0, 999),
    redis.lrange(processingQueue, 0, 999),
  ]);
  const oldest = oldestRaw ? parseJob(oldestRaw) : null;
  const leaseKeys = processingRaws.flatMap((raw) => {
    const job = parseJob(raw);
    return job ? [leaseKey(job.id)] : [];
  });
  const leaseValues = leaseKeys.length > 0 ? await redis.mget(leaseKeys) : [];
  return {
    pending,
    processing,
    oldestPendingAgeSeconds: oldest
      ? Math.max(0, Math.floor((Date.now() - new Date(oldest.createdAt).getTime()) / 1_000))
      : 0,
    expiredProcessing:
      processingRaws.length -
      leaseKeys.length +
      leaseValues.filter((value) => value === null).length,
    retryingSampleCount: pendingSample.reduce((count, raw) => {
      const job = parseJob(raw);
      return count + (job && job.attempts > 0 ? 1 : 0);
    }, 0),
  };
}

function infoValue(info: string, key: string): string {
  const match = info.match(new RegExp(`^${key}:(.+)$`, 'm'));
  return match?.[1]?.trim() ?? '';
}

function infoNumber(info: string, key: string): number {
  const value = Number(infoValue(info, key));
  return Number.isFinite(value) ? value : 0;
}
