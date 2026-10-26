import { useContext, useEffect, useRef, useState } from 'react';
import { PickupDraftContext } from './pickupDraft';
import { PickupStorefront } from './PickupStorefront';
import { QtyStepper } from '../guest/QtyStepper';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AISheet } from '../ai/AISheet';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  PickupOrder,
  OrderQuoteResponse,
  PickupCreate,
  PaymentMethod,
} from '@may-cafe/contracts';
import { pickupCreateSchema } from '@may-cafe/contracts';
import { ShoppingBag, Plus, Clock3, Sparkles } from 'lucide-react';
import { useMember } from '../guest/useMember';
import { useAuth } from '../auth/useAuth';
import { ProductDetailModal, type Product, type Topping } from '../guest/ProductDetailModal';
import { MenuPhoto } from '../guest/MenuPhoto';
import { CupPhotoPicker } from '../cupPhotos/CupPhotoPicker';
import { FreestyleRecipe } from '../../components/FreestyleRecipe';
import { CompanionSuggestions } from '../insights/CompanionSuggestions';
import type { CartItem } from '../../store/cart';
import {
  api,
  unwrap,
  vnd,
  getErrorMessage,
  getErrorCode,
  getAxiosError,
  generateIdempotencyKey,
} from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { ErrorState } from '../../components/ui/EmptyState';
import { BenefitBreakdown } from '../../components/BenefitBreakdown';
import { useSocketEvent } from '../../lib/socket';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';
import '../staff/paid-bill-print.css';

const time = (s: string) =>
  new Date(s).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
const uuid = () => {
  const a = generateIdempotencyKey().split('');
  a[12] = '4';
  a[16] = ((parseInt(a[16]!, 16) & 3) | 8).toString(16);
  const s = a.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
};
const labels: Record<string, string> = {
  AWAITING_PAYMENT: 'Chờ thanh toán',
  PENDING: 'Chờ xác nhận',
  CONFIRMED: 'Đã nhận đơn',
  PREPARING: 'Đang pha',
  READY: 'Sẵn sàng nhận',
  SERVED: 'Khách đã nhận',
  CANCELLED: 'Đã hủy',
};
interface PendingPickup {
  payload: PickupCreate;
  items: CartItem[];
}
function readPending(key: string): PendingPickup | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null') as PendingPickup | null;
    if (
      !saved ||
      !pickupCreateSchema.safeParse(saved.payload).success ||
      !Array.isArray(saved.items)
    )
      return null;
    return saved;
  } catch {
    return null;
  }
}
function savePending(key: string, value: PendingPickup | null) {
  try {
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
  } catch {
    /* Memory retry remains available when session storage is disabled. */
  }
}

export function PickupPage({
  staff = false,
  admin = false,
  view = 'all',
}: {
  staff?: boolean;
  admin?: boolean;
  view?: 'all' | 'order' | 'orders';
}): JSX.Element {
  useDocumentTitle('Mang đi & đặt trước');
  const memberQuery = useMember(!staff),
    user = useAuth((s) => s.user);
  const member = memberQuery.data?.member;
  if (!staff && memberQuery.isPending) return <p role="status">Đang kiểm tra thành viên…</p>;
  if (!staff && memberQuery.isError)
    return (
      <ErrorState
        message={getErrorMessage(memberQuery.error)}
        onRetry={() => memberQuery.refetch()}
      />
    );
  if (!staff && !member)
    return (
      <Card className="mx-auto max-w-xl space-y-4 p-6">
        <ShoppingBag className="h-8 w-8 text-primary" />
        <h1 className="text-2xl font-semibold">Mang đi</h1>
        <p>Đăng nhập để đặt món nhận tại quầy.</p>
        <Link
          className="inline-block rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground"
          to="/pickup/member"
          aria-label="Đăng nhập / Đăng ký thành viên"
        >
          Đăng nhập / Đăng ký
        </Link>
      </Card>
    );
  const identity = staff ? user?.id : member?.id;
  return (
    <PickupWorkspace
      key={`${staff}:${identity}:${view}`}
      view={staff ? 'all' : view}
      staff={staff}
      admin={admin}
      identity={identity ?? ''}
      initialName={member?.name ?? ''}
      initialPhone={member?.phone ?? ''}
      points={member?.points ?? 0}
    />
  );
}

