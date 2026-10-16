import { useLayoutEffect } from 'react';
import '../../styles/guest-surfaces.css';

const GUEST_BACKGROUND = '#101d18';

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
