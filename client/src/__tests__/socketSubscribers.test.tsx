// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
const mock = vi.hoisted(() => ({ handlers: new Map<string, Set<(data: unknown) => void>>() }));
vi.mock('socket.io-client', () => ({
  io: () => ({
    on: (event: string, fn: (data: unknown) => void) => {
      if (!mock.handlers.has(event)) mock.handlers.set(event, new Set());
      mock.handlers.get(event)!.add(fn);
    },
    off: (event: string, fn: (data: unknown) => void) => mock.handlers.get(event)?.delete(fn),
    disconnect: () => mock.handlers.clear(),
  }),
}));
import { connectStaffSocket, disconnectSocket, useSocketEvent } from '../lib/socket';
afterEach(() => {
  cleanup();
  disconnectSocket();
});
describe('socket subscriptions', () => {
  it('delivers one envelope to both layout and page, while deduplicating replay for each', () => {
    const layout = vi.fn(),
      page = vi.fn();
    renderHook(() => {
      useSocketEvent('order.created', layout);
      useSocketEvent('order.created', page);
    });
    connectStaffSocket('test');
    const envelope = {
      eventId: 'event-1',
      eventType: 'order.created',
      schemaVersion: 1,
      entityId: 'order-1',
      entityVersion: 1,
      occurredAt: new Date().toISOString(),
      data: { orderId: 'order-1' },
    };
    act(() => {
      for (let i = 0; i < 2; i++)
        for (const fn of mock.handlers.get('order.created')!) fn(envelope);
    });
    expect(layout).toHaveBeenCalledOnce();
    expect(page).toHaveBeenCalledOnce();
  });
});
