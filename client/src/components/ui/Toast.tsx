import * as ToastPrimitive from '@radix-ui/react-toast';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { ToastContext, type ToastApi, type ToastItem } from './useToast';

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [items, setItems] = useState<ToastItem[]>([]);

  const toast = useCallback<ToastApi['toast']>((input) => {
    const id = Math.random().toString(36).slice(2);
    setItems((prev) => [...prev, { ...input, id }]);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      <ToastPrimitive.Provider swipeDirection="right">
        {children}
        {items.map((t) => (
          <ToastPrimitive.Root
            key={t.id}
            duration={t.onClick ? 8000 : 4200}
            className={`data-[state=open]:animate-in data-[state=open]:slide-in-from-right-full pointer-events-auto rounded-xl border bg-card p-3 shadow-soft flex items-start gap-3 ${
              t.tone === 'danger'
                ? 'border-danger/30'
                : t.tone === 'success'
                  ? 'border-success/30'
                  : 'border-foreground/10'
            }`}
            onOpenChange={(open) => {
              if (!open) setItems((prev) => prev.filter((i) => i.id !== t.id));
            }}
          >
            {t.onClick ? (
              <button
                type="button"
                aria-label={`Mở: ${t.title}`}
                className="min-w-0 flex-1 rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                onClick={() => {
                  t.onClick?.();
                  setItems((prev) => prev.filter((i) => i.id !== t.id));
                }}
              >
                <ToastPrimitive.Title asChild>
                  <span className="block text-sm font-semibold text-foreground">{t.title}</span>
                </ToastPrimitive.Title>
                {t.description ? (
                  <ToastPrimitive.Description asChild>
                    <span className="block text-xs text-muted-foreground">{t.description}</span>
                  </ToastPrimitive.Description>
                ) : null}
                <span className="mt-1 block text-xs font-semibold text-primary">
                  Bấm để mở chức năng →
                </span>
              </button>
            ) : (
              <div className="min-w-0 flex-1">
                <ToastPrimitive.Title className="text-sm font-semibold text-foreground">
                  {t.title}
                </ToastPrimitive.Title>
                {t.description ? (
                  <ToastPrimitive.Description className="text-xs text-muted-foreground">
                    {t.description}
                  </ToastPrimitive.Description>
                ) : null}
              </div>
            )}
            <ToastPrimitive.Close
              className="text-foreground/60 hover:text-foreground"
              aria-label="Đóng"
            >
              <X className="h-4 w-4" />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport className="fixed top-4 right-4 z-[60] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2 outline-none" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}
