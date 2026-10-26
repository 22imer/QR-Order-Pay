import { useEffect, useRef } from 'react';

const SOUND_KEY = 'mc-staff-sound-enabled';

export function isSoundEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(SOUND_KEY) !== 'false';
}

export function setSoundEnabled(v: boolean): void {
  localStorage.setItem(SOUND_KEY, v ? 'true' : 'false');
}

let audioCtx: AudioContext | null = null;

export function unlockAlertAudio(): void {
  if (!isSoundEnabled()) return;
  const ctx = getCtx();
  if (ctx?.state === 'suspended') void ctx.resume().catch(() => undefined);
}

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (audioCtx) return audioCtx;
  try {
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
    return audioCtx;
  } catch {
    return null;
  }
}

export function playAlert(kind: 'order' | 'request' | 'payment' = 'order'): void {
  if (!isSoundEnabled()) return;
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  const now = ctx.currentTime;
  const seq = kind === 'order'
    ? [880, 1175]
    : kind === 'request'
      ? [660, 880]
      : [1040];
  for (let i = 0; i < seq.length; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = seq[i] ?? 880;
    gain.gain.setValueAtTime(0.0001, now + i * 0.18);
    gain.gain.exponentialRampToValueAtTime(0.18, now + i * 0.18 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.16);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + i * 0.18);
    osc.stop(now + i * 0.18 + 0.18);
  }
}

export function notifyBrowser(title: string, body: string, onClick?: () => void): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    const notice = new Notification(title, { body, silent: !isSoundEnabled() });
    notice.onclick = () => { window.focus(); onClick?.(); notice.close(); };
  } catch {
    /* ignore */
  }
}

export function requestNotifyPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) return Promise.resolve('denied');
  if (Notification.permission !== 'default') return Promise.resolve(Notification.permission);
  return Notification.requestPermission();
}

export function useCountDelta(
  current: number | undefined,
  onIncrease: (delta: number) => void,
): void {
  const prev = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (current === undefined) return;
    const before = prev.current;
    prev.current = current;
    if (before === undefined) return;
    if (current > before) onIncrease(current - before);
  }, [current, onIncrease]);
}
