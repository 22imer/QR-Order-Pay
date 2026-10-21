import { useCallback, useEffect, useRef } from 'react';
import { useSocketEvent } from '../../lib/socket';

interface OrderIdentity {
  _id: string;
}

export function useNewOrderAlerts(
  identity: string | undefined,
  tables: OrderIdentity[] | undefined,
  pickups: OrderIdentity[] | undefined,
  notify: (pickup: boolean, count: number) => void,
): void {
  const state = useRef({
    identity,
    seen: new Set<string>(),
    tablesReady: false,
    pickupsReady: false,
  });
  if (state.current.identity !== identity)
    state.current = { identity, seen: new Set(), tablesReady: false, pickupsReady: false };
  const remember = useCallback((id: string) => {
    const seen = state.current.seen;
    if (seen.has(id)) return false;
    seen.add(id);
    if (seen.size > 2000) seen.delete(seen.values().next().value!);
    return true;
  }, []);

  // Notify directly from creation, including unpaid orders. Polling catches
  // arrivals missed during a disconnect without treating initial history as new.
  useSocketEvent('order.created', (data) => {
    const order = data as { orderId?: string; tableSessionId?: string } | undefined;
    if (order?.orderId && remember(order.orderId)) notify(!order.tableSessionId, 1);
  });
  useEffect(() => {
    for (const [items, pickup, ready] of [
      [tables, false, 'tablesReady'],
      [pickups, true, 'pickupsReady'],
    ] as const) {
      if (!items) continue;
      const count = items.filter((item) => remember(item._id)).length;
      if (state.current[ready] && count > 0) notify(pickup, count);
      state.current[ready] = true;
    }
  }, [tables, pickups, remember, notify]);
}
