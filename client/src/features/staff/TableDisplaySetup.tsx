import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
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
  const [url, setUrl] = useState('');
  const provision = useMutation({
    mutationFn: async () =>
      unwrap<{ url: string }>(
        await api.post(`/${admin ? 'admin' : 'staff'}/tables/${tableId}/display`),
      ),
    onSuccess: (data) => setUrl(data.url),
  });
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={provision.isPending}
        onClick={() => {
          if (
            window.confirm(
              `Cấp khóa màn hình cho ${tableName}? Liên kết màn hình đã cấp trước đó sẽ hết hiệu lực.`,
            )
          )
            provision.mutate();
        }}
      >
        {provision.isPending ? 'Đang cấp…' : 'Cấu hình màn hình QR'}
      </Button>
      {provision.isError ? (
        <p role="alert" className="text-sm text-danger">
          {getErrorMessage(provision.error)}
        </p>
      ) : null}
      <Modal
        open={!!url}
        onOpenChange={(open) => {
          if (!open) setUrl('');
        }}
        title={`Màn hình QR · ${tableName}`}
      >
        <div className="space-y-4">
          <p>
            Mở liên kết này trên thiết bị đặt tại bàn. Màn hình sẽ tự đổi QR mỗi 60 giây, kể cả khi
            chưa có khách.
          </p>
          <p className="text-sm text-danger">
            Đây là khóa riêng của màn hình. Không gửi liên kết này cho khách và không in nó thành
            QR. Khách chỉ quét mã xuất hiện trên màn hình.
          </p>
          <input
            aria-label="Liên kết cấu hình màn hình"
            readOnly
            value={url}
            className="w-full rounded border p-2 text-sm"
            onFocus={(event) => event.target.select()}
          />
          <a
            className="inline-block rounded bg-primary px-4 py-2 text-primary-foreground"
            href={url}
            target="_blank"
            rel="noreferrer"
          >
            Mở màn hình QR
          </a>
        </div>
      </Modal>
    </>
  );
}
