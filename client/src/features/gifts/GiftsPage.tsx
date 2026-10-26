import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CurrentTableSessionResponse,
  GiftCreate,
  GiftTable,
  GiftView,
  OrderQuoteResponse,
} from '@may-cafe/contracts';
import {
  api,
  unwrap,
  vnd,
  getErrorMessage,
  getAxiosError,
  generateIdempotencyKey,
} from '../../lib/api';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Modal } from '../../components/ui/Modal';
import { ProductDetailModal, type Product, type Topping } from '../guest/ProductDetailModal';
import { MenuPhoto } from '../guest/MenuPhoto';
import type { CartItem } from '../../store/cart';
import { useGifts } from './useGifts';
import { CupPhotoPicker } from '../cupPhotos/CupPhotoPicker';
import { useCupPhotoBusy } from '../cupPhotos/useCupPhotoBusy';
import { AISheet } from '../ai/AISheet';

type Pending = { url: string; payload: unknown; key: string };
const statusLabel: Record<GiftView['status'], string> = {
  PENDING: 'Chờ bàn nhận',
  ACCEPTED: 'Đã nhận · chờ người gửi đặt',
  DECLINED: 'Đã từ chối',
  CANCELLED: 'Đã hủy',
  EXPIRED: 'Đã hết hạn',
  ORDERED: 'Đã tạo đơn',
};
const orderLabel: Record<string, string> = {
  AWAITING_PAYMENT: 'Chờ người gửi trả tiền',
  PENDING: 'Đã trả tiền',
  CONFIRMED: 'Đã nhận đơn',
  PREPARING: 'Đang pha',
  READY: 'Sẵn sàng giao',
  SERVED: 'Đã giao quà',
  CANCELLED: 'Đơn đã hủy',
};
const toItems = (items: Array<GiftView['items'][number] | Omit<CartItem, 'clientId'>>) =>
  items.map((i) => ({
    productId: i.productId,
    variantId: i.variantId,
    sugarLevel: i.sugarLevel,
    iceLevel: i.iceLevel,
    toppingIds: i.toppingIds,
    note: i.note,
    quantity: i.quantity,
    ...(i.cupPhotoId ? { cupPhotoId: i.cupPhotoId } : {}),
    ...(i.freestyleToken ? { freestyleToken: i.freestyleToken } : {}),
  }));
