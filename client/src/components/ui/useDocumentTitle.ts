import { useEffect } from 'react';

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} — Fantastic cafe`;
    return () => {
      document.title = 'Fantastic cafe — QR Ordering & AI Barista';
    };
  }, [title]);
}
