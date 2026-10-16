import crypto from 'node:crypto';
import { config } from '../config/index.js';
import { ForbiddenError, NotFoundError } from '../errors/AppError.js';
import { tableRepository } from '../repositories/tableRepository.js';
import { auditRepository } from '../repositories/auditRepository.js';
import { unitOfWork } from '../infrastructure/unitOfWork.js';
import { randomToken, sha256 } from '../utils/crypto.js';

export const QR_PERIOD_MS = 60_000;
const invalidQr = () =>
  new ForbiddenError('QR đã hết hạn hoặc bị thu hồi. Vui lòng quét mã mới trên màn hình tại bàn.');
function sign(body: string): string {
  return crypto
    .createHmac('sha256', config.jwtAccessSecret)
    .update(`maycafe-table-admission-v1:${body}`)
    .digest('base64url');
}

export function createAdmissionTicket(tableId: string, epoch: number, now = Date.now()) {
  const expiresAt = (Math.floor(now / QR_PERIOD_MS) + 1) * QR_PERIOD_MS;
  const body = Buffer.from(JSON.stringify({ tableId, epoch, expiresAt })).toString('base64url');
  return { token: `qr1.${body}.${sign(body)}`, expiresAt };
}

export function verifyAdmissionTicket(
  token: string,
  now = Date.now(),
): { tableId: string; epoch: number } {
  if (token.length > 1024) throw invalidQr();
  const [prefix, body, signature, extra] = token.split('.');
  if (prefix !== 'qr1' || !body || !signature || extra !== undefined) throw invalidQr();
  const expected = Buffer.from(sign(body));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected))
    throw invalidQr();
  try {
    const value = JSON.parse(Buffer.from(body, 'base64url').toString()) as Record<string, unknown>;
    if (
      typeof value.tableId !== 'string' ||
      !/^[a-f\d]{24}$/i.test(value.tableId) ||
      !Number.isSafeInteger(value.epoch) ||
      (value.epoch as number) < 0 ||
      !Number.isSafeInteger(value.expiresAt) ||
      (value.expiresAt as number) <= now ||
      (value.expiresAt as number) > now + QR_PERIOD_MS
    )
      throw invalidQr();
    return { tableId: value.tableId, epoch: value.epoch as number };
  } catch {
    throw invalidQr();
  }
}

export async function resolveAdmissionTable(token: string) {
  const ticket = verifyAdmissionTicket(token);
  const table = await tableRepository.findById(ticket.tableId);
  if (!table?.isActive || (table.qrEpoch ?? 0) !== ticket.epoch) throw invalidQr();
  return table;
}

export async function provisionTableDisplay(tableId: string, actorId: string) {
  const token = randomToken(32);
  await unitOfWork.withTransaction(async (session) => {
    const table = await tableRepository.provisionDisplay(tableId, sha256(token), session);
    if (!table) throw new NotFoundError('Bàn không tồn tại.');
    await auditRepository.log(
      {
        actorType: 'USER',
        actorId,
        action: 'table.displayProvisioned',
        entityType: 'Table',
        entityId: tableId,
      },
      session,
    );
  });
  // Fragment keeps the long-lived display credential out of HTTP URLs/referrers/access logs.
  return { tableId, url: `${config.publicAppUrl.replace(/\/$/, '')}/display#${token}` };
}

export async function getDisplayQr(displayToken: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(displayToken)) throw invalidQr();
  const table = await tableRepository.findByDisplayTokenHash(sha256(displayToken));
  if (!table) throw invalidQr();
  const now = Date.now();
  const ticket = createAdmissionTicket(table.id, table.qrEpoch ?? 0, now);
  return {
    tableId: table.id,
    tableName: table.name,
    url: `${config.publicAppUrl.replace(/\/$/, '')}/t/${ticket.token}`,
    expiresAt: ticket.expiresAt,
    serverTime: now,
  };
}