function uuid() {
  const h = generateIdempotencyKey();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20)}`;
}

export function GiftsPage(): JSX.Element {
  useDocumentTitle('Tặng quà');
  const session = useQuery({
    queryKey: ['guest-session'],
    queryFn: async () =>
      unwrap<CurrentTableSessionResponse>(await api.get('/table-sessions/current')),
  });
  if (session.isLoading) return <p role="status">Đang kiểm tra bàn…</p>;
  if (session.isError) return <p role="alert">{getErrorMessage(session.error)}</p>;
  if (!session.data?.active)
    return (
      <Card className="p-6">
        <h1 className="text-2xl font-semibold">Tặng quà cho bàn khác</h1>
        <p className="my-4">Quét QR tại bàn để gửi và nhận quà.</p>
        <Link to="/t">Vào bàn</Link>
      </Card>
    );
  const owner = `${session.data.tableSessionId}:${session.data.participantId}`;
  return <GiftWorkspace key={owner} owner={owner} open={session.data.status === 'OPEN'} />;
}

function GiftWorkspace({ owner, open }: { owner: string; open: boolean }): JSX.Element {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const feed = useGifts(owner, page);
  const tables = useQuery({
    queryKey: ['gift-tables', owner],
    enabled: open,
    queryFn: async () => unwrap<{ items: GiftTable[] }>(await api.get('/gifts/tables')),
    refetchInterval: 10000,
  });
  const menu = useQuery({
    queryKey: ['menu'],
    enabled: open,
    queryFn: async () =>
      unwrap<{ products: Product[]; toppings: Topping[] }>(await api.get('/categories')),
  });
  const [selected, setSelected] = useState<GiftTable | null>(null);
  const [items, setItems] = useState<Array<Omit<CartItem, 'clientId'>>>([]);
  const { photoBusy, setPhotoBusy } = useCupPhotoBusy();
  const [aiOpen, setAiOpen] = useState(false);
  const [product, setProduct] = useState<Product | null>(null);
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(6);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [quote, setQuote] = useState<{ gift: GiftView; quote: OrderQuoteResponse } | null>(null);
  const storageKey = `mc-gift-pending:${owner}`;
  const [pending, setPending] = useState<Pending | null>(() => {
    try {
      const raw = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as Pending | null;
      return raw &&
        typeof raw.url === 'string' &&
        /^\/(gifts(?:\/[a-f\d]{24}\/decision)?|orders)$/.test(raw.url) &&
        typeof raw.key === 'string'
        ? raw
        : null;
    } catch {
      return null;
    }
  });
  const [showSenderTable, setShowSenderTable] = useState(
    () =>
      pending?.url === '/gifts' &&
      typeof pending.payload === 'object' &&
      pending.payload !== null &&
      'showSenderTable' in pending.payload &&
      pending.payload.showSenderTable === true,
  );
  const inFlight = useRef(false);
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const locked = busy || !!pending || checking || photoBusy;
  const targetValid = tables.data?.items.some(
    (t) => t.available && t.tableId === selected?.tableId && t.sessionId === selected.sessionId,
  );
  async function submit(action: Pending) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      // Persist before POST so reloading after a lost response can retry the exact request.
      sessionStorage.setItem(storageKey, JSON.stringify(action));
      setPending(action);
      await api.post(action.url, action.payload, { headers: { 'Idempotency-Key': action.key } });
      sessionStorage.removeItem(storageKey);
      setPending(null);
      setQuote(null);
      if (action.url === '/gifts') {
        setItems([]);
        setMessage('');
        setShowSenderTable(false);
        setSelected(null);
        setPage(1);
      }
      void qc.invalidateQueries({ queryKey: ['gifts'] });
      void qc.invalidateQueries({ queryKey: ['my-orders'] });
    } catch (err) {
      const status = getAxiosError(err)?.response?.status;
      if (status && status < 500) {
        sessionStorage.removeItem(storageKey);
        setPending(null);
        setQuote(null);
      }
      setError(getErrorMessage(err));
      void qc.invalidateQueries({ queryKey: ['gifts'] });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function checkQuote(gift: GiftView) {
    setChecking(true);
    setError('');
    try {
      const value = unwrap<OrderQuoteResponse>(
        await api.post('/orders/quote', { items: toItems(gift.items) }),
      );
      setQuote({ gift, quote: value });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setChecking(false);
    }
  }
  const availableProducts = (menu.data?.products ?? []).filter(
    (p) =>
      p.isAvailable &&
      !(p as Product & { isArchived?: boolean }).isArchived &&
      p.name.toLocaleLowerCase('vi').includes(search.toLocaleLowerCase('vi')),
  );
  function decide(gift: GiftView, decision: 'ACCEPT' | 'DECLINE' | 'CANCEL') {
    void submit({
      url: `/gifts/${gift.id}/decision`,
      payload: { expectedVersion: gift.version, decision },
      key: uuid(),
    });
  }
  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-8">
      <div>
        <h1 className="font-display text-3xl font-semibold">Một món quà, một niềm vui</h1>
        <p className="mt-2 text-muted-foreground">
          Chọn ẩn danh hoặc hiện bàn gửi. Bàn nhận đồng ý rồi bạn mới đặt và trả tiền.
        </p>
      </div>
      {error && (
        <p role="alert" className="rounded-xl border border-danger p-3">
          {error}
        </p>
      )}
      {pending && (
        <Card className="p-4" role="status">
          <p>Chưa rõ kết quả. Thử lại cùng yêu cầu để tránh gửi trùng.</p>
          <Button className="mt-2" disabled={busy} onClick={() => void submit(pending)}>
            Thử lại yêu cầu
          </Button>
        </Card>
      )}
      {open && (
        <Card className="space-y-4 p-4 sm:p-6">
          <h2 className="text-xl font-semibold">Gửi quà</h2>
          <fieldset disabled={busy || !!pending || checking} className="space-y-4">
            <legend className="mb-2 font-semibold">1. Chọn bàn nhận</legend>
            {tables.isError && <p role="alert">{getErrorMessage(tables.error)}</p>}
            <div
              className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
              aria-label="Sơ đồ chọn bàn nhận"
            >
              {tables.data?.items.map((t) => (
                <button
                  key={t.tableId}
                  type="button"
                  disabled={!t.available}
                  aria-pressed={selected?.tableId === t.tableId && targetValid}
                  onClick={() => setSelected(t)}
                  className={`min-h-20 rounded-2xl border p-3 text-left disabled:opacity-40 ${selected?.tableId === t.tableId && targetValid ? 'border-primary bg-primary/15' : 'border-foreground/20'}`}
                >
                  <strong className="block">{t.name}</strong>
                  <span className="text-xs">
                    {t.available ? 'Có thể nhận quà' : 'Chưa nhận quà'}
                  </span>
                </button>
              ))}
            </div>
            {selected && !targetValid && (
              <p role="alert">Bàn nhận vừa thay đổi. Hãy chọn lại bàn.</p>
            )}
            <label className="block font-semibold">
              2. Chọn món
              <input
                className="mt-2 block w-full rounded-xl border bg-background p-3 font-normal"
                placeholder="Tìm món"
                aria-label="Tìm món tặng"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setLimit(6);
                }}
              />
            </label>
            {menu.isError && <p role="alert">{getErrorMessage(menu.error)}</p>}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {availableProducts.slice(0, limit).map((p) => (
                <button
                  key={p._id}
                  type="button"
                  onClick={() => setProduct(p)}
                  className="overflow-hidden rounded-2xl border border-foreground/15 text-left"
                >
                  <MenuPhoto source={p.image} className="aspect-[4/3] !h-auto w-full" />
                  <span className="block p-3">
                    <strong className="block">{p.name}</strong>
                    <span className="text-sm">
                      {vnd(p.variants.find((v) => v.isAvailable !== false)?.price ?? p.basePrice)} ·
                      +
                    </span>
                  </span>
                </button>
              ))}
            </div>
            {!menu.isLoading && !availableProducts.length && <p>Không có món phù hợp.</p>}
            {availableProducts.length > limit && (
              <Button variant="outline" onClick={() => setLimit((n) => n + 6)}>
                Xem thêm món
              </Button>
            )}
            <Button variant="outline" disabled={locked} onClick={() => setAiOpen(true)}>
              AI Barista
            </Button>
            {!!items.length && (
              <div className="space-y-2 rounded-xl bg-background/50 p-3">
                {items.map((i, index) => (
                  <div key={index} className="space-y-2">
                    <span>
                      {i.quantity} × {i.name} {i.variantName} · {vnd(i.unitPrice * i.quantity)}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setItems((values) => values.filter((_, n) => n !== index))}
                      aria-label={`Bỏ ${i.name}`}
                      disabled={locked}
                    >
                      Bỏ
                    </Button>
                    <CupPhotoPicker
                      label={`Ảnh quà ${i.name}`}
                      photoId={i.cupPhotoId}
                      disabled={busy || !!pending || checking}
                      onBusyChange={(value) => setPhotoBusy(String(index), value)}
                      onChange={(cupPhotoId) =>
                        setItems((v) => v.map((x, n) => (n === index ? { ...x, cupPhotoId } : x)))
                      }
                    />
                  </div>
                ))}
              </div>
            )}
            <label className="block font-semibold">
              3. Lời nhắn
              <textarea
                value={message}
                maxLength={140}
                onChange={(e) => setMessage(e.target.value)}
                className="mt-2 block w-full rounded-xl border bg-background p-3 font-normal"
                placeholder="Chúc bạn một ngày vui!"
              />
            </label>
            <fieldset className="space-y-2">
              <legend className="mb-2 font-semibold">Hiển thị người gửi</legend>
              <label className="flex min-h-11 items-center gap-3 rounded-xl border p-3">
                <input
                  type="radio"
                  name="senderVisibility"
                  checked={!showSenderTable}
                  onChange={() => setShowSenderTable(false)}
                />
                Ẩn danh
              </label>
              <label className="flex min-h-11 items-center gap-3 rounded-xl border p-3">
                <input
                  type="radio"
                  name="senderVisibility"
                  checked={showSenderTable}
                  onChange={() => setShowSenderTable(true)}
                />
                Hiện bàn gửi
              </label>
              <p className="text-xs text-muted-foreground">
                Lựa chọn áp dụng cho quà này và được giữ nguyên sau khi gửi.
              </p>
            </fieldset>
            <Button
              disabled={locked || !targetValid || !items.length}
              onClick={() => {
                const payload: GiftCreate = {
                  requestId: uuid(),
                  recipientTableId: selected!.tableId,
                  recipientSessionId: selected!.sessionId,
                  message,
                  items: toItems(items),
                  showSenderTable,
                };
                void submit({ url: '/gifts', payload, key: payload.requestId });
              }}
            >
              Gửi lời mời tặng quà
            </Button>
            <p className="text-xs text-muted-foreground">
              Lời mời có hạn 5 phút. Chưa giữ nguyên liệu hoặc tạo khoản thu.
            </p>
          </fieldset>
        </Card>
      )}
      <section className="space-y-3" aria-label="Quà gửi và nhận">
        <h2 className="text-xl font-semibold">Quà của bàn</h2>
        {feed.isLoading && <p role="status">Đang tải quà…</p>}
        {feed.isError && <p role="alert">{getErrorMessage(feed.error)}</p>}
        {feed.data?.items.length === 0 && <p>Chưa có quà gửi hoặc nhận.</p>}
        {feed.data?.items.map((g) => {
          const live = new Date(g.expiresAt).getTime() > Date.now();
          const active = live && ['PENDING', 'ACCEPTED'].includes(g.status);
          return (
            <Card key={g.id} className="space-y-3 p-4">
              <div className="flex flex-wrap justify-between gap-2">
                <h3 className="font-semibold">
                  {g.direction === 'SENT'
                    ? `Tặng ${g.recipientTableName}`
                    : g.showSenderTable && g.senderTable
                      ? `Quà từ ${g.senderTable.code} · ${g.senderTable.name}`
                      : 'Một món quà ẩn danh dành cho bàn bạn'}
                </h3>
                <span className="text-sm">
                  {!live && ['PENDING', 'ACCEPTED'].includes(g.status)
                    ? 'Đã hết hạn'
                    : statusLabel[g.status]}
                </span>
              </div>
              {g.direction === 'SENT' && (
                <p className="text-xs text-muted-foreground">
                  {g.showSenderTable ? 'Hiện bàn gửi' : 'Ẩn danh'}
                </p>
              )}
              <ul className="space-y-1">
                {g.items.map((i, n) => (
                  <li key={n}>
                    {i.quantity} × {i.name} {i.variantName}
                    {i.hasCupPhoto ? ' · Có ảnh tùy chỉnh' : ''}
                    <span className="block text-xs text-muted-foreground">
                      {[i.sugarLevel, i.iceLevel, ...i.toppingNames, i.note]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
              {g.message && <p className="rounded-xl bg-background/50 p-3">“{g.message}”</p>}
              {active && (
                <p className="text-xs text-muted-foreground">
                  Còn{' '}
                  {Math.max(1, Math.ceil((new Date(g.expiresAt).getTime() - Date.now()) / 60000))}{' '}
                  phút
                </p>
              )}
              {g.orderStatus && (
                <p className="font-semibold">{orderLabel[g.orderStatus] ?? g.orderStatus}</p>
              )}
              <div className="flex flex-wrap gap-2">
                {open && active && g.direction === 'RECEIVED' && g.status === 'PENDING' && (
                  <>
                    <Button disabled={locked} onClick={() => decide(g, 'ACCEPT')}>
                      Nhận quà
                    </Button>
                    <Button
                      variant="outline"
                      disabled={locked}
                      onClick={() => decide(g, 'DECLINE')}
                    >
                      Từ chối
                    </Button>
                  </>
                )}
                {open && active && g.direction === 'SENT' && g.status === 'ACCEPTED' && (
                  <Button disabled={locked} onClick={() => void checkQuote(g)}>
                    Xem giá & đặt quà
                  </Button>
                )}
                {open && active && g.direction === 'SENT' && (
                  <Button variant="outline" disabled={locked} onClick={() => decide(g, 'CANCEL')}>
                    Hủy lời mời
                  </Button>
                )}
                {g.direction === 'SENT' && g.orderId && (
                  <Link className="p-2 underline" to="/orders">
                    Xem đơn / yêu cầu hủy
                  </Link>
                )}
              </div>
            </Card>
          );
        })}
        {feed.data && feed.data.total > 30 && (
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              disabled={page === 1 || locked}
              onClick={() => setPage((p) => p - 1)}
            >
              Trang trước
            </Button>
            <span>Trang {page}</span>
            <Button
              variant="outline"
              disabled={page * 30 >= feed.data.total || locked}
              onClick={() => setPage((p) => p + 1)}
            >
              Trang sau
            </Button>
          </div>
        )}
      </section>
      <ProductDetailModal
        product={product}
        toppings={menu.data?.toppings ?? []}
        onClose={() => setProduct(null)}
        onAdded={() => setProduct(null)}
        onAdd={(i) => {
          if (locked || items.length >= 10 || i.quantity > 10) {
            setError('Tối đa 10 dòng món, mỗi dòng 10 phần.');
            return false;
          }
          setItems((values) => [...values, i]);
        }}
      />
      <AISheet
        open={aiOpen}
        onOpenChange={setAiOpen}
        freestyleContext="TABLE"
        products={menu.data?.products ?? []}
        toppings={menu.data?.toppings ?? []}
        onAdd={(i) => {
          if (locked || items.length >= 10 || i.quantity > 10) {
            setError('Tối đa 10 dòng món, mỗi dòng 10 phần.');
            return;
          }
          setItems((v) => [...v, i]);
        }}
      />
      <Modal
        open={!!quote}
        onOpenChange={(value) => {
          if (!value && !locked) setQuote(null);
        }}
        title="Xác nhận đặt quà"
      >
        {quote && (
          <div className="space-y-4">
            <p>
              Giao tới <strong>{quote.gift.recipientTableName}</strong>. Bạn trả tiền cho đơn này.
            </p>
            {quote.quote.items.map((i, n) => (
              <p key={n}>
                {i.quantity} × {i.name} {i.variantName} · {vnd(i.lineTotal)}
              </p>
            ))}
            <p className="text-xl font-semibold">Tổng {vnd(quote.quote.total)}</p>
            <p className="text-sm">Nhân viên chỉ pha sau khi xác nhận nhận đủ tiền.</p>
            <Button
              disabled={locked || new Date(quote.gift.expiresAt).getTime() <= Date.now()}
              onClick={() =>
                void submit({
                  url: '/orders',
                  key: uuid(),
                  payload: {
                    giftId: quote.gift.id,
                    items: toItems(quote.gift.items),
                    quoteToken: quote.quote.quoteToken,
                  },
                })
              }
            >
              Xác nhận đặt · {vnd(quote.quote.total)}
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
