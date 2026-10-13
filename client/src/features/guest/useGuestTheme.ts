import { useLayoutEffect } from 'react';

const GUEST_BACKGROUND = '#E8EFEA';

export function useGuestTheme(enabled: boolean): void {
  useLayoutEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    const meta = document.querySelector('meta[name="theme-color"]');
    const previousColor = meta?.getAttribute('content') ?? null;
    root.classList.add('theme-guest');
    meta?.setAttribute('content', GUEST_BACKGROUND);
    return () => {
      root.classList.remove('theme-guest');
      if (previousColor) meta?.setAttribute('content', previousColor);
    };
  }, [enabled]);
}