function PickupWorkspace({
  view,
  staff,
  admin,
  identity,
  initialName,
  initialPhone,
  points,
}: {
  view: 'all' | 'order' | 'orders';
  staff: boolean;
  admin: boolean;
  identity: string;
  initialName: string;
  initialPhone: string;
  points: number;
}): JSX.Element {
  const prefix = staff ? `/${admin ? 'admin' : 'staff'}/pickups` : '/pickups';
  const storageKey = `pickup-pending:${prefix}:${identity}`;
  const location = useLocation();
  const navigate = useNavigate();
  const transfer = (
    location.state as { aiPickup?: { memberId: string; item: Omit<CartItem, 'clientId'> } } | null
  )?.aiPickup;
  const [aiItem, setAiItem] = useState(() =>
    !staff && transfer?.memberId === identity ? transfer.item : undefined,
  );
  const clearTransfer = () => {
    setAiItem(undefined);
    if (transfer) navigate(location.pathname, { replace: true, state: null });
  };
  const qc = useQueryClient();
  const [history, setHistory] = useState(false),
    [page, setPage] = useState(1),
    [creating, setCreating] = useState(
      () => view === 'order' || (view === 'all' && (!!readPending(storageKey) || !!aiItem)),
    );
  const [selected, setSelected] = useState<PickupOrder | null>(null),
    [billOrder, setBillOrder] = useState<string | null>(null);
  const refresh = () => {
    for (const key of [
      'pickups',
      'staff-pickup-alerts',
      'staff-orders',
      'staff-awaiting-payments',
      'payment-accounting',
      'cash-shift',
      'member',
      'menu',
    ])
      void qc.invalidateQueries({ queryKey: [key] });
  };
  useSocketEvent('order.created', refresh);
  useSocketEvent('order.statusChanged', refresh);
  useSocketEvent('connect', refresh);
  const query = useQuery({
    queryKey: ['pickups', prefix, identity, history, page],
    queryFn: async () =>
      unwrap<{ items: PickupOrder[]; total: number }>(
        await api.get(prefix, { params: { history, page } }),
      ),
    refetchInterval: 10000,
    enabled: view !== 'order',
  });
  return (
    <div className="space-y-5">
      <div
        className={
          view === 'order' && !staff
            ? 'sr-only'
            : 'flex flex-wrap items-start justify-between gap-3'
        }
      >
        <div>
          <h1 className="text-2xl font-semibold">
            {staff
              ? 'Mang đi & đặt trước'
              : view === 'orders'
                ? 'Đơn mang đi của tôi'
                : 'Đặt mang đi'}
          </h1>
          {staff ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Nhận tại quầy · Giờ Việt Nam · Thanh toán với nhân viên trước khi pha
            </p>
          ) : null}
        </div>
        {view === 'orders' ? (
          <Link
            to="/pickup"
            className="rounded-full bg-primary px-4 py-2 font-semibold text-primary-foreground"
          >
            Đặt món
          </Link>
        ) : view === 'all' ? (
          <Button onClick={() => setCreating((v) => !v)} disabled={creating}>
            <Plus className="h-4 w-4" />
            Tạo đơn mang đi
          </Button>
        ) : null}
      </div>
      {creating ? (
        <PickupForm
          storefront={view === 'order' && !staff}
          storageKey={storageKey}
          prefix={prefix}
          staff={staff}
          initialName={initialName}
          initialPhone={initialPhone}
          points={points}
          initialItem={aiItem}
          onDone={() => {
            setCreating(false);
            clearTransfer();
            refresh();
            if (view !== 'all') navigate('/pickup/orders');
          }}
          onCancel={() => {
            setCreating(false);
            clearTransfer();
            if (view !== 'all') navigate('/pickup/orders');
          }}
        />
      ) : null}
      {view !== 'order' ? (
        <>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={history ? 'outline' : 'primary'}
              onClick={() => {
                setHistory(false);
                setPage(1);
              }}
            >
              Đang xử lý
            </Button>
            <Button
              variant={history ? 'primary' : 'outline'}
              onClick={() => {
                setHistory(true);
                setPage(1);
              }}
            >
              Tất cả / Lịch sử
            </Button>
            <Button variant="ghost" onClick={refresh}>
              Tải lại
            </Button>
          </div>
          {query.isError ? (
            <ErrorState message={getErrorMessage(query.error)} onRetry={() => query.refetch()} />
          ) : query.isPending ? (
            <p role="status">Đang tải đơn…</p>
          ) : (
            <>
              {!query.data.items.length ? (
                <p className="rounded-2xl border border-dashed p-6 text-muted-foreground">
                  Chưa có đơn trong danh sách này.
                </p>
              ) : null}
              <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                {query.data.items.map((o) => (
                  <Card key={o._id} className="min-w-0 space-y-3 p-4">
                    <div className="flex flex-wrap justify-between gap-2">
                      <strong>{o.code}</strong>
                      <span className="text-sm font-semibold text-primary">
                        {o.pickup.outcome === 'NO_SHOW' ? 'Khách không đến' : labels[o.status]}
                      </span>
                    </div>
                    <p className="text-sm">
                      <Clock3 className="mr-1 inline h-4 w-4" />
                      {o.scheduledAt ? `Hẹn ${time(o.scheduledAt)}` : 'Mang đi ngay'}
                    </p>
                    <p className="break-words text-sm">
                      {o.pickup.name} · {o.pickup.phone}
                    </p>
                    <ul className="space-y-1 text-sm">
                      {o.items.map((i, index) => (
                        <li key={index}>
                          {i.quantity} × {i.nameSnapshot}
                          {i.sizeName ? ` (${i.sizeName})` : ''}
                          <span className="block text-muted-foreground">
                            {i.sugarLevel} đường ·{' '}
                            {i.iceLevel === 'Theo công thức'
                              ? i.iceLevel
                              : i.iceLevel === 'no-ice'
                                ? 'Không đá'
                                : i.iceLevel === 'less-ice'
                                  ? 'Ít đá'
                                  : 'Đá thường'}
                            {i.toppingNamesSnapshot.length
                              ? ` · ${i.toppingNamesSnapshot.join(', ')}`
                              : ''}
                            {i.note ? ` · ${i.note}` : ''}
                          </span>
                          <FreestyleRecipe value={i.freestyle} />
                        </li>
                      ))}
                    </ul>
                    <BenefitBreakdown order={o} />
                    <p className="font-semibold">
                      {vnd(o.total)}{' '}
                      <span className="text-sm font-normal text-muted-foreground">
                        ·{' '}
                        {o.paymentStatus === 'PAID'
                          ? 'Đã thu đủ'
                          : o.paymentStatus === 'REFUNDED'
                            ? 'Đã hoàn tiền'
                            : `Còn thiếu ${vnd(o.balanceDue ?? o.total)}`}
                      </span>
                    </p>
                    {o.pickup.reason || o.cancelReason ? (
                      <p className="text-sm text-muted-foreground">
                        Lý do: {o.pickup.reason || o.cancelReason}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      {o.pickup.outcome === 'ACTIVE' &&
                      (staff ||
                        (o.status === 'AWAITING_PAYMENT' &&
                          o.paymentStatus === 'UNPAID' &&
                          !o.paidAmount)) ? (
                        <Button size="sm" variant="outline" onClick={() => setSelected(o)}>
                          {staff ? 'Xử lý đơn' : 'Hủy đơn'}
                        </Button>
                      ) : null}
                      {o.billId ? (
                        <Button size="sm" variant="outline" onClick={() => setBillOrder(o._id)}>
                          Xem hóa đơn
                        </Button>
                      ) : null}
                    </div>
                  </Card>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  disabled={page === 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Trước
                </Button>
                <span className="text-sm">
                  Trang {page} · {query.data.total} đơn
                </span>
                <Button
                  variant="outline"
                  disabled={page * 30 >= query.data.total}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Sau
                </Button>
              </div>
            </>
          )}
        </>
      ) : null}
      {selected ? (
        <PickupActions
          key={selected._id}
          order={selected}
          prefix={prefix}
          staff={staff}
          onClose={() => setSelected(null)}
          onDone={() => {
            setSelected(null);
            refresh();
          }}
        />
      ) : null}
      {billOrder ? (
        <PickupBill
          identity={identity}
          id={billOrder}
          prefix={prefix}
          staff={staff}
          onClose={() => setBillOrder(null)}
        />
      ) : null}
    </div>
  );
}

function PickupForm({
  storefront,
  storageKey,
  prefix,
  staff,
  initialName,
  initialPhone,
  points,
  initialItem,
  onDone,
  onCancel,
}: {
  storefront: boolean;
  storageKey: string;
  prefix: string;
  staff: boolean;
  initialName: string;
  initialPhone: string;
  points: number;
  initialItem?: Omit<CartItem, 'clientId'>;
  onDone: () => void;
  onCancel: () => void;
}): JSX.Element {
  const recovered = useRef(readPending(storageKey));
  const [photoBusy, setPhotoBusy] = useState(false);
  const draftRef = useContext(PickupDraftContext);
  const draft = useRef(
    !staff && draftRef?.current?.identity === storageKey ? draftRef.current : null,
  );
  const [name, setName] = useState(
      recovered.current?.payload.pickup.name ?? draft.current?.name ?? initialName,
    ),
    [phone, setPhone] = useState(
      recovered.current?.payload.pickup.phone ?? draft.current?.phone ?? initialPhone,
    ),
    [type, setType] = useState<'TAKEAWAY' | 'PICKUP'>(
      recovered.current?.payload.pickup.fulfillmentType ?? draft.current?.type ?? 'TAKEAWAY',
    ),
    [when, setWhen] = useState(() => {
      const at = recovered.current?.payload.pickup.scheduledAt;
      return at
        ? new Date(new Date(at).getTime() + 7 * 3600000).toISOString().slice(0, 16)
        : (draft.current?.when ?? '');
    });
  const [items, setItems] = useState<CartItem[]>(
      recovered.current?.items ??
        draft.current?.items ??
        (initialItem ? [{ ...initialItem, clientId: uuid() }] : []),
    ),
    [selected, setSelected] = useState<Product | null>(null),
    [search, setSearch] = useState('');
  const [aiOpen, setAiOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(6);
  const basketRef = useRef<HTMLDivElement>(null);
  const [voucher, setVoucher] = useState(
      recovered.current?.payload.voucherCode ?? draft.current?.voucher ?? '',
    ),
    [redeem, setRedeem] = useState(
      recovered.current?.payload.redeemPoints ?? draft.current?.redeem ?? 0,
    ),
    [quote, setQuote] = useState<OrderQuoteResponse | null>(null),
    [error, setError] = useState(''),
    [uncertain, setUncertain] = useState(!!recovered.current);
  useEffect(() => {
    if (!staff && draftRef)
      draftRef.current = { identity: storageKey, name, phone, type, when, items, voucher, redeem };
  }, [draftRef, staff, storageKey, name, phone, type, when, items, voucher, redeem]);
  const attempt = useRef<PickupCreate | null>(recovered.current?.payload ?? null),
    requestId = useRef(recovered.current?.payload.requestId ?? uuid());
  const query = useQuery({
    queryKey: ['pickup-catalog', prefix],
    queryFn: async () =>
      unwrap<{
        products: Product[];
        toppings: Topping[];
        categories?: Array<{ _id: string; name: string }>;
      }>(await api.get(staff ? `${prefix}/catalog` : '/categories')),
    refetchInterval: 30000,
  });
  const subtotal = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  const invalidate = () => {
    setQuote(null);
    setError('');
  };
  const submit = useMutation({
    mutationFn: async () => {
      if (!attempt.current) {
        if (!items.length || !name.trim() || !phone.trim() || (type === 'PICKUP' && !when))
          throw new Error('Vui lòng chọn món và điền đủ tên, SĐT, giờ nhận.');
        const payload: PickupCreate = {
          requestId: requestId.current,
          pickup: {
            fulfillmentType: type,
            name,
            phone,
            scheduledAt: type === 'PICKUP' ? new Date(`${when}:00+07:00`).toISOString() : null,
          },
          items: items.map((i) => ({
            productId: i.productId,
            variantId: i.variantId,
            sugarLevel: i.sugarLevel,
            iceLevel: i.iceLevel,
            toppingIds: i.toppingIds,
            quantity: i.quantity,
            ...(i.cupPhotoId ? { cupPhotoId: i.cupPhotoId } : {}),
            ...(i.freestyleToken ? { freestyleToken: i.freestyleToken } : {}),
            note: i.note,
          })),
          ...(voucher.trim() ? { voucherCode: voucher.trim().toUpperCase() } : {}),
          ...(redeem ? { redeemPoints: redeem } : {}),
        };
        let checked = quote;
        if (!checked) {
          checked = unwrap<OrderQuoteResponse>(await api.post(`${prefix}/quote`, payload));
          setQuote(checked);
          if (checked.total !== subtotal) return false;
        }
        attempt.current = { ...payload, quoteToken: checked.quoteToken };
        savePending(storageKey, { payload: attempt.current, items });
      }
      await api.post(prefix, attempt.current);
      return true;
    },
    onSuccess: (sent) => {
      setUncertain(false);
      setError('');
      if (sent) {
        savePending(storageKey, null);
        if (draftRef) draftRef.current = null;
        onDone();
      }
    },
    onError: (e) => {
      const status = getAxiosError(e)?.response?.status;
      setUncertain(!!attempt.current && (!status || status >= 500));
      setError(getErrorMessage(e));
      if (status && status < 500) {
        attempt.current = null;
        savePending(storageKey, null);
        if (getErrorCode(e) === 'QUOTE_CHANGED') setQuote(null);
      }
    },
  });
  const locked = uncertain || submit.isPending || photoBusy;
  const availableProducts = (query.data?.products ?? []).filter(
    (p) => p.isAvailable && p.name.toLocaleLowerCase('vi').includes(search.toLocaleLowerCase('vi')),
  );
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const receiving = (
    <>
      <h3 className="text-lg font-semibold">{staff ? '1. Thông tin nhận món' : 'Nhận món'}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          Tên người nhận
          <Input
            aria-label="Tên người nhận"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="text-sm">
          SĐT liên hệ
          <Input
            aria-label="SĐT liên hệ"
            value={phone}
            maxLength={24}
            type="tel"
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label
          className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 ${type === 'TAKEAWAY' ? 'border-primary bg-primary/10' : 'border-foreground/15'}`}
        >
          <input
            className="mt-1 h-4 w-4 shrink-0 accent-primary"
            type="radio"
            name="pickup-type"
            aria-label="Mang đi ngay"
            checked={type === 'TAKEAWAY'}
            onChange={() => setType('TAKEAWAY')}
          />
          <span>
            <span className="block font-semibold">Mang đi ngay</span>
            {staff ? (
              <span className="mt-1 block text-sm text-muted-foreground">
                Nhận tại quầy sau khi chuẩn bị xong.
              </span>
            ) : null}
          </span>
        </label>
        <label
          className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 ${type === 'PICKUP' ? 'border-primary bg-primary/10' : 'border-foreground/15'}`}
        >
          <input
            className="mt-1 h-4 w-4 shrink-0 accent-primary"
            type="radio"
            name="pickup-type"
            aria-label="Hẹn giờ nhận"
            checked={type === 'PICKUP'}
            onChange={() => setType('PICKUP')}
          />
          <span>
            <span className="block font-semibold">Hẹn giờ nhận</span>
            {staff ? (
              <span className="mt-1 block text-sm text-muted-foreground">
                Chọn thời gian bạn ghé lấy món.
              </span>
            ) : null}
          </span>
        </label>
      </div>
      {type === 'PICKUP' ? (
        <label className="block text-sm">
          Giờ nhận (giờ Việt Nam)
          <Input
            aria-label="Giờ nhận (giờ Việt Nam)"
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
          <span className="text-muted-foreground">Từ 15 phút đến 7 ngày tới.</span>
        </label>
      ) : null}
    </>
  );
  const benefits = (
    <>
      <h3 className="text-lg font-semibold">Ưu đãi</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          Mã voucher
          <Input
            aria-label="Mã voucher"
            value={voucher}
            maxLength={32}
            onChange={(e) => setVoucher(e.target.value)}
          />
        </label>
        {!staff ? (
          <label className="text-sm">
            Điểm muốn đổi (đang có {points})
            <Input
              aria-label="Điểm muốn đổi"
              type="number"
              min={0}
              max={points}
              step={1}
              value={redeem}
              onChange={(e) => setRedeem(Number(e.target.value))}
            />
          </label>
        ) : null}
      </div>
    </>
  );
  const summary = (
    <>
      {quote ? <BenefitBreakdown order={quote} /> : null}
      <p className="border-t border-foreground/10 pt-5 text-2xl font-semibold">
        Tổng: {vnd(quote?.total ?? subtotal)}
      </p>
      {quote && quote.total !== subtotal ? (
        <p role="status" className="text-sm">
          Đã kiểm tra giá và ưu đãi. Bấm xác nhận nếu đồng ý tổng {vnd(quote.total)}.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {uncertain ? (
        <p className="text-sm">Chưa rõ kết quả gửi. Thử lại cùng yêu cầu để lấy đúng đơn đã tạo.</p>
      ) : null}
    </>
  );
  const pickers = (
    <>
      <ProductDetailModal
        product={selected}
        toppings={query.data?.toppings ?? []}
        onClose={() => setSelected(null)}
        onAdded={() => setSelected(null)}
        onAdd={(item) => {
          setItems((v) => [...v, { ...item, clientId: uuid() }]);
          invalidate();
        }}
      />
      {!staff && !locked ? (
        <AISheet
          open={aiOpen}
          onOpenChange={setAiOpen}
          products={query.data?.products ?? []}
          toppings={query.data?.toppings ?? []}
          onAdd={(item) => {
            setItems((v) => [...v, { ...item, clientId: uuid() }]);
            invalidate();
          }}
        />
      ) : null}
    </>
  );
  if (storefront)
    return (
      <>
        <PickupStorefront
          products={query.data?.products ?? []}
          categories={query.data?.categories}
          loading={query.isPending}
          catalogError={query.isError ? getErrorMessage(query.error) : undefined}
          onRetry={() => {
            void query.refetch();
          }}
          onChoose={setSelected}
          onAi={() => setAiOpen(true)}
          locked={locked}
          count={itemCount}
          total={quote?.total ?? subtotal}
          uncertain={uncertain}
          checkout={
            <div className="space-y-5">
              <fieldset disabled={locked} onChange={invalidate} className="min-w-0 space-y-5">
                <section className="pickup-checkout-section">
                  <h3>Món đã chọn</h3>
                  <ul className="divide-y divide-foreground/10">
                    {items.map((i) => (
                      <li key={i.clientId} className="flex gap-3 py-4 first:pt-0 last:pb-0">
                        <MenuPhoto source={i.image} className="h-16 w-16 shrink-0 rounded-xl" />
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex flex-wrap justify-between gap-2">
                            <strong className="break-words">
                              {i.name} {i.variantName}
                            </strong>
                            <span className="font-semibold tabular-nums">
                              {vnd(i.unitPrice * i.quantity)}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {i.sugarLevel} đường ·{' '}
                            {i.iceLevel === 'Theo công thức'
                              ? i.iceLevel
                              : i.iceLevel === 'no-ice'
                                ? 'Không đá'
                                : i.iceLevel === 'less-ice'
                                  ? 'Ít đá'
                                  : 'Đá thường'}
                            {i.toppingIds.length ? ` · ${i.toppingIds.length} topping` : ''}
                            {i.note ? ` · ${i.note}` : ''}
                          </p>
                          <FreestyleRecipe value={i.freestyle} />
                          <CupPhotoPicker
                            label={`Ảnh in tem cho ${i.name}`}
                            photoId={i.cupPhotoId}
                            endpoint={
                              staff
                                ? `/${prefix.startsWith('/admin') ? 'admin' : 'staff'}/cup-photos`
                                : '/pickup/cup-photos'
                            }
                            disabled={locked}
                            onBusyChange={setPhotoBusy}
                            onChange={(cupPhotoId) => {
                              setItems((v) =>
                                v.map((x) =>
                                  x.clientId === i.clientId ? { ...x, cupPhotoId } : x,
                                ),
                              );
                              invalidate();
                            }}
                          />
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <QtyStepper
                              value={i.quantity}
                              onChange={(quantity) => {
                                setItems((v) =>
                                  v.map((x) =>
                                    x.clientId === i.clientId ? { ...x, quantity } : x,
                                  ),
                                );
                                invalidate();
                              }}
                            />
                            <button
                              type="button"
                              className="px-2 py-2 text-sm text-muted-foreground hover:text-danger"
                              aria-label={`Xóa ${i.name}`}
                              onClick={() => {
                                setItems((v) => v.filter((x) => x.clientId !== i.clientId));
                                invalidate();
                              }}
                            >
                              Xóa
                            </button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
                <section className="pickup-checkout-section space-y-4">{receiving}</section>
                <details className="pickup-checkout-section">
                  <summary className="cursor-pointer text-sm font-semibold">Voucher & điểm</summary>
                  <div className="mt-4 space-y-3">{benefits}</div>
                </details>
              </fieldset>
              <div className="pickup-checkout-footer space-y-3">
                <CompanionSuggestions
                  context="PICKUP"
                  items={items}
                  disabled={locked}
                  onAdd={(item) => {
                    if (locked) return false;
                    setItems((v) => [...v, { ...item, clientId: uuid() }]);
                    invalidate();
                  }}
                />
                {summary}
                <Button
                  className="min-h-12 w-full text-base"
                  onClick={() => submit.mutate()}
                  disabled={submit.isPending || !items.length}
                >
                  {submit.isPending
                    ? 'Đang gửi…'
                    : uncertain
                      ? 'Thử lại cùng yêu cầu'
                      : quote
                        ? 'Xác nhận đặt đơn'
                        : 'Đặt món mang đi'}
                </Button>
              </div>
            </div>
          }
        />
        {pickers}
      </>
    );
  return (
    <Card className="space-y-6 p-4 sm:p-6">
      {staff ? (
        <div>
          <h2 className="text-2xl font-semibold">Tạo đơn mang đi</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Chọn món bạn thích, tùy chỉnh rồi xác nhận đơn.
          </p>
        </div>
      ) : null}
      <fieldset disabled={locked} className="min-w-0 space-y-5" onChange={invalidate}>
        {receiving}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-foreground/10 pt-5">
          <div>
            <h3 className="text-lg font-semibold">{staff ? '2. Chọn món' : 'Chọn món'}</h3>
            {staff ? (
              <p className="mt-1 text-sm text-muted-foreground">
                Bấm vào món để chọn size, đường, đá và topping.
              </p>
            ) : null}
          </div>
          {itemCount > 0 ? (
            <Button
              variant="outline"
              onClick={() =>
                basketRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
              }
            >
              <ShoppingBag className="h-4 w-4" />{' '}
              {staff ? `Xem ${itemCount} món đã chọn` : `Giỏ hàng (${itemCount})`}
            </Button>
          ) : null}
        </div>
        <label className="block text-sm">
          <span className={staff ? '' : 'sr-only'}>Tìm món</span>
          <Input
            aria-label="Tìm món mang đi"
            className="mt-2 h-12 text-base"
            placeholder="Tìm món…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setVisibleCount(6);
            }}
          />
        </label>
        {!staff ? (
          <Button
            aria-label="Hỏi AI cho đơn mang đi"
            variant="outline"
            onClick={() => setAiOpen(true)}
            disabled={!query.data}
          >
            <Sparkles className="h-4 w-4" /> Gợi ý AI
          </Button>
        ) : null}
        {query.isError ? (
          <ErrorState message={getErrorMessage(query.error)} onRetry={() => query.refetch()} />
        ) : query.isPending ? (
          <p>Đang tải thực đơn…</p>
        ) : (
          <div className="space-y-4">
            {search ? (
              <p className="text-sm text-muted-foreground">{availableProducts.length} kết quả</p>
            ) : null}
            <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 lg:grid-cols-3">
              {availableProducts.slice(0, visibleCount).map((p) => (
                <button
                  key={p._id}
                  type="button"
                  className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-foreground/15 bg-card text-left transition hover:border-primary hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
                  onClick={() => setSelected(p)}
                >
                  <MenuPhoto source={p.image} className="aspect-[4/3] h-auto w-full shrink-0" />
                  <span className="flex w-full flex-1 flex-col gap-3 p-4">
                    <span className="block break-words text-lg font-semibold leading-snug">
                      {p.name}
                    </span>
                    <span className="mt-auto flex items-center justify-between gap-2 text-lg font-bold text-primary">
                      <span>
                        {p.variants.filter((v) => v.isAvailable !== false).length > 1 ? 'Từ ' : ''}
                        {vnd(
                          p.variants.some((v) => v.isAvailable !== false)
                            ? Math.min(
                                ...p.variants
                                  .filter((v) => v.isAvailable !== false)
                                  .map((v) => v.price),
                              )
                            : p.basePrice,
                        )}
                      </span>
                      {!staff ? <Plus className="h-5 w-5 shrink-0" aria-hidden="true" /> : null}
                    </span>
                    {staff ? (
                      <span className="flex items-center justify-between gap-2 border-t border-foreground/10 pt-3 text-sm font-semibold">
                        Tùy chỉnh & thêm{' '}
                        <Plus className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                      </span>
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
            {!availableProducts.length ? (
              <p className="rounded-2xl border border-dashed p-6 text-center text-muted-foreground">
                Không tìm thấy món.
              </p>
            ) : null}
            {availableProducts.length > visibleCount ? (
              <Button
                variant="outline"
                className="min-h-12 w-full"
                onClick={() => setVisibleCount((count) => count + 6)}
              >
                Xem thêm món ({availableProducts.length - visibleCount})
              </Button>
            ) : null}
          </div>
        )}
        <div ref={basketRef} className="scroll-mt-36 border-t border-foreground/10 pt-5">
          <h3 className="text-lg font-semibold">
            {staff ? '3. Món đã chọn' : 'Giỏ hàng'}
            {itemCount > 0 ? ` (${itemCount})` : ''}
          </h3>
        </div>
        {items.length ? (
          <ul className="space-y-2 border-t pt-3">
            {items.map((i) => (
              <li
                key={i.clientId}
                className="flex items-center gap-3 rounded-2xl border border-foreground/10 bg-muted/30 p-3 text-base"
              >
                <MenuPhoto source={i.image} className="h-16 w-16 shrink-0 rounded-xl" />
                <span className="min-w-0 flex-1 break-words font-medium">
                  {i.quantity} × {i.name} {i.variantName} · {vnd(i.unitPrice * i.quantity)}
                  <span className="block text-muted-foreground">{i.note}</span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setItems((v) => v.filter((x) => x.clientId !== i.clientId));
                    invalidate();
                  }}
                >
                  Xóa
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            {staff ? 'Chọn món để tùy chỉnh size, đường, đá và topping.' : 'Chưa chọn món.'}
          </p>
        )}
        {benefits}
      </fieldset>
      {summary}
      <div className="flex flex-wrap gap-2">
        <Button
          className="min-h-12 w-full text-base sm:w-auto"
          onClick={() => submit.mutate()}
          disabled={submit.isPending || !items.length}
        >
          {submit.isPending
            ? 'Đang gửi…'
            : uncertain
              ? 'Thử lại cùng yêu cầu'
              : quote
                ? 'Xác nhận đặt đơn'
                : 'Đặt món mang đi'}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            if (draftRef) draftRef.current = null;
            onCancel();
          }}
          disabled={locked}
        >
          Đóng đơn nháp
        </Button>
      </div>
      {pickers}
    </Card>
  );
}

function PickupActions({
  order,
  prefix,
  staff,
  onClose,
  onDone,
}: {
  order: PickupOrder;
  prefix: string;
  staff: boolean;
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const [method, setMethod] = useState<PaymentMethod>('CASH'),
    [amount, setAmount] = useState(String(order.balanceDue ?? order.total)),
    [reason, setReason] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState(''),
    [uncertain, setUncertain] = useState(false);
  const attempt = useRef<{ path: string; body: unknown; key: string; patch?: boolean } | null>(
    null,
  );
  const beforePrep = ['AWAITING_PAYMENT', 'PENDING', 'CONFIRMED'].includes(order.status),
    hasMoney = (order.paidAmount ?? 0) > 0 || order.paymentStatus === 'PAID';
  const due =
    new Date(order.scheduledAt ?? order.createdAt).getTime() +
    (order.scheduledAt ? 30 : 60) * 60000;
  const next: Record<string, string> = {
    PENDING: 'CONFIRMED',
    CONFIRMED: 'PREPARING',
    PREPARING: 'READY',
    READY: 'SERVED',
  };
  const action = useMutation({
    mutationFn: async ({ kind }: { kind: string }) => {
      if (!attempt.current) {
        let body: unknown,
          patch = false;
        if (kind === 'payments') {
          if (!confirmed) throw new Error('Cần xác nhận đã nhận tiền thực tế.');
          body = { expectedVersion: order.version, amount: Number(amount), method };
        } else if (kind === 'refund') {
          if (!confirmed) throw new Error('Cần xác nhận đã hoàn tiền thực tế.');
          body = {
            expectedVersion: order.version,
            amount: order.paidAmount ?? order.total,
            method,
            reason,
            refundConfirmed: true,
          };
        } else if (kind === 'status') {
          patch = true;
          body = { status: next[order.status], expectedVersion: order.version };
        } else body = { expectedVersion: order.version, reason };
        attempt.current = {
          path: `${prefix}/${order._id}/${kind}`,
          body,
          key: generateIdempotencyKey(),
          patch,
        };
      }
      const a = attempt.current;
      return a.patch
        ? api.patch(a.path, a.body)
        : api.post(a.path, a.body, { headers: { 'Idempotency-Key': a.key } });
    },
    onSuccess: onDone,
    onError: (e) => {
      setError(getErrorMessage(e));
      const status = getAxiosError(e)?.response?.status;
      setUncertain(!!attempt.current && (!status || status >= 500));
      if (status && status < 500) attempt.current = null;
    },
  });
  const busy = action.isPending || uncertain;
  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o && !busy) onClose();
      }}
      title={`Xử lý ${order.code}`}
    >
      <p>
        {labels[order.status]} · {vnd(order.total)}
      </p>
      <p className="mt-2 text-sm">
        {order.pickup.name} · {order.pickup.phone}
      </p>
      <fieldset disabled={busy} className="mt-4 space-y-3">
        {staff && beforePrep ? (
          <>
            <label className="block text-sm">
              Phương thức
              <select
                aria-label="Phương thức"
                className="mt-1 block w-full rounded-xl border bg-card p-2"
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod)}
              >
                <option value="CASH">Tiền mặt</option>
                <option value="BANK_TRANSFER">Chuyển khoản</option>
                <option value="OTHER">Khác</option>
              </select>
            </label>
            {order.paymentStatus === 'UNPAID' ? (
              <label className="block text-sm">
                Số tiền thực nhận
                <Input
                  aria-label="Số tiền thực nhận"
                  type="number"
                  min={order.total === 0 ? 0 : 1}
                  max={order.balanceDue ?? order.total}
                  step={1}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
            ) : null}
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              Tôi đã kiểm tra và nhận / hoàn tiền thực tế cho thao tác đã chọn
            </label>
          </>
        ) : null}
        <label className="block text-sm">
          Lý do hủy / không đến / hoàn tiền
          <Input
            aria-label="Lý do"
            value={reason}
            maxLength={280}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          {staff && order.paymentStatus === 'UNPAID' && beforePrep ? (
            <Button disabled={!confirmed} onClick={() => action.mutate({ kind: 'payments' })}>
              Xác nhận thu tiền
            </Button>
          ) : null}
          {staff && order.paymentStatus === 'PAID' && next[order.status] ? (
            <Button
              disabled={
                order.status === 'CONFIRMED' &&
                !!order.scheduledAt &&
                Date.now() < new Date(order.scheduledAt).getTime() - 15 * 60000
              }
              onClick={() => action.mutate({ kind: 'status' })}
            >
              {order.status === 'READY'
                ? 'Khách đã nhận'
                : `Chuyển: ${labels[next[order.status]!]}`}
            </Button>
          ) : null}
          {beforePrep && !hasMoney ? (
            <Button
              variant="outline"
              disabled={reason.trim().length < 3}
              onClick={() => action.mutate({ kind: 'cancel' })}
            >
              Xác nhận hủy đơn
            </Button>
          ) : null}
          {staff && beforePrep && hasMoney ? (
            <Button
              variant="outline"
              disabled={!confirmed || reason.trim().length < 3}
              onClick={() => action.mutate({ kind: 'refund' })}
            >
              Đã hoàn đủ tiền & hủy
            </Button>
          ) : null}
          {staff &&
          Date.now() >= due &&
          (!beforePrep || !hasMoney || order.status === 'CANCELLED') ? (
            <Button
              variant="outline"
              disabled={reason.trim().length < 3}
              onClick={() => action.mutate({ kind: 'no-show' })}
            >
              Ghi nhận khách không đến
            </Button>
          ) : null}
        </div>
      </fieldset>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {uncertain ? (
        <Button
          className="mt-3"
          disabled={action.isPending}
          onClick={() => action.mutate({ kind: 'retry' })}
        >
          Thử lại cùng yêu cầu
        </Button>
      ) : null}
    </Modal>
  );
}

interface Bill {
  invoiceCode: string;
  title: string;
  closedAt: string;
  total: number;
  order: {
    code: string;
    subtotal: number;
    voucherCode: string;
    voucherDiscount: number;
    pointsDiscount: number;
    redeemedPoints: number;
    items: {
      name: string;
      size: string | null;
      quantity: number;
      lineTotal: number;
      sugarLevel: string;
      iceLevel: string;
      toppings: string[];
      note: string;
    }[];
  };
}
function PickupBill({
  identity,
  id,
  prefix,
  staff,
  onClose,
}: {
  identity: string;
  id: string;
  prefix: string;
  staff: boolean;
  onClose: () => void;
}): JSX.Element {
  const q = useQuery({
    queryKey: ['pickup-bill', prefix, identity, id],
    queryFn: async () => unwrap<Bill>(await api.get(`${prefix}/${id}/bill`)),
  });
  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Hóa đơn Fantastic cafe"
      className={staff ? 'staff-bill-dialog' : ''}
    >
      {q.isPending ? (
        <p>Đang tải hóa đơn…</p>
      ) : q.isError ? (
        <ErrorState message={getErrorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : (
        <div className="space-y-3">
          <p className="font-semibold">{q.data.invoiceCode}</p>
          <p>
            {q.data.title} · {q.data.order.code}
          </p>
          <p className="text-sm">{time(q.data.closedAt)}</p>
          <ul className="divide-y">
            {q.data.order.items.map((i, n) => (
              <li className="flex justify-between gap-2 py-2" key={n}>
                <span>
                  {i.quantity} × {i.name} {i.size}
                  <span className="block text-sm text-muted-foreground">
                    Đường {i.sugarLevel} ·{' '}
                    {i.iceLevel === 'Theo công thức'
                      ? i.iceLevel
                      : i.iceLevel === 'no-ice'
                        ? 'Không đá'
                        : i.iceLevel === 'less-ice'
                          ? 'Ít đá'
                          : 'Đá thường'}
                    {i.toppings.length ? ` · ${i.toppings.join(', ')}` : ''}
                    {i.note ? ` · ${i.note}` : ''}
                  </span>
                </span>
                <span>{vnd(i.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <p>Tiền món: {vnd(q.data.order.subtotal)}</p>
          <BenefitBreakdown order={q.data.order} />
          <p className="font-semibold">Tổng đã thu: {vnd(q.data.total)}</p>
          {staff ? <Button onClick={() => window.print()}>In hóa đơn</Button> : null}
        </div>
      )}
    </Modal>
  );
}
