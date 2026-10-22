import { useState } from 'react';
import type { JukeboxCatalogTrack } from '@may-cafe/contracts';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { useAuth } from '../auth/useAuth';
import { getErrorMessage } from '../../lib/api';
import { jukeboxUuid, useJukeboxAction, useJukeboxQuery } from './useJukebox';
const empty = { title: '', artist: '', audioUrl: '', enabled: true, version: 0, id: '' };
export function JukeboxCatalog(): JSX.Element {
  const { user } = useAuth();
  return <Catalog key={user?.id} owner={user?.id ?? 'unknown'} />;
}
function Catalog({ owner }: { owner: string }): JSX.Element {
  const feed = useJukeboxQuery<JukeboxCatalogTrack[]>('catalog', '/admin/jukebox/tracks');
  const action = useJukeboxAction(`mc-jukebox-catalog:${owner}`, feed.refresh);
  const [draft, setDraft] = useState(() =>
    action.pending ? ({ ...empty, ...action.pending.body } as typeof empty) : empty,
  );
  return (
    <section className="space-y-4" aria-label="Quản lý danh sách nhạc">
      <h2 className="text-2xl font-semibold">Danh sách nhạc</h2>
      {feed.isError && <p role="alert">{getErrorMessage(feed.error)}</p>}
      {action.error && <p role="alert">{action.error}</p>}
      {action.pending && (
        <div className="space-y-2">
          <p>Chưa xác nhận được lần lưu. Hãy thử lại cùng yêu cầu.</p>
          <Button
            disabled={action.busy}
            onClick={() =>
              void action.submit(action.pending!).then((ok) => {
                if (ok) setDraft(empty);
              })
            }
          >
            Thử lại lưu bài
          </Button>
        </div>
      )}
      <Card className="p-5">
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (action.locked) return;
            void action
              .submit({
                url: `/admin/jukebox/tracks${draft.id ? `/${draft.id}` : ''}`,
                method: draft.id ? 'put' : 'post',
                body: {
                  requestId: jukeboxUuid(),
                  expectedVersion: draft.version,
                  title: draft.title,
                  artist: draft.artist,
                  audioUrl: draft.audioUrl,
                  enabled: draft.enabled,
                },
              })
              .then((ok) => {
                if (ok) setDraft(empty);
              });
          }}
        >
          <fieldset disabled={action.locked} className="contents">
            <label className="space-y-1">
              Tên bài
              <input
                required
                maxLength={100}
                className="block w-full rounded-xl border bg-background p-3"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </label>
            <label className="space-y-1">
              Nghệ sĩ
              <input
                required
                maxLength={100}
                className="block w-full rounded-xl border bg-background p-3"
                value={draft.artist}
                onChange={(e) => setDraft({ ...draft, artist: e.target.value })}
              />
            </label>
            <label className="space-y-1 sm:col-span-2">
              URL audio HTTPS
              <input
                required
                type="url"
                maxLength={2048}
                className="block w-full rounded-xl border bg-background p-3"
                value={draft.audioUrl}
                onChange={(e) => setDraft({ ...draft, audioUrl: e.target.value })}
              />
              <span className="text-sm text-muted-foreground">
                File mp3, ogg, wav, m4a, aac hoặc opus truy cập trực tiếp. Dùng nguồn nhạc quán có
                quyền phát; liên kết YouTube/Spotify không phải file audio.
              </span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
              />
              Mở bình chọn
            </label>
            <div className="flex gap-2">
              <Button type="submit">{draft.id ? 'Lưu bài' : 'Thêm bài'}</Button>
              {draft.id && (
                <Button type="button" variant="outline" onClick={() => setDraft(empty)}>
                  Hủy sửa
                </Button>
              )}
            </div>
          </fieldset>
        </form>
      </Card>
      <p className="text-sm text-muted-foreground">
        Tắt bài sẽ bỏ các vote đang chờ, không trừ lượt. Bài đã được chọn phát giữ bản lưu đến khi
        quầy chuyển bài.
      </p>
      {!feed.data?.length && <p>Chưa có bài hát.</p>}
      <div className="space-y-2">
        {feed.data?.map((t) => (
          <Card key={t.id} className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0 break-words">
              <h3 className="font-semibold">{t.title}</h3>
              <p>
                {t.artist} · {t.enabled ? 'Đang mở' : 'Đã tắt'}
              </p>
            </div>
            <Button variant="outline" disabled={action.locked} onClick={() => setDraft(t)}>
              Sửa {t.title}
            </Button>
          </Card>
        ))}
      </div>
    </section>
  );
}
