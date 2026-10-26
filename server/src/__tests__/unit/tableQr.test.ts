import { describe, expect, it } from 'vitest';
import {
  createAdmissionTicket,
  verifyAdmissionTicket,
  createStaticAdmissionTicket,
  verifyTableTicket,
} from '../../services/tableQrService.js';

describe('short-lived table admission QR', () => {
  const tableId = '0123456789abcdef01234567';
  const now = 1_800_000_000_000;
  it('issues stable static QR without a clock deadline and rejects tampering', () => {
    const ticket = createStaticAdmissionTicket(tableId, 2);
    expect(createStaticAdmissionTicket(tableId, 2)).toEqual(ticket);
    expect(verifyTableTicket(ticket.token)).toEqual({ tableId, epoch: 2, fixed: true });
    expect(createStaticAdmissionTicket(tableId, 3)).not.toEqual(ticket);
    expect(() => verifyTableTicket(`${ticket.token}x`)).toThrow();
    expect(() => verifyTableTicket(`${ticket.token}.extra`)).toThrow();
    expect(() => verifyAdmissionTicket(ticket.token, now)).toThrow();
  });
  it('expires at the next 60-second boundary and is shared by a group during that period', () => {
    const ticket = createAdmissionTicket(tableId, 2, now);
    expect(ticket.expiresAt).toBe(now + 60_000);
    expect(createAdmissionTicket(tableId, 2, now + 30_000)).toEqual(ticket);
    expect(verifyAdmissionTicket(ticket.token, now + 59_999)).toEqual({ tableId, epoch: 2 });
    expect(() => verifyAdmissionTicket(ticket.token, ticket.expiresAt)).toThrow();
    expect(createAdmissionTicket(tableId, 2, now + 60_000).token).not.toBe(ticket.token);
  });
  it('rejects changed data, signature, static tokens, oversize and future tickets', () => {
    const ticket = createAdmissionTicket(tableId, 0, now);
    const [prefix, body, signature] = ticket.token.split('.');
    const changed = Buffer.from(
      JSON.stringify({ tableId: 'f'.repeat(24), epoch: 0, expiresAt: ticket.expiresAt }),
    ).toString('base64url');
    for (const value of [
      `${prefix}.${changed}.${signature}`,
      `${prefix}.${body}.invalid`,
      'old-static-token',
      'x'.repeat(1025),
      `${ticket.token}.extra`,
    ])
      expect(() => verifyAdmissionTicket(value, now)).toThrow();
    expect(() =>
      verifyAdmissionTicket(createAdmissionTicket(tableId, 0, now + 120_000).token, now),
    ).toThrow();
  });
});
