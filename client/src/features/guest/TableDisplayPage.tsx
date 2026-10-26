import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { api, getErrorMessage, unwrap } from '../../lib/api';
import { dynamicQrResponseSchema } from '@may-cafe/contracts';
import { Button } from '../../components/ui/Button';

export function TableDisplayPage(): JSX.Element {
  const [token] = useState(() => window.location.hash.slice(1));
  const [qr, setQr] = useState<{
    image: string;
    tableName: string;
    deadline: number;
    url: string;
  } | null>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  const [copyMessage, setCopyMessage] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!token) {
      setError('Chưa cấu hình màn hình. Nhân viên mở Bàn & phiên để cấp liên kết màn hình.');
      return;
    }
    let stopped = false;
    let refreshTimer: number;
    const refresh = async () => {
      // Hide old QR while refreshing, including when a request fails/offline.
      setQr(null);
      setSeconds(0);
      setCopyMessage('');
      try {
        const started = performance.now();
        const response = await api.get('/table-displays/qr', {
          headers: { 'X-Table-Display-Token': token },
        });
        const data = dynamicQrResponseSchema.parse(unwrap(response));
        const deadline =
          data.expiresAt === null ? Infinity : started + data.expiresAt - data.serverTime;
        const image = await QRCode.toDataURL(data.url, {
          width: 480,
          margin: 3,
          errorCorrectionLevel: 'M',
        });
        if (stopped) return;
        const remaining = deadline - performance.now();
        if (remaining <= 0) {
          refreshTimer = window.setTimeout(() => void refresh(), 100);
          return;
        }
        setError('');
        setQr({ image, tableName: data.tableName, deadline, url: data.url });
        setSeconds(Math.ceil(remaining / 1000));
        if (Number.isFinite(remaining))
          refreshTimer = window.setTimeout(() => void refresh(), remaining);
      } catch (cause) {
        if (stopped) return;
        setError(getErrorMessage(cause));
        refreshTimer = window.setTimeout(() => void refresh(), 5_000);
      }
    };
    void refresh();
    return () => {
      stopped = true;
      window.clearTimeout(refreshTimer);
    };
  }, [token, reload]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const remaining = qr ? Math.max(0, Math.ceil((qr.deadline - performance.now()) / 1000)) : 0;
      setSeconds(remaining);
    }, 250);
    return () => window.clearInterval(timer);
  }, [qr]);
  async function copyLink(): Promise<void> {
    if (!qr || qr.deadline <= performance.now()) {
      setReload((value) => value + 1);
      return;
    }
    try {
      await navigator.clipboard.writeText(qr.url);
      setCopyMessage('Đã sao chép link vào bàn.');
    } catch {
      linkInput.current?.focus();
      linkInput.current?.select();
      setCopyMessage('Đã chọn link. Nhấn Ctrl+C hoặc chọn Sao chép để lấy link.');
    }
  }
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-6 text-center">
      <div className="w-full max-w-lg space-y-4">
        <p className="font-display text-3xl font-semibold">Fantastic cafe</p>
        <h1 className="text-2xl font-semibold">{qr?.tableName ?? 'Màn hình bàn'}</h1>
        {qr && seconds > 0 ? (
          <>
            <img
              src={qr.image}
              alt={`QR vào ${qr.tableName}`}
              className="mx-auto w-full max-w-96 rounded-2xl"
            />
            <p className="text-lg">Quét để gọi món · Wi-Fi hoặc 4G</p>
            <p role="status">
              {Number.isFinite(seconds)
                ? `Mã đổi sau ${seconds} giây`
                : 'QR cố định · Có thể tải ảnh để in tại bàn'}
            </p>
            <div className="space-y-2">
              <div className="flex flex-wrap justify-center gap-2">
                <a
                  href={qr.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-10 items-center justify-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  Mở link vào bàn
                </a>
                <Button variant="outline" onClick={() => void copyLink()}>
                  Sao chép link
                </Button>
                <a
                  href={qr.image}
                  download={`QR-${qr.tableName}.png`}
                  className="inline-flex items-center rounded-full border px-4 py-2 text-sm font-semibold"
                >
                  Tải ảnh QR
                </a>
              </div>
              <input
                ref={linkInput}
                aria-label="Link vào bàn"
                readOnly
                value={qr.url}
                onFocus={(event) => event.target.select()}
                className="w-full rounded-xl border border-foreground/15 bg-card px-3 py-2 text-sm"
              />
              <p className="text-sm text-muted-foreground">
                Mở link để vào bàn trên máy này. QR cố định giữ nguyên qua các phiên.
              </p>
              {copyMessage ? (
                <p role="status" className="text-sm">
                  {copyMessage}
                </p>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">
              Thanh toán từng đơn trước khi pha chế. Đã vào bàn thì không cần quét lại.
            </p>
          </>
        ) : (
          <p role="status">{error || 'Đang lấy QR mới…'}</p>
        )}
        {error ? <Button onClick={() => setReload((value) => value + 1)}>Thử lại</Button> : null}
      </div>
    </main>
  );
}
