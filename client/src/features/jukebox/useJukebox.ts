import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, generateIdempotencyKey, getAxiosError, getErrorMessage, unwrap } from '../../lib/api';
import { useSocketEvent } from '../../lib/socket';
export function jukeboxUuid() {
  const h = generateIdempotencyKey();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20)}`;
}
export function useJukeboxQuery<T>(key: string, url: string) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['jukebox', key],
    queryFn: async () => unwrap<T>(await api.get(url)),
    refetchInterval: 5000,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['jukebox'] });
  };
  useSocketEvent('jukebox.changed', refresh);
  useSocketEvent('tableSession.statusChanged', refresh);
  useSocketEvent('connect', refresh);
  const accept = async (value: T) => {
    await qc.cancelQueries({ queryKey: ['jukebox', key] });
    qc.setQueryData(['jukebox', key], value);
  };
  return { ...query, refresh, accept };
}
export interface JukeboxPending {
  url: string;
  method: 'post' | 'put';
  body: Record<string, unknown>;
}
// Keep an uncertain request across reload. Editing is blocked until exact retry resolves.
export function useJukeboxAction(key: string, refresh: () => void) {
  const [pending, setPending] = useState<JukeboxPending | null>(() => {
    try {
      const p = JSON.parse(sessionStorage.getItem(key) ?? 'null') as JukeboxPending | null;
      return p &&
        /^\/(?:admin\/)?jukebox\/(?:vote|tracks(?:\/[a-f\d]{24})?)$/.test(p.url) &&
        ['post', 'put'].includes(p.method) &&
        typeof p.body?.requestId === 'string'
        ? p
        : null;
    } catch {
      return null;
    }
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const flight = useRef(false);
  async function submit(action: JukeboxPending): Promise<boolean> {
    if (flight.current) return false;
    flight.current = true;
    setBusy(true);
    setError('');
    try {
      sessionStorage.setItem(key, JSON.stringify(action));
      setPending(action);
      await api[action.method](action.url, action.body);
      sessionStorage.removeItem(key);
      setPending(null);
      refresh();
      return true;
    } catch (err) {
      const status = getAxiosError(err)?.response?.status;
      if (status && status < 500) {
        sessionStorage.removeItem(key);
        setPending(null);
      }
      setError(getErrorMessage(err));
      refresh();
      return false;
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  return { pending, busy, error, submit, locked: busy || !!pending };
}
