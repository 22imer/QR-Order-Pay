import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CompanionResult } from '@may-cafe/contracts';
import { api, unwrap, vnd, getErrorMessage } from '../../lib/api';
import type { CartItem } from '../../store/cart';
import { ProductDetailModal, type Product, type Topping } from '../guest/ProductDetailModal';
import { Button } from '../../components/ui/Button';
export function CompanionSuggestions({
  items,
  context,
  disabled = false,
  onAdd,
}: {
  items: { productId: string; freestyleToken?: string }[];
  context: 'TABLE' | 'PICKUP';
  disabled?: boolean;
  onAdd: (item: Omit<CartItem, 'clientId'>) => void | false;
}): JSX.Element | null {
  const ids = [...new Set(items.filter((i) => !i.freestyleToken).map((i) => i.productId))].sort(),
    signature = ids.slice(0, 10).join(',');
  const [selected, setSelected] = useState<{ product: Product; toppings: Topping[] } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const alive = useRef(true),
    locked = useRef(disabled);
  locked.current = disabled;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (disabled) setSelected(null);
  }, [disabled]);
  const query = useQuery({
    queryKey: ['companions', context, signature],
    enabled: !!signature && !disabled,
    queryFn: async ({ signal }) =>
      unwrap<CompanionResult>(
        await api.get('/recommendations/companions', {
          params: { context, productIds: signature },
          signal,
        }),
      ),
    staleTime: 60000,
  });
  async function choose(id: string) {
    if (busy || locked.current) return;
    setBusy(true);
    setError('');
    try {
      const menu = unwrap<{ products: Product[]; toppings: Topping[] }>(
          await api.get('/categories'),
        ),
        p = menu.products.find((p) => p._id === id && p.isAvailable);
      if (!alive.current || locked.current) return;
      if (!p) throw new Error('Món vừa hết hoặc ngừng bán. Hãy chọn món khác.');
      setSelected({ product: p, toppings: menu.toppings });
    } catch (e) {
      if (alive.current) setError(getErrorMessage(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const suggestions = (query.data?.items ?? []).filter((p) => !ids.includes(p.productId));
  if (!signature) return null;
  return (
    <>
      {suggestions.length > 0 && (
        <section aria-label="Khách thường gọi kèm" className="space-y-3 rounded-2xl border p-4">
          <h3 className="font-semibold">Khách thường gọi kèm</h3>
          <p className="text-xs text-muted-foreground">
            Từ các đơn hoàn tất gần đây. Bạn chọn size và tùy chỉnh trước khi thêm.
          </p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((p) => (
              <Button
                key={p.productId}
                variant="outline"
                disabled={disabled || busy}
                onClick={() => void choose(p.productId)}
              >
                Chọn {p.name} · từ {vnd(p.unitPrice)}
              </Button>
            ))}
          </div>
        </section>
      )}
      {error && <p role="alert">{error}</p>}
      {selected && !disabled && (
        <ProductDetailModal
          key={selected.product._id}
          product={selected.product}
          toppings={selected.toppings}
          onClose={() => setSelected(null)}
          onAdded={() => setSelected(null)}
          onAdd={(item) => {
            if (!alive.current || locked.current) return false;
            return onAdd(item);
          }}
        />
      )}
    </>
  );
}
