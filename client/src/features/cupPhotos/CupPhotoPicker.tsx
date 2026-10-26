import { useEffect, useRef, useState } from 'react';
import { CUP_PHOTO_MAX_BYTES, type CupPhotoView } from '@may-cafe/contracts';
import { api, generateRequestId, getErrorMessage, unwrap } from '../../lib/api';
import { Button } from '../../components/ui/Button';
export function CupPhotoPicker({
  photoId,
  endpoint = '/cup-photos',
  label,
  disabled = false,
  onChange,
  onBusyChange,
}: {
  photoId?: string;
  endpoint?: string;
  label: string;
  disabled?: boolean;
  onChange: (id: string | undefined) => void;
  onBusyChange: (busy: boolean) => void;
}): JSX.Element {
  const [url, setUrl] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null),
    pending = useRef<{ file: File; key: string } | null>(null),
    alive = useRef(true),
    flight = useRef(false);
  const callbacks = useRef({ onChange, onBusyChange });
  callbacks.current = { onChange, onBusyChange };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (flight.current) callbacks.current.onBusyChange(false);
    };
  }, []);
  useEffect(() => {
    let cancelled = false,
      objectUrl = '';
    setUrl('');
    if (photoId)
      void api
        .get(`${endpoint}/${photoId}`, { responseType: 'blob' })
        .then((r) => {
          if (cancelled) return;
          objectUrl = URL.createObjectURL(r.data as Blob);
          setUrl(objectUrl);
        })
        .catch(() => {
          if (!cancelled) setError('Ảnh không còn truy cập được. Hãy bỏ ảnh hoặc tải lại.');
        });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photoId, endpoint]);
  async function upload(file?: File) {
    if (flight.current) return;
    if (file) {
      if (
        !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
        file.size > CUP_PHOTO_MAX_BYTES ||
        !file.size
      ) {
        setError('Chọn ảnh JPEG, PNG hoặc WebP tĩnh, tối đa 4 MB.');
        return;
      }
      pending.current = { file, key: generateRequestId() };
    }
    const request = pending.current;
    if (!request) return;
    flight.current = true;
    setBusy(true);
    setError('');
    callbacks.current.onBusyChange(true);
    try {
      const photo = unwrap<CupPhotoView>(
        await api.post(endpoint, request.file, {
          headers: { 'Content-Type': request.file.type, 'Idempotency-Key': request.key },
        }),
      );
      if (!alive.current) return;
      pending.current = null;
      callbacks.current.onChange(photo.id);
    } catch (err) {
      if (alive.current) setError(getErrorMessage(err));
    } finally {
      flight.current = false;
      if (alive.current) {
        setBusy(false);
        callbacks.current.onBusyChange(false);
      }
    }
  }
  return (
    <div className="mt-3 space-y-2 rounded-xl border p-3 text-sm">
      <label className="block font-medium">
        Ảnh in tem (tùy chọn)
        <input
          ref={fileInput}
          aria-label={label}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={disabled || busy}
          className="mt-2 block w-full text-xs"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
      </label>
      {!photoId && (
        <p className="text-xs text-muted-foreground">
          JPEG/PNG/WebP · tối đa 4 MB. Cùng một ảnh cho mọi cốc trong dòng này.
        </p>
      )}
      {url && (
        <img
          src={url}
          alt="Ảnh xem trước để in tem"
          className="h-28 w-28 rounded-lg bg-white object-contain"
        />
      )}
      {busy && <p role="status">Đang xử lý ảnh…</p>}
      {error && <p role="alert">{error}</p>}
      {photoId && (
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || busy}
          onClick={() => {
            callbacks.current.onChange(undefined);
            setError('');
            pending.current = null;
            if (fileInput.current) fileInput.current.value = '';
          }}
        >
          Bỏ ảnh
        </Button>
      )}
      {!!pending.current && !busy && error && (
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => void upload()}>
          Thử lại tải ảnh
        </Button>
      )}
    </div>
  );
}
