import { useEffect, useRef, useState } from 'react';
import { LATTE_STYLES, type CupPrintOrder } from '@may-cafe/contracts';
import { api, generateRequestId, getAxiosError, getErrorMessage } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { usePrivatePhoto } from './usePrivatePhoto';
import './latte-art.css';

export function LatteArtExport({
  order,
  item,
  prefix,
  onClose,
  onRefresh,
}: {
  order: CupPrintOrder;
  item: CupPrintOrder['items'][number];
  prefix: string;
  onClose(): void;
  onRefresh(): void;
}): JSX.Element {
  const preview = usePrivatePhoto(`${item.index}/image`, `${prefix}/${order.id}`);
  const [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const pending = useRef<{ requestId: string; orderId: string; itemIndex: number } | null>(null);
  const alive = useRef(true),
    flight = useRef(false),
    downloads = useRef(new Set<string>());
  useEffect(() => {
    alive.current = true;
    const urls = downloads.current;
    return () => {
      alive.current = false;
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);
  async function download() {
    if (flight.current || !loaded) return;
    flight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    pending.current ??= {
      requestId: generateRequestId(),
      orderId: order.id,
      itemIndex: item.index,
    };
    try {
      const response = await api.post(`${prefix}/latte-art/exports`, pending.current, {
        responseType: 'blob',
      });
      if (!alive.current) return;
      const blob = response.data as Blob;
      if (!(blob instanceof Blob) || !blob.type.includes('image/png'))
        throw new Error('Chưa nhận được file PNG hợp lệ. Hãy thử lại cùng yêu cầu.');
      const url = URL.createObjectURL(blob);
      downloads.current.add(url);
      const link = document.createElement('a');
      link.href = url;
      link.download = `latte-${order.code}-line-${item.index + 1}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
        downloads.current.delete(url);
      }, 1000);
      pending.current = null;
      onRefresh();
      setNotice('Đã chuẩn bị file PNG để tải. Đây chưa phải xác nhận in lên bọt.');
    } catch (error) {
      if (!alive.current) return;
      const status = getAxiosError(error)?.response?.status;
      if (status && status < 500) pending.current = null;
      setError(getErrorMessage(error));
    } finally {
      flight.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section
      aria-label="Xuất latte art"
      className="space-y-4 rounded-2xl border-2 border-primary bg-card p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">
          Latte art {order.code} · dòng {item.index + 1}
        </h2>
        <Button variant="outline" disabled={busy} onClick={onClose}>
          Đóng xem trước
        </Button>
      </div>
      <p>
        {item.quantity} × {item.name} {item.size} · {order.destination}
      </p>
      <p className="font-semibold">
        {LATTE_STYLES.find((style) => style.id === item.latteStyle)?.name ?? 'Bản đã chọn'}
      </p>
      {!preview.url && !preview.error && <p role="status">Đang tải ảnh riêng tư…</p>}
      {preview.error && <p role="alert">{preview.error}</p>}
      {preview.url && (
        <div className="latte-foam-preview max-w-80">
          <img
            src={preview.url}
            alt={`Latte art ${order.code} dòng ${item.index + 1}`}
            onLoad={() => setLoaded(true)}
            onError={() => {
              setLoaded(false);
              setError('Không giải mã được ảnh. Chưa thể xuất file.');
            }}
          />
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        Bản xem trước mô phỏng trên bọt. File PNG 1024 × 1024, nền trắng, giữ trọn ảnh và không kèm
        chữ/mã đơn.
      </p>
      <Button disabled={busy || !loaded || !!preview.error} onClick={() => void download()}>
        {pending.current ? 'Thử lại xuất PNG' : 'Tải PNG cho máy in đồ uống'}
      </Button>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <p className="text-xs text-muted-foreground">
        Chưa kết nối máy in thực phẩm. Khi có máy, nhập file vào phần mềm của máy và cấu hình vùng
        in theo cốc thực tế. Nhật ký chỉ ghi yêu cầu xuất file, không ghi đã in/đã giao.
      </p>
    </section>
  );
}
