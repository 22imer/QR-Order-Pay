import { useCallback, useEffect, useRef, useState } from 'react';
import { api, generateIdempotencyKey, unwrap } from '../../lib/api';

export function usePaymentClaim(sessionId: string, open: boolean) {
  const token = useRef(generateIdempotencyKey());
  const [expiresAt, setExpiresAt] = useState(0);
  const [version, setVersion] = useState(0);
  const [now, setNow] = useState(Date.now());
  const acquire = useCallback(async () => {
    const result = unwrap<{ expiresAt: string; version: number }>(
      await api.post(`/staff/table-sessions/${sessionId}/payment-claim`, { token: token.current }),
    );
    setExpiresAt(new Date(result.expiresAt).getTime());
    setVersion(result.version);
    setNow(Date.now());
    return result;
  }, [sessionId]);
  const release = useCallback(async () => {
    setExpiresAt(0);
    await api.post(`/staff/table-sessions/${sessionId}/payment-claim/release`, {
      token: token.current,
    });
  }, [sessionId]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const renew = setInterval(() => {
      void acquire()
        .then(() => {
          if (cancelled) void release().catch(() => {});
        })
        .catch(() => {
          /* Disable when the last confirmed lease expires. */
        });
    }, 30_000);
    const clock = setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      cancelled = true;
      clearInterval(renew);
      clearInterval(clock);
      void release().catch(() => {});
    };
  }, [open, acquire, release]);
  return { acquire, release, token: token.current, version, valid: now < expiresAt };
}
