import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { api, getErrorMessage, unwrap } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';

export function TableDisplaySetup({
  tableId,
  tableName,
  admin = false,
}: {
  tableId: string;
  tableName: string;
  admin?: boolean;
}): JSX.Element {
  const [qr, setQr] = useState<{ url: string; image: string } | null>(null);
  const [message, setMessage] = useState('');
  const load = useMutation({
    mutationFn: async () => {
      const data = unwrap<{ url: string }>(
        await api.get(`/${admin ? 'admin' : 'staff'}/tables/${tableId}/qr`),
      );
      return { url: data.url, image: await QRCode.toDataURL(data.url, { width: 600, margin: 3 }) };
    },
    onSuccess: (data) => {
      setQr(data);
      setMessage('');
    },
  });
  return (
    <>
      <Button size="sm" variant="outline" disabled={load.isPending} onClick={() => load.mutate()}>
        {load.isPending ? 'Đang lấy QR…' : 'Xem QR tĩnh'}
      </Button>
      {load.isError && (
        <p role="alert" className="text-sm text-danger">
          {getErrorMessage(load.error)}
        </p>
      )}
      <Modal
        open={!!qr}
        onOpenChange={(open) => {
          if (!open) setQr(null);
        }}
        title={`QR tĩnh · ${tableName}`}
      >
        {qr && (
          <div className="space-y-4">
            <p>
              In mã này đặt tại bàn hoặc gửi link cho nhóm khách. QR giữ nguyên qua các phiên, không
              đổi mỗi phút.
            </p>
            <img
              src={qr.image}
              alt={`QR vào ${tableName}`}
              className="mx-auto w-full max-w-80 rounded-xl"
            />
            <input
              aria-label="Link vào bàn"
              readOnly
              value={qr.url}
              className="w-full rounded border p-2 text-sm"
              onFocus={(e) => e.target.select()}
            />
            <div className="flex flex-wrap gap-2">
              <a
                className="rounded-xl bg-primary px-4 py-2 text-primary-foreground"
                href={qr.image}
                download={`QR-${tableName}.png`}
              >
                Tải ảnh QR
              </a>
              <a
                className="rounded-xl border px-4 py-2"
                href={qr.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Mở link vào bàn
              </a>
              <Button
                variant="outline"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(qr.url)
                    .then(() => setMessage('Đã sao chép link.'))
                    .catch(() => setMessage('Chọn ô link và sao chép thủ công.'));
                }}
              >
                Sao chép link
              </Button>
            </div>
            {message && <p role="status">{message}</p>}
          </div>
        )}
      </Modal>
    </>
  );
}
