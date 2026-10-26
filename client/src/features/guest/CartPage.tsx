import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMember } from './useMember';
import { Input } from '../../components/ui/Input';
import { BenefitBreakdown } from '../../components/BenefitBreakdown';
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
import { MenuPhoto } from './MenuPhoto';
import { CupPhotoPicker } from '../cupPhotos/CupPhotoPicker';
import { FreestyleRecipe } from '../../components/FreestyleRecipe';
import { CompanionSuggestions } from '../insights/CompanionSuggestions';

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
  const [photoBusy, setPhotoBusy] = useState(false);
  const memberQuery = useMember();
  const member = memberQuery.data?.member;
  const [voucherCode, setVoucherCode] = useState('');
  const [redeemPoints, setRedeemPoints] = useState(0);
  const [benefitError, setBenefitError] = useState('');
  const [benefitPreview, setBenefitPreview] = useState<{
    context: string;
    quote: OrderQuoteResponse;
  } | null>(null);
  const sessionQuery = useQuery({
    queryKey: ['guest-session'],
    queryFn: async () =>
      unwrap(await api.get<CurrentTableSessionResponse>('/table-sessions/current')),
  });

  const { subtotal } = cartTotals(items);
  const orderPayload = useMemo(
    () => ({
      ...(voucherCode.trim() ? { voucherCode: voucherCode.trim().toUpperCase() } : {}),
      ...(redeemPoints ? { redeemPoints } : {}),
      items: items.map((it) => ({
        productId: it.productId,
        variantId: it.variantId,
        sugarLevel: it.sugarLevel,
        iceLevel: it.iceLevel,
        toppingIds: it.toppingIds,
        note: it.note,
        quantity: it.quantity,
        ...(it.cupPhotoId ? { cupPhotoId: it.cupPhotoId } : {}),
        ...(it.freestyleToken ? { freestyleToken: it.freestyleToken } : {}),
      })),
    }),
    [items, voucherCode, redeemPoints],
  );
  const cartSignature = JSON.stringify(orderPayload);
  const benefitContext = JSON.stringify({
    items: orderPayload.items,
    voucherCode: orderPayload.voucherCode,
    memberId: member?.id,
  });
  const checkedBenefits = benefitPreview?.context === benefitContext ? benefitPreview.quote : null;
  const maxRedeemPoints = orderPayload.voucherCode
    ? checkedBenefits?.maxRedeemPoints === undefined
      ? undefined
      : Math.min(member?.points ?? 0, checkedBenefits.maxRedeemPoints)
    : Math.min(member?.points ?? 0, Math.floor(subtotal / 2000));
  useEffect(() => {
    setQuote(null);
    submission.current = null;
    setBenefitError('');
  }, [cartSignature, member?.id]);
  const preview = useMutation({
    mutationFn: async () => {
      // Read voucher policy/cap even if the full selection is later rejected.
      if (orderPayload.voucherCode && redeemPoints > 0 && !checkedBenefits) {
        const voucherQuote = unwrap<OrderQuoteResponse>(
          await api.post('/orders/quote', { ...orderPayload, redeemPoints: 0 }),
        );
        setBenefitPreview({ context: benefitContext, quote: voucherQuote });
      }
      return unwrap<OrderQuoteResponse>(await api.post('/orders/quote', orderPayload));
    },
    onSuccess: (data) => {
      setQuote(data);
      setBenefitPreview({ context: benefitContext, quote: data });
      setBenefitError('');
    },
    onError: (e) => {
      setQuote(null);
      setBenefitError(getErrorMessage(e));
    },
  });

  const placeMutation = useMutation({
    mutationFn: async () => {
      let checkedQuote = quote;
      if (!checkedQuote) {
        checkedQuote = unwrap<OrderQuoteResponse>(await api.post('/orders/quote', orderPayload));
        setQuote(checkedQuote);
        setBenefitPreview({ context: benefitContext, quote: checkedQuote });
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
      queryClient.invalidateQueries({ queryKey: ['member'] });
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

  const priceChanged = quote !== null && (quote.subtotal ?? quote.total) !== subtotal;
  const busy = placeMutation.isPending || preview.isPending || photoBusy;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 pt-2">
      <h1 className="g-display text-[2.25rem]">Giỏ hàng của bạn</h1>

      <div className="slip-wrap">
        <div className="slip px-5 pt-5">
          <div className="flex items-end justify-between gap-3">
            <p className="g-title text-lg">Phiếu gọi món</p>
            {tableName ? <p className="font-semibold">{tableName}</p> : null}
          </div>
          <div className="slip-rule mt-4" />

          <fieldset disabled={busy} className="min-w-0">
            <ul className="space-y-5 py-5">
              {groupedItems.map((it) => (
                <li key={it.clientId} className="flex gap-3">
                  <MenuPhoto source={it.image} className="h-14 w-14 shrink-0 rounded-xl" />
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
                    <FreestyleRecipe value={it.freestyle} />
                    <CupPhotoPicker
                      label={`Ảnh in tem cho ${it.name}`}
                      photoId={it.cupPhotoId}
                      disabled={busy}
                      onBusyChange={setPhotoBusy}
                      onChange={(cupPhotoId) => update(it.clientId, { cupPhotoId })}
                    />
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
          {sessionQuery.data?.active && sessionQuery.data.status === 'OPEN' && (
            <CompanionSuggestions
              key={`${sessionQuery.data.tableSessionId}:${sessionQuery.data.participantId}`}
              context="TABLE"
              items={items}
              disabled={busy}
              onAdd={(item) => {
                const s = queryClient.getQueryData<CurrentTableSessionResponse>(['guest-session']),
                  c = useCart.getState();
                if (
                  !s?.active ||
                  s.status !== 'OPEN' ||
                  c.tableSessionId !== s.tableSessionId ||
                  c.participantId !== s.participantId
                )
                  return false;
                c.add(item);
              }}
            />
          )}
          <fieldset disabled={busy} className="space-y-3 py-4">
            <legend className="pt-4 font-semibold">Ưu đãi</legend>
            <label className="block text-sm">
              Mã voucher
              <Input
                aria-label="Mã voucher"
                value={voucherCode}
                maxLength={32}
                onChange={(e) => {
                  setVoucherCode(e.target.value);
                }}
                placeholder="Nhập mã giảm giá"
              />
            </label>
            {member ? (
              <label className="block text-sm">
                Đổi điểm (đang có {member.points} điểm)
                <Input
                  aria-label="Điểm muốn đổi"
                  type="number"
                  min={0}
                  max={maxRedeemPoints}
                  step={1}
                  value={redeemPoints}
                  onChange={(e) => {
                    setRedeemPoints(Math.max(0, Number(e.target.value)));
                  }}
                />
              </label>
            ) : (
              <Link to="/member" className="block text-sm underline">
                Đăng nhập thành viên để tích và đổi điểm
              </Link>
            )}
            <details className="text-sm text-muted-foreground">
              <summary className="cursor-pointer py-1">Cách đổi điểm</summary>
              <p className="pt-1">
                1 điểm = 1.000đ, tối đa 50% số tiền sau voucher. Dùng kèm điểm khi voucher cho phép.
              </p>
            </details>
            {orderPayload.voucherCode && !checkedBenefits ? (
              <p className="text-sm text-muted-foreground">
                Kiểm tra ưu đãi để biết voucher có cho dùng kèm điểm và số điểm tối đa.
              </p>
            ) : null}
            {orderPayload.voucherCode && checkedBenefits?.voucherAllowsPoints === false ? (
              <p className="text-sm text-muted-foreground">
                Voucher này không cho phép dùng kèm điểm. Để dùng voucher, đặt số điểm đổi về 0.
              </p>
            ) : maxRedeemPoints !== undefined && member ? (
              <p className="text-sm text-muted-foreground">
                Có thể đổi tối đa {maxRedeemPoints} điểm với lựa chọn hiện tại.
              </p>
            ) : null}
            <Button type="button" variant="ghost" onClick={() => preview.mutate()}>
              Kiểm tra ưu đãi
            </Button>
            {benefitError ? (
              <p role="alert" className="text-sm text-danger">
                {benefitError}
              </p>
            ) : null}
          </fieldset>
          <dl className="space-y-2 pt-4">
            <div className="flex justify-between text-sm">
              <dt className="text-muted-foreground">Tạm tính</dt>
              <dd className="tabular-nums">{vnd(quote?.subtotal ?? subtotal)}</dd>
            </div>
          </dl>
          {quote ? <BenefitBreakdown order={quote} /> : null}
          <dl>
            <div className="flex items-end justify-between gap-3">
              <dt className="g-title text-lg">Tổng</dt>
              <dd className="g-display text-3xl tabular-nums">{vnd(quote?.total ?? subtotal)}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="space-y-3">
        {quote && ((quote.voucherDiscount ?? 0) > 0 || (quote.pointsDiscount ?? 0) > 0) ? (
          <p role="status" className="text-sm">
            Đã kiểm tra ưu đãi. Tổng cần thanh toán: {vnd(quote.total)}.
          </p>
        ) : null}
        {quote && priceChanged ? (
          <div
            role="alert"
            className="flex items-start gap-3 border-l-4 border-accent bg-card py-3 pl-4 pr-3 text-sm"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>
              Giá món đã thay đổi: tiền món mới {vnd(quote.subtotal ?? quote.total)} (trước đó{' '}
              {vnd(subtotal)}). Bấm đặt món nếu bạn đồng ý với giá mới.
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
            busy ||
            memberQuery.isPending ||
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
  if (v === 'Theo công thức') return 'đá theo công thức';
  return v === 'no-ice' ? 'không đá' : v === 'less-ice' ? 'ít đá' : 'đá thường';
}
