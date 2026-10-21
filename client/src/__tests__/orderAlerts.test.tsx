// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useNewOrderAlerts } from '../features/staff/useNewOrderAlerts';

const mock = vi.hoisted(() => ({ listeners: new Map<string, (data: unknown) => void>() }));
vi.mock('../lib/socket', () => ({
  useSocketEvent: (event: string, callback: (data: unknown) => void) =>
    mock.listeners.set(event, callback),
}));
beforeEach(() => mock.listeners.clear());
afterEach(cleanup);
describe('new order alerts before payment', () => {
  it('keeps initial history silent and detects new IDs even when the count stays unchanged', () => {
    const notify = vi.fn();
    const { rerender } = renderHook(({ rows }) => useNewOrderAlerts('staff-a', rows, [], notify), {
      initialProps: { rows: [{ _id: 'old' }] },
    });
    expect(notify).not.toHaveBeenCalled();
    rerender({ rows: [{ _id: 'new-unpaid' }] });
    expect(notify).toHaveBeenCalledExactlyOnceWith(false, 1);
  });
  it('announces unpaid pickup/table creations and suppresses socket replay and polling duplicates', () => {
    const notify = vi.fn();
    const { rerender } = renderHook(({ rows }) => useNewOrderAlerts('staff-a', [], rows, notify), {
      initialProps: { rows: [] as { _id: string }[] },
    });
    act(() => {
      mock.listeners.get('order.created')?.({ orderId: 'pickup', status: 'AWAITING_PAYMENT' });
      mock.listeners.get('order.created')?.({ orderId: 'pickup', status: 'AWAITING_PAYMENT' });
      mock.listeners.get('order.created')?.({
        orderId: 'table',
        tableSessionId: 'session',
        status: 'AWAITING_PAYMENT',
      });
    });
    rerender({ rows: [{ _id: 'pickup' }] });
    expect(notify.mock.calls).toEqual([
      [true, 1],
      [false, 1],
    ]);
  });
  it('detects missed pickups on refresh and does not treat the first loaded snapshot as new', () => {
    const notify = vi.fn();
    const { rerender } = renderHook(
      ({ rows }) => useNewOrderAlerts('staff-a', undefined, rows, notify),
      {
        initialProps: { rows: undefined as { _id: string }[] | undefined },
      },
    );
    rerender({ rows: [{ _id: 'old' }] });
    expect(notify).not.toHaveBeenCalled();
    rerender({ rows: [{ _id: 'old' }, { _id: 'missed' }] });
    expect(notify).toHaveBeenCalledExactlyOnceWith(true, 1);
  });
});
