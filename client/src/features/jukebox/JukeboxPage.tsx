import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { CurrentTableSessionResponse, JukeboxFeed } from '@may-cafe/contracts';
import { Music2 } from 'lucide-react';
import { api, unwrap, getErrorMessage } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';
import { jukeboxUuid, useJukeboxAction, useJukeboxQuery } from './useJukebox';
export function JukeboxPage(): JSX.Element {
  useDocumentTitle('Chọn nhạc');
  const session = useQuery({
    queryKey: ['guest-session'],
    queryFn: async () =>
      unwrap<CurrentTableSessionResponse>(await api.get('/table-sessions/current')),
  });
  if (session.isLoading) return <p role="status">Đang kiểm tra bàn…</p>;
  if (session.isError) return <p role="alert">{getErrorMessage(session.error)}</p>;
  if (!session.data?.active)
    return (
      <Card className="space-y-4 p-6">
        <h1 className="font-display text-3xl">Chọn nhạc</h1>
        <p>Quét QR tại bàn để bình chọn nhạc cho quán.</p>
        <Link className="underline" to="/t">
          Vào bàn
        </Link>
      </Card>
    );
  const owner = `${session.data.tableSessionId}:${session.data.participantId}`;
  return <JukeboxRoom key={owner} owner={owner} />;
}
function JukeboxRoom({ owner }: { owner: string }): JSX.Element {
  const feed = useJukeboxQuery<JukeboxFeed>(owner, '/jukebox');
  const action = useJukeboxAction(`mc-jukebox:${owner}`, feed.refresh);
  const data = feed.data;
  async function vote(trackId: string | null) {
    if (!data?.vote) return;
    await action.submit({
      url: '/jukebox/vote',
      method: 'post',
      body: { requestId: jukeboxUuid(), expectedVersion: data.vote.version, trackId },
    });
  }
  return (
    <div className="space-y-6">
      <header>
        <h1 className="flex items-center gap-3 font-display text-3xl font-semibold">
          <Music2 />
          Chọn nhạc
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Một lựa chọn chung cho cả bàn. Đổi hoặc hủy miễn phí trước khi bài được chọn phát.
        </p>
      </header>
      {feed.isLoading && <p role="status">Đang tải nhạc…</p>}
      {feed.isError && <p role="alert">{getErrorMessage(feed.error)}</p>}
      {action.error && <p role="alert">{action.error}</p>}
      {action.pending && (
        <Card className="space-y-3 p-4">
          <p>Chưa xác nhận được lựa chọn. Thử lại cùng yêu cầu để kiểm tra.</p>
          <Button disabled={action.busy} onClick={() => void action.submit(action.pending!)}>
            Thử lại
          </Button>
        </Card>
      )}
      {data && (
        <>
          <Card className="space-y-2 p-5">
            <p className="text-sm text-muted-foreground">Đang được quầy chọn phát</p>
            <h2 className="text-xl font-semibold">{data.current?.title ?? 'Chưa chọn bài'}</h2>
            {data.current && <p>{data.current.artist}</p>}
            <p className="text-sm">
              Còn {data.vote?.remaining ?? 0}/5 lượt trong phiên. Mỗi bài được chọn phát dùng một
              lượt.
            </p>
            {!data.vote?.canVote && <p>Bình chọn đang khóa hoặc đã hết lượt.</p>}
          </Card>
          <section className="space-y-3" aria-label="Hàng đợi">
            <h2 className="text-xl font-semibold">Hàng đợi</h2>
            {!data.queue.length && <p className="text-muted-foreground">Chưa có bình chọn.</p>}
            <ol className="space-y-2">
              {data.queue.map((t, i) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between gap-3 rounded-2xl bg-card p-4"
                >
                  <span>
                    {i + 1}. {t.title}
                    <span className="block text-sm text-muted-foreground">{t.artist}</span>
                  </span>
                  <span className="shrink-0 font-semibold">{t.votes} vote</span>
                </li>
              ))}
            </ol>
          </section>
          <section className="space-y-3" aria-label="Danh sách nhạc">
            <h2 className="text-xl font-semibold">Nhạc của quán</h2>
            {!data.tracks.length && (
              <p className="text-muted-foreground">Quán chưa mở danh sách nhạc.</p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {data.tracks.map((t) => {
                const selected = data.vote?.trackId === t.id,
                  current = data.current?.id === t.id;
                return (
                  <Card key={t.id} className="flex items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <h3 className="break-words font-semibold">{t.title}</h3>
                      <p className="break-words text-sm text-muted-foreground">{t.artist}</p>
                    </div>
                    <Button
                      size="sm"
                      disabled={action.locked || !data.vote?.canVote || current}
                      aria-label={`${selected ? 'Hủy chọn' : 'Chọn'} ${t.title}`}
                      onClick={() => void vote(selected ? null : t.id)}
                    >
                      {current ? 'Đã chọn phát' : selected ? 'Hủy chọn' : 'Bình chọn'}
                    </Button>
                  </Card>
                );
              })}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
