import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CurrentTableSessionResponse, OrderQuoteResponse } from '@may-cafe/contracts';
import { getAxiosError } from '../../lib/api';
import { Trash2, ShoppingBag, TriangleAlert } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { QtyStepper } from './QtyStepper';
import { useGuestContext } from './guestContext';
import { useCart, cartTotals } from '../../store/cart';
import { api, generateIdempotencyKey, getErrorMessage, unwrap, vnd } from '../../lib/api';
import { useToast } from '../../components/ui/useToast';
import { EmptyState } from '../../components/ui/EmptyState';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';

export function CartPage(): JSX.Element {
  useDocumentTitle('Giỏ hàng');
  const navigate = useNavigate();
  const items = useCart((s) => s.items);
  const remove = useCart((s) => s.remove);
  const update = useCart((s) => s.update);
  const clear = useCart((s) => s.clear);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const tableName = useGuestContext()?.tableName ?? null;
  const submission = useRef<{ payload: string; key: string } | null>(null);
  const [quote, setQuote] = useState<OrderQuoteResponse | null>(null);
  const sessionQuery = useQuery({
    queryKey: ['guest-session'],
    queryFn: async () =>
      unwrap(await api.get<CurrentTableSessionResponse>('/table-sessions/current')),
  });

  const { subtotal } = cartTotals(items);
  const orderPayload = useMemo(
    () => ({
      items: items.map((it) => ({
        productId: it.productId,
        variantId: it.variantId,
        sugarLevel: it.sugarLevel,
        iceLevel: it.iceLevel,
        toppingIds: it.toppingIds,
        note: it.note,
        quantity: it.quantity,
      })),
    }),
    [items],
  );
  const cartSignature = JSON.stringify(orderPayload);
  useEffect(() => {
    setQuote(null);
    submission.current = null;
  }, [cartSignature]);

  const placeMutation = useMutation({
    mutationFn: async () => {
      let checkedQuote = quote;
      if (!checkedQuote) {
        checkedQuote = unwrap<OrderQuoteResponse>(await api.post('/orders/quote', orderPayload));
        setQuote(checkedQuote);
        // Only a changed price needs another confirmation; the normal flow sends immediately.
        if (checkedQuote.total !== subtotal) return false;
      }
      const payload = { ...orderPayload, quoteToken: checkedQuote.quoteToken };
      const signature = JSON.stringify({
        session: useCart.getState().tableSessionId,
        orderPayload,
      });
      if (submission.current?.payload !== signature)
        submission.current = { payload: signature, key: generateIdempotencyKey() };
      await api.post('/orders', payload, {
        headers: { 'Idempotency-Key': submission.current.key },
      });
      return true;
    },
    onSuccess: (sent) => {
      if (!sent) return;
      toast({
        title: 'Đã gửi đơn chờ thanh toán',
        description: 'Vui lòng thanh toán với nhân viên để đơn được chuyển sang pha chế.',
        tone: 'success',
      });
      clear();
      submission.current = null;
      queryClient.invalidateQueries({ queryKey: ['my-orders'] });
      navigate('/orders');
    },
    onError: (err) => {
      const errorData = getAxiosError(err)?.response?.data as
        { error?: { code?: string } } | undefined;
      // Giữ nguyên key cho mọi lỗi khác: gửi lại cùng key chỉ nhận về đơn cũ nếu đơn đã được
      // tạo, nên không thể sinh đơn trùng. Key chỉ phải đổi khi server báo đã dùng cho nội dung khác.
      if (errorData?.error?.code === 'IDEMPOTENCY_CONFLICT') submission.current = null;
      if (errorData?.error?.code === 'QUOTE_CHANGED') setQuote(null);
      toast({ title: 'Không gửi được đơn', description: getErrorMessage(err), tone: 'danger' });
    },
  });

  const groupedItems = useMemo(() => items, [items]);

  if (groupedItems.length === 0) {
    return (
      <EmptyState
        title="Giỏ hàng trống"
        description="Hãy quay lại thực đơn và chọn món bạn thích."
        icon={<ShoppingBag className="h-6 w-6" />}
        action={
          <Button variant="primary" onClick={() => navigate('/menu')}>
            Xem menu
          </Button>
        }
      />
    );
  }

  const priceChanged = quote !== null && quote.total !== subtotal;

  return (
    <div className="space-y-6 pt-2">
      <h1 className="g-display text-[2.25rem]">Giỏ hàng của bạn</h1>

      <div className="slip-wrap">
        <div className="slip px-5 pt-5">
          <div className="flex items-end justify-between gap-3">
            <p className="g-title text-lg">Phiếu gọi món</p>
            {tableName ? <p className="font-semibold">{tableName}</p> : null}
          </div>
          <div className="slip-rule mt-4" />

          <fieldset disabled={placeMutation.isPending} className="min-w-0">
            <ul className="space-y-5 py-5">
              {groupedItems.map((it) => (
                <li key={it.clientId} className="flex gap-3">
                  <img
                    src={it.image}
                    alt=""
                    className="h-14 w-14 shrink-0 rounded-xl bg-muted object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-end gap-2">
                      <p className="font-semibold leading-snug">
                        {it.name}
                        {it.variantName ? ` (${it.variantName})` : ''}
                      </p>
                      <span className="leader" aria-hidden="true" />
                      <p className="font-semibold tabular-nums">
                        {vnd(it.unitPrice * it.quantity)}
                      </p>
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      Đường {it.sugarLevel}, {labelIce(it.iceLevel)}
                      {it.toppingIds.length > 0 ? `, thêm ${it.toppingIds.length} topping` : ''}
                    </p>
                    {it.note ? (
                      <p className="text-sm italic text-muted-foreground">“{it.note}”</p>
                    ) : null}
                    <div className="mt-2 flex items-center justify-between">
                      <QtyStepper
                        value={it.quantity}
                        onChange={(quantity) => update(it.clientId, { quantity })}
                      />
                      <button
                        type="button"
                        onClick={() => remove(it.clientId)}
                        className="grid h-10 w-10 place-items-center rounded-full text-muted-foreground transition hover:bg-danger/10 hover:text-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                        aria-label="Xoá món"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </fieldset>

          <div className="slip-rule" />
          <dl className="space-y-2 pt-4">
            <div className="flex justify-between text-sm">
              <dt className="text-muted-foreground">Tạm tính</dt>
              <dd className="tabular-nums">{vnd(subtotal)}</dd>
            </div>
            <div className="flex items-end justify-between gap-3">
              <dt className="g-title text-lg">Tổng</dt>
              <dd className="g-display text-3xl tabular-nums">{vnd(quote?.total ?? subtotal)}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="space-y-3">
        {quote && priceChanged ? (
          <div
            role="alert"
            className="flex items-start gap-3 border-l-4 border-accent bg-card py-3 pl-4 pr-3 text-sm"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>
              Giá món đã thay đổi: tổng mới {vnd(quote.total)} (trước đó {vnd(subtotal)}). Bấm đặt
              món nếu bạn đồng ý với giá mới.
            </p>
          </div>
        ) : null}
        {sessionQuery.data?.active && sessionQuery.data.status === 'CHECKOUT' ? (
          <p className="text-sm text-muted-foreground">
            Bàn đang thanh toán, vui lòng nhờ nhân viên mở lại để gọi thêm món.
          </p>
        ) : null}
        <Button
          size="lg"
          className="w-full"
          onClick={() => placeMutation.mutate()}
          disabled={
            placeMutation.isPending ||
            !sessionQuery.data?.active ||
            sessionQuery.data.status !== 'OPEN'
          }
        >
          {placeMutation.isPending
            ? 'Đang đặt món...'
            : priceChanged
              ? `Đặt món · ${vnd(quote!.total)}`
              : 'Đặt món'}
        </Button>
      </div>
    </div>
  );
}

function labelIce(v: string): string {
  return v === 'no-ice' ? 'không đá' : v === 'less-ice' ? 'ít đá' : 'đá thường';
}
