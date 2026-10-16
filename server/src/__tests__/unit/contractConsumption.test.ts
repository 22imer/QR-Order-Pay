import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

const confirmPayment = vi.fn();
const loginSvc = vi.fn();
const refreshSvc = vi.fn();

vi.mock('../../services/paymentService.js', () => ({
  confirmPayment: (...args: unknown[]) => confirmPayment(...args),
  buildBill: vi.fn(),
}));
vi.mock('../../realtime/socket.js', () => ({
  closeSessionSockets: vi.fn(),
  publishSession: vi.fn(),
  publishStaff: vi.fn(),
}));
vi.mock('../../services/authService.js', () => ({
  login: (...args: unknown[]) => loginSvc(...args),
  refresh: (...args: unknown[]) => refreshSvc(...args),
  logout: vi.fn(),
  logoutAll: vi.fn(),
}));
vi.mock('../../controllers/cookieHelpers.js', () => ({
  setRefreshCookie: vi.fn(),
  clearRefreshCookie: vi.fn(),
  refreshCookieName: vi.fn(() => 'mc_refresh'),
}));

import { confirm as paymentConfirm } from '../../controllers/paymentController.js';
import { login as authLogin, refresh as authRefresh } from '../../controllers/authController.js';

const staffUser = { id: 'u1', role: 'STAFF' as const, name: 'Staff A' };

function fakeReq(overrides: Partial<Record<string, unknown>>): Request {
  return {
    user: staffUser,
    params: { id: 's1' },
    body: {},
    headers: { 'idempotency-key': 'idem-key-12345' },
    get: () => undefined,
    ...overrides,
  } as unknown as Request;
}

function fakeRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as unknown as Response;
}

const next = vi.fn() as NextFunction & Mock;

beforeEach(() => {
  confirmPayment.mockReset();
  loginSvc.mockReset();
  refreshSvc.mockReset();
  next.mockReset();
});

describe('paymentController.confirm consumes the shared payment contract', () => {
  it('accepts a valid payment request and forwards parsed fields to the service', async () => {
    confirmPayment.mockResolvedValue({
      replayed: false,
      payment: { id: 'pay1' },
      orderIds: ['o1'],
      billId: 'b1',
    });
    const req = fakeReq({
      body: { amount: 70000, method: 'CASH', expectedVersion: 3, note: 'Đủ tiền mặt' },
    });
    const res = fakeRes();
    await paymentConfirm(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(confirmPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 70000,
        method: 'CASH',
        expectedVersion: 3,
        tableSessionId: 's1',
        idempotencyKey: 'idem-key-12345',
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('rejects a negative amount with VALIDATION_ERROR', async () => {
    const req = fakeReq({ body: { amount: -5000, method: 'CASH', expectedVersion: 3 } });
    await paymentConfirm(req, fakeRes(), next);
    const err = next.mock.calls[0]?.[0];
    expect(err).toBeInstanceOf(ZodError);
  });

  it('rejects an unsupported payment method', async () => {
    const req = fakeReq({ body: { amount: 70000, method: 'CARD', expectedVersion: 3 } });
    await paymentConfirm(req, fakeRes(), next);
    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(ZodError);
  });

  it('rejects a non-integer expectedVersion (optimistic version must be integral)', async () => {
    const req = fakeReq({ body: { amount: 70000, method: 'BANK_TRANSFER', expectedVersion: 1.5 } });
    await paymentConfirm(req, fakeRes(), next);
    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(ZodError);
  });

  it('still requires the Idempotency-Key header', async () => {
    const req = fakeReq({
      body: { amount: 70000, method: 'CASH', expectedVersion: 3 },
      headers: {},
    });
    await paymentConfirm(req, fakeRes(), next);
    const err = next.mock.calls[0]?.[0] as { code?: string };
    expect(err?.code).toBe('VALIDATION_ERROR');
    expect(confirmPayment).not.toHaveBeenCalled();
  });
});

describe('authController consumes the shared auth response contract', () => {
  const validResult = {
    accessToken: 'access-token-1',
    refreshToken: 'refresh-token-1',
    refreshExpiresAt: new Date('2026-10-20T00:00:00.000Z'),
    user: { id: 'u1', name: 'Staff A', email: 'staff.a@maycafe.vn', role: 'STAFF' },
  };

  it('login emits an auth response matching the shared schema', async () => {
    loginSvc.mockResolvedValue(validResult);
    const req = {
      body: { email: 'staff.a@maycafe.vn', password: 'MayCafe@2025' },
      headers: {},
      ip: '127.0.0.1',
    } as unknown as Request;
    const res = { cookie: vi.fn(), json: vi.fn() } as unknown as Response;
    await authLogin(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { accessToken: 'access-token-1', user: validResult.user },
    });
  });

  it('login refuses to emit a payload violating the shared schema (invalid role)', async () => {
    loginSvc.mockResolvedValue({ ...validResult, user: { ...validResult.user, role: 'GUEST' } });
    const req = {
      body: { email: 'staff.a@maycafe.vn', password: 'MayCafe@2025' },
      headers: {},
      ip: '127.0.0.1',
    } as unknown as Request;
    const res = { cookie: vi.fn(), json: vi.fn() } as unknown as Response;
    await authLogin(req, res, next);
    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(ZodError);
    expect(res.json).not.toHaveBeenCalled();
  });

  it('refresh emits an auth response matching the shared schema', async () => {
    refreshSvc.mockResolvedValue(validResult);
    const req = {
      cookies: { mc_refresh: 'refresh-token-1' },
      headers: {},
      ip: '127.0.0.1',
    } as unknown as Request;
    const res = { cookie: vi.fn(), json: vi.fn() } as unknown as Response;
    await authRefresh(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { accessToken: 'access-token-1', user: validResult.user },
    });
  });
});
