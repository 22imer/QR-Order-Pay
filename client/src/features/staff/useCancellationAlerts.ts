import { useCallback, useEffect, useRef } from 'react';
import { useSocketEvent } from '../../lib/socket';

type Kind = 'cancelled' | 'requested';
interface CancelledOrder {
  _id: string;
  code: string;
}
interface CancelRequest {
  _id: string;
  orderId: { code: string } | null;
}

export function useCancellationAlerts(
  identity: string | undefined,
  cancelled: CancelledOrder[] | undefined,
  requested: CancelRequest[] | undefined,
  notify: (kind: Kind, code?: string) => void,
): void {
  const state = useRef({
    identity,
    seen: new Set<string>(),
    cancelledReady: false,
    requestedReady: false,
  });
  if (state.current.identity !== identity)
    state.current = { identity, seen: new Set(), cancelledReady: false, requestedReady: false };
  const remember = useCallback((kind: Kind, id: string) => {
    const seen = state.current.seen;
    const key = `${kind}:${id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    if (seen.size > 2000) seen.delete(seen.values().next().value!);
    return true;
  }, []);

  useSocketEvent('order.statusChanged', (data) => {
    const event = data as { orderId?: string; orderCode?: string; status?: string } | undefined;
    if (event?.status === 'CANCELLED' && event.orderId && remember('cancelled', event.orderId))
      notify('cancelled', event.orderCode);
  });
  useSocketEvent('cancelRequest.created', (data) => {
    const event = data as { requestId?: string; orderCode?: string } | undefined;
    if (event?.requestId && remember('requested', event.requestId))
      notify('requested', event.orderCode);
  });
  useEffect(() => {
    if (cancelled) {
      for (const order of cancelled)
        if (remember('cancelled', order._id) && state.current.cancelledReady)
          notify('cancelled', order.code);
      state.current.cancelledReady = true;
    }
    if (requested) {
      for (const request of requested)
        if (remember('requested', request._id) && state.current.requestedReady)
          notify('requested', request.orderId?.code);
      state.current.requestedReady = true;
    }
  }, [cancelled, requested, remember, notify]);
}
