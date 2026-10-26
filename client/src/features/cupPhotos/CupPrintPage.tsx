import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CupPrintOrder } from '@may-cafe/contracts';
import { api, unwrap, getErrorMessage, generateRequestId, getAxiosError } from '../../lib/api';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';
import { useSocketEvent } from '../../lib/socket';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import './cup-print.css';
type Selection = { order: CupPrintOrder; item: CupPrintOrder['items'][number] };
export function CupPrintPage({ admin = false }: { admin?: boolean }): JSX.Element {
  useDocumentTitle('In tem ảnh');
  const prefix = `/${admin ? 'admin' : 'staff'}/cup-prints`,
    qc = useQueryClient();
  const [page, setPage] = useState(1),
    [selected, setSelected] = useState<Selection | null>(null);
  const feed = useQuery({
    queryKey: ['cup-prints', prefix, page],
    queryFn: async () =>
      unwrap<{ items: CupPrintOrder[]; total: number; pages: number }>(
        await api.get(`${prefix}?page=${page}`),
      ),
    refetchInterval: 10000,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['cup-prints'] });
  };
  useSocketEvent('order.created', refresh);
  useSocketEvent('order.statusChanged', refresh);
  useSocketEvent('payment.confirmed', refresh);
  useSocketEvent('connect', refresh);
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-3xl font-semibold">In tem ảnh</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Đơn đã thanh toán · mỗi dòng món dùng một ảnh. Kiểm tra mã đơn và số cốc trước khi dán
          tem.
        </p>
      </header>
      {feed.isLoading && <p role="status">Đang tải đơn có ảnh…</p>}
      {feed.isError && <p role="alert">{getErrorMessage(feed.error)}</p>}
      {!feed.isLoading && !feed.data?.items.length && !feed.isError && (
        <Card className="p-5">Chưa có đơn đã thanh toán kèm ảnh.</Card>
      )}
      {feed.data?.items.map((order) => (
        <Card key={order.id} className="space-y-3 p-5">
          <h2 className="text-xl font-semibold">{order.code}</h2>
          <p>
            {order.destination} · {order.status}
          </p>
          <ul className="space-y-3">
            {order.items.map((item) => (
              <li
                key={item.index}
                className="flex flex-wrap items-center justify-between gap-3 border-t pt-3"
              >
                <div>
                  <h3 className="font-medium">
                    Dòng {item.index + 1}: {item.quantity} × {item.name} {item.size}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {item.available
                      ? `Đã yêu cầu in ${item.attempts} lần`
                      : 'Ảnh đã hết hạn lưu trữ'}
                  </p>
                </div>
                <Button disabled={!item.available} onClick={() => setSelected({ order, item })}>
                  Xem & in tem
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ))}
      {!!feed.data?.total && (
        <div className="flex items-center gap-3">
          <Button variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Trang trước
          </Button>
          <span>
            Trang {page}/{feed.data.pages}
          </span>
          <Button
            variant="outline"
            disabled={page >= feed.data.pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Trang sau
          </Button>
        </div>
      )}
      {selected && (
        <PrintPreview
          key={`${selected.order.id}:${selected.item.index}`}
          selected={selected}
          prefix={prefix}
          onClose={() => setSelected(null)}
          onRefresh={refresh}
        />
      )}
    </div>
  );
}
function PrintPreview({
  selected,
  prefix,
  onClose,
  onRefresh,
}: {
  selected: Selection;
  prefix: string;
  onClose: () => void;
  onRefresh: () => void;
}): JSX.Element {
  const [url, setUrl] = useState(''),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [copies, setCopies] = useState(selected.item.quantity),
    [paper, setPaper] = useState<'A4' | 'LABEL_60_80'>('A4');
  const pending = useRef<Record<string, unknown> | null>(null),
    flight = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    let cancelled = false,
      objectUrl = '';
    alive.current = true;
    document.body.setAttribute('data-cup-print', 'true');
    void api
      .get(`${prefix}/${selected.order.id}/${selected.item.index}/image`, { responseType: 'blob' })
      .then((r) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(r.data as Blob);
        setUrl(objectUrl);
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err));
      });
    return () => {
      cancelled = true;
      alive.current = false;
      document.body.removeAttribute('data-cup-print');
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [prefix, selected.order.id, selected.item.index]);
  async function print() {
    if (
      flight.current ||
      !loaded ||
      !url ||
      !Number.isInteger(copies) ||
      copies < 1 ||
      copies > selected.item.quantity
    )
      return;
    flight.current = true;
    setBusy(true);
    setError('');
    pending.current ??= {
      requestId: generateRequestId(),
      orderId: selected.order.id,
      itemIndex: selected.item.index,
      copies,
      paper,
    };
    try {
      await api.post(prefix, pending.current);
      if (!alive.current) return;
      pending.current = null;
      onRefresh();
      if (typeof window.print !== 'function')
        throw new Error('Trình duyệt không hỗ trợ hộp thoại in.');
      window.print();
    } catch (err) {
      const status = getAxiosError(err)?.response?.status;
      if (status && status < 500) pending.current = null;
      if (alive.current) setError(getErrorMessage(err));
    } finally {
      flight.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const locked = busy || !!pending.current;
  return (
    <section
      className="space-y-4 rounded-2xl border-2 border-primary bg-card p-5"
      aria-label="Xem trước tem"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">
          Tem {selected.order.code} · dòng {selected.item.index + 1}
        </h2>
        <Button variant="outline" disabled={busy} onClick={onClose}>
          Đóng xem trước
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Tem 60 × 80 mm, ảnh giữ trọn khung. In 100% / kích thước thật, tắt đầu/chân trang. Chọn đúng
        khổ giấy của máy.
      </p>
      <div className="flex flex-wrap gap-4">
        <label>
          Số tem
          <input
            aria-label="Số tem"
            disabled={locked}
            className="ml-2 w-20 rounded-lg border bg-background p-2"
            type="number"
            min="1"
            max={selected.item.quantity}
            value={copies}
            onChange={(e) => setCopies(Number(e.target.value))}
          />
        </label>
        <label>
          Giấy
          <select
            aria-label="Khổ giấy"
            disabled={locked}
            className="ml-2 rounded-lg border bg-background p-2"
            value={paper}
            onChange={(e) => setPaper(e.target.value as typeof paper)}
          >
            <option value="A4">A4 · cắt tem</option>
            <option value="LABEL_60_80">Tem 60 × 80 mm</option>
          </select>
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      {!url && !error && <p role="status">Đang tải ảnh riêng tư…</p>}
      {url && (
        <div className="overflow-x-auto rounded-xl bg-muted p-4">
          <CupLabel
            selected={selected}
            url={url}
            copy={1}
            onLoad={() => setLoaded(true)}
            onError={() => {
              setLoaded(false);
              setError('Không giải mã được ảnh. Chưa thể in.');
            }}
          />
        </div>
      )}
      <Button
        disabled={
          busy ||
          !loaded ||
          !Number.isInteger(copies) ||
          copies < 1 ||
          copies > selected.item.quantity
        }
        onClick={() => void print()}
      >
        {pending.current ? 'Thử lại yêu cầu in' : 'In tem'}
      </Button>
      <p className="text-xs text-muted-foreground">
        Hệ thống chỉ ghi nhận yêu cầu mở hộp thoại in, không xác nhận máy đã in thành công. In lại
        có thể tạo tem trùng; kiểm tra tem đã dán trước.
      </p>
      {url &&
        createPortal(
          <div
            aria-hidden="true"
            id="cup-photo-print-sheet"
            className={paper === 'A4' ? 'cup-sheet-a4' : 'cup-sheet-label'}
          >
            <style media="print">{`@page { size: ${paper === 'A4' ? 'A4' : '60mm 80mm'}; margin: ${paper === 'A4' ? '10mm' : '0'}; }`}</style>
            {Array.from(
              { length: Number.isInteger(copies) ? Math.min(50, Math.max(0, copies)) : 0 },
              (_, i) => (
                <CupLabel key={i} selected={selected} url={url} copy={i + 1} />
              ),
            )}
          </div>,
          document.body,
        )}
    </section>
  );
}
function CupLabel({
  selected,
  url,
  copy,
  onLoad,
  onError,
}: {
  selected: Selection;
  url: string;
  copy: number;
  onLoad?: () => void;
  onError?: () => void;
}): JSX.Element {
  return (
    <article className="cup-photo-label">
      <strong>
        {selected.order.code} · Dòng {selected.item.index + 1}
      </strong>
      <p className="cup-label-name">
        {selected.item.name} {selected.item.size}
      </p>
      <img
        src={url}
        alt={`Ảnh tem ${selected.order.code} cốc ${copy}`}
        onLoad={onLoad}
        onError={onError}
      />
      <p>
        Cốc {copy}/{selected.item.quantity}
      </p>
      <small>{selected.order.destination}</small>
    </article>
  );
}
