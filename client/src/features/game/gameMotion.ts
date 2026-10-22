import { useEffect, useRef, useState } from 'react';

export function createShakeDetector(onShake: () => void, clock = Date.now) {
  const armedAt = clock();
  let previous: number | null = null,
    peaks = 0,
    lastPeak = -Infinity,
    lastShake = -Infinity;
  return (event: Pick<DeviceMotionEvent, 'accelerationIncludingGravity'>) => {
    const a = event.accelerationIncludingGravity;
    if (!a || ![a.x, a.y, a.z].every((v) => typeof v === 'number' && Number.isFinite(v))) return;
    const magnitude = Math.hypot(a.x!, a.y!, a.z!),
      now = clock();
    const delta = previous === null ? 0 : Math.abs(magnitude - previous);
    previous = magnitude;
    if (now - armedAt < 800 || now - lastShake < 2000 || delta < 12 || now - lastPeak < 120) return;
    if (now - lastPeak > 700) peaks = 0;
    lastPeak = now;
    peaks++;
    if (peaks >= 2) {
      peaks = 0;
      lastShake = now;
      onShake();
    }
  };
}

export function useShakeToSpin(key: string, enabled: boolean, onSpin: () => void) {
  const [armedFor, setArmedFor] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const callback = useRef(onSpin);
  callback.current = onSpin;
  const generation = useRef({ value: 0 }),
    allowed = useRef(enabled);
  allowed.current = enabled;
  const armed = enabled && armedFor === key;
  useEffect(() => {
    const state = generation.current;
    state.value++;
    if (!enabled) setArmedFor(null);
    return () => {
      state.value++;
    };
  }, [key, enabled]);
  useEffect(() => {
    if (!armed) return;
    const detector = createShakeDetector(() => {
      setArmedFor(null);
      callback.current();
    });
    const listener = (event: DeviceMotionEvent) => {
      if (allowed.current && document.visibilityState === 'visible') detector(event);
    };
    const hide = () => {
      if (document.visibilityState !== 'visible') setArmedFor(null);
    };
    window.addEventListener('devicemotion', listener);
    document.addEventListener('visibilitychange', hide);
    return () => {
      window.removeEventListener('devicemotion', listener);
      document.removeEventListener('visibilitychange', hide);
    };
  }, [armed]);
  const start = async () => {
    const Motion = (
      window as unknown as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } }
    ).DeviceMotionEvent;
    if (!enabled) return;
    if (!window.isSecureContext || !Motion) {
      setMessage('Lắc cần HTTPS và cảm biến được hỗ trợ. Bạn vẫn có thể bấm Quay.');
      return;
    }
    const attempt = ++generation.current.value;
    try {
      const permission = Motion.requestPermission ? await Motion.requestPermission() : 'granted';
      if (attempt !== generation.current.value || !allowed.current) return;
      if (permission !== 'granted') {
        setMessage('Chưa được cấp quyền cảm biến. Hãy dùng nút Quay.');
        return;
      }
      setArmedFor(key);
      setMessage('Đã bật lắc cho vòng này. Nếu thiết bị không có tín hiệu, hãy dùng nút Quay.');
    } catch {
      if (attempt === generation.current.value)
        setMessage('Không bật được cảm biến. Hãy dùng nút Quay.');
    }
  };
  return {
    armed,
    message,
    start,
    stop: () => {
      generation.current.value++;
      setArmedFor(null);
    },
  };
}
