import { useEffect, useRef, useState } from 'react';
import {
  CUP_PHOTO_MAX_BYTES,
  LATTE_STYLES,
  type CupPhotoView,
  type LatteArtVariants,
} from '@may-cafe/contracts';
import { api, generateRequestId, getErrorMessage, unwrap } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import type { CupPhotoPickerProps } from './CupPhotoPicker';
import './latte-art.css';
import { usePrivatePhoto } from './usePrivatePhoto';

type Candidate = { photo: CupPhotoView; url: string; loaded: boolean };
export function LatteArtPicker({
  photoId,
  endpoint = '/cup-photos',
  label,
  disabled = false,
  onChange,
  onBusyChange,
}: CupPhotoPickerProps): JSX.Element {
  const selected = usePrivatePhoto(photoId, endpoint);
  const [candidates, setCandidates] = useState<Candidate[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null),
    alive = useRef(true),
    flight = useRef(false),
    blocking = useRef(false);
  const request = useRef<{ file: File; key: string; sourceId?: string } | null>(null);
  const objectUrls = useRef<string[]>([]);
  const callbacks = useRef({ onChange, onBusyChange });
  callbacks.current = { onChange, onBusyChange };
  function block(value: boolean) {
    blocking.current = value;
    callbacks.current.onBusyChange(value);
  }
  function clearCandidates() {
    for (const url of objectUrls.current) URL.revokeObjectURL(url);
    objectUrls.current = [];
    setCandidates([]);
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      for (const url of objectUrls.current) URL.revokeObjectURL(url);
      if (blocking.current) callbacks.current.onBusyChange(false);
    };
  }, []);
  async function generate(file?: File) {
    if (flight.current || disabled) return;
    if (file) {
      if (
        !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
        !file.size ||
        file.size > CUP_PHOTO_MAX_BYTES
      ) {
        setError('Chọn ảnh JPEG, PNG hoặc WebP tĩnh, tối đa 4 MB.');
        return;
      }
      request.current = { file, key: generateRequestId() };
    }
    const pending = request.current;
    if (!pending) return;
    flight.current = true;
    setBusy(true);
    setError('');
    clearCandidates();
    block(true);
    try {
      if (!pending.sourceId) {
        const source = unwrap<CupPhotoView>(
          await api.post(endpoint, pending.file, {
            headers: { 'Content-Type': pending.file.type, 'Idempotency-Key': pending.key },
          }),
        );
        pending.sourceId = source.id;
      }
      if (!alive.current) return;
      const result = unwrap<LatteArtVariants>(
        await api.post(`${endpoint}/${pending.sourceId}/latte-art`, {}),
      );
      const variants = LATTE_STYLES.map((style) =>
        result.variants.find((photo) => photo.latteStyle === style.id),
      );
      if (variants.some((photo) => !photo))
        throw new Error('Chưa đủ ba kiểu latte art. Hãy thử lại.');
      const blobs = await Promise.all(
        variants.map((photo) => api.get(`${endpoint}/${photo!.id}`, { responseType: 'blob' })),
      );
      if (!alive.current) return;
      const next = variants.map((photo, index) => ({
        photo: photo!,
        url: URL.createObjectURL(blobs[index]!.data as Blob),
        loaded: false,
      }));
      objectUrls.current = next.map((candidate) => candidate.url);
      setCandidates(next);
    } catch (error) {
      if (alive.current) {
        setError(getErrorMessage(error));
        block(false);
      }
    } finally {
      flight.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function cancel(remove: boolean) {
    if (flight.current) return;
    clearCandidates();
    request.current = null;
    setError('');
    block(false);
    if (remove) callbacks.current.onChange(undefined);
    if (input.current) input.current.value = '';
  }
  return (
    <div className="space-y-3 text-sm">
      <p>
        Biến ảnh của bạn thành tông cà phê, giữ nguyên nội dung. Chọn một trong ba bản để gắn vào
        món.
      </p>
      <label className="block font-medium">
        Tải ảnh làm latte art
        <input
          ref={input}
          aria-label={`${label} · latte art`}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={disabled || busy}
          className="mt-2 block w-full text-xs"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void generate(file);
          }}
        />
      </label>
      <p className="text-xs text-muted-foreground">
        JPEG/PNG/WebP · tối đa 4 MB. Một thiết kế cho mọi cốc trong cùng dòng.
      </p>
      {busy && <p role="status">Đang tạo 3 kiểu latte art…</p>}
      {error && <p role="alert">{error}</p>}
      {!candidates.length && photoId && selected.url && (
        <div>
          <p className="mb-2 font-semibold">Latte art đã chọn</p>
          <div className="latte-foam-preview max-w-52">
            <img src={selected.url} alt="Latte art đã chọn trên bọt mô phỏng" />
          </div>
        </div>
      )}
      {selected.error && (
        <p role="alert">Ảnh đã chọn không còn truy cập được. Hãy chọn lại hoặc bỏ ảnh.</p>
      )}
      {!!candidates.length && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Ba kiểu latte art">
            {candidates.map((candidate) => {
              const style = LATTE_STYLES.find((style) => style.id === candidate.photo.latteStyle)!;
              return (
                <button
                  key={candidate.photo.id}
                  type="button"
                  disabled={disabled || busy || !candidate.loaded}
                  aria-label={`Chọn ${style.name}`}
                  className="latte-choice rounded-2xl border border-foreground/20 p-3 text-left transition hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60"
                  onClick={() => {
                    callbacks.current.onChange(candidate.photo.id);
                    clearCandidates();
                    request.current = null;
                    block(false);
                  }}
                >
                  <div className="latte-foam-preview">
                    <img
                      src={candidate.url}
                      alt={`Xem trước ${style.name}`}
                      onLoad={() =>
                        setCandidates((values) =>
                          values.map((value) =>
                            value.photo.id === candidate.photo.id
                              ? { ...value, loaded: true }
                              : value,
                          ),
                        )
                      }
                      onError={() => {
                        setError('Không tải được ảnh xem trước. Hãy thử tạo lại.');
                      }}
                    />
                  </div>
                  <strong className="mt-3 block">{style.name}</strong>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {style.description}
                  </span>
                </button>
              );
            })}
          </div>
          <p role="status" className="font-medium">
            Chọn một bản hoặc bỏ ảnh để tiếp tục đặt món.
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || busy}
            onClick={() => cancel(false)}
          >
            {photoId ? 'Giữ ảnh đã chọn' : 'Hủy tạo latte art'}
          </Button>
        </>
      )}
      {!!request.current && !busy && error && (
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => void generate()}>
          Thử lại tạo latte art
        </Button>
      )}
      {(photoId || !!candidates.length) && (
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || busy}
          onClick={() => cancel(true)}
        >
          Bỏ ảnh latte art
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        Xem trước trên bọt là mô phỏng. Bản thiết kế chưa được in trực tiếp khi quán chưa có máy in
        đồ uống.
      </p>
    </div>
  );
}
