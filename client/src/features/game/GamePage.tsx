import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CurrentTableSessionResponse, GameFeed, GameRound } from '@may-cafe/contracts';
import { api, unwrap, generateIdempotencyKey, getErrorMessage, getAxiosError } from '../../lib/api';
import { useSocketEvent } from '../../lib/socket';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { GameWheel } from './GameWheel';
import { useShakeToSpin } from './gameMotion';

type Pending = {
  url: string;
  payload: { requestId: string; expectedVersion?: number; name?: string };
};
function uuid() {
  const h = generateIdempotencyKey();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20)}`;
}
function loadPending(key: string): Pending | null {
  try {
    const p = JSON.parse(sessionStorage.getItem(key) ?? 'null') as Pending | null;
    return p &&
      /^\/game(?:\/[a-f\d]{24}\/(?:join|leave|spin|cancel))?$/.test(p.url) &&
      typeof p.payload?.requestId === 'string'
      ? p
      : null;
  } catch {
    return null;
  }
}
function useClock(animate: boolean) {
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      setClock(Date.now());
      if (animate) frame = requestAnimationFrame(tick);
    };
    const timer = animate ? undefined : window.setInterval(tick, 250);
    const wake = () => setClock(Date.now());
    if (animate) frame = requestAnimationFrame(tick);
    document.addEventListener('visibilitychange', wake);
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [animate]);
  return clock;
}
function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!media) return;
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);
  return reduced;
}
export function GamePage(): JSX.Element {
  useDocumentTitle('Ai trả tiền?');
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
        <h1 className="font-display text-3xl font-semibold">Ai trả tiền?</h1>
        <p>Quét QR tại bàn để chơi cùng bạn bè.</p>
        <Link to="/t" className="underline">
          Vào bàn
        </Link>
      </Card>
    );
  const owner = `${session.data.tableSessionId}:${session.data.participantId}`;
  return (
    <GameRoom key={owner} owner={owner} tableName={session.data.table?.name ?? 'Bàn của bạn'} />
  );
}
function GameRoom({ owner, tableName }: { owner: string; tableName: string }): JSX.Element {
  const qc = useQueryClient(),
    storageKey = `mc-game-pending:${owner}`,
    nameKey = `mc-game-name:${owner}`;
  const [pending, setPending] = useState<Pending | null>(() => loadPending(storageKey));
  const [name, setName] = useState(() => {
    try {
      return pending?.payload.name ?? sessionStorage.getItem(nameKey) ?? '';
    } catch {
      return '';
    }
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const inFlight = useRef(false);
  const feed = useQuery({
    queryKey: ['game', owner],
    queryFn: async () => {
      const before = Date.now(),
        data = unwrap<GameFeed>(await api.get('/game'));
      return { ...data, offset: data.serverNow - (before + Date.now()) / 2 };
    },
    refetchInterval: 3000,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['game', owner] });
  };
  useSocketEvent('game.changed', refresh);
  useSocketEvent('connect', refresh);
  const reduced = useReducedMotion(),
    [animate, setAnimate] = useState(false);
  const localNow = useClock(animate),
    now = localNow + (feed.data?.offset ?? 0),
    round = feed.data?.current ?? null;
  const spinning = !!round?.revealsAt && now < round.revealsAt && round.phase === 'SPINNING';
  useEffect(() => setAnimate(spinning && !reduced), [spinning, reduced]);
  const locked = busy || !!pending,
    open = !!feed.data?.open;
  const waiting = round?.phase === 'WAITING' && now < round.expiresAt;
  const mine = round?.players.find((p) => p.isYou);
  const canSpin = !locked && open && !!waiting && !!round?.canSpin;
  async function submit(action: Pending) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(action));
      setPending(action);
      await api.post(action.url, action.payload);
      sessionStorage.removeItem(storageKey);
      setPending(null);
      refresh();
    } catch (err) {
      const status = getAxiosError(err)?.response?.status;
      if (status && status < 500) {
        sessionStorage.removeItem(storageKey);
        setPending(null);
      }
      setError(getErrorMessage(err));
      refresh();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  function act(kind: 'join' | 'leave' | 'spin' | 'cancel') {
    if (!round) return;
    shake.stop();
    void submit({
      url: `/game/${round.id}/${kind}`,
      payload: {
        requestId: uuid(),
        expectedVersion: round.version,
        ...(kind === 'join' ? { name } : {}),
      },
    });
  }
  const shake = useShakeToSpin(round?.id ?? '', canSpin, () => act('spin'));
  const mayCreate =
    open && !locked && !waiting && !spinning && now >= (feed.data?.nextRoundAt ?? 0);
  const finished = !!round?.revealsAt && now >= round.revealsAt;
  const winner = finished ? round?.players.find((p) => p.id === round.winnerId) : undefined;
  const phaseLabel = round ? phaseText(round, now) : 'Cùng tạo một vòng chơi';
  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-6">
      <header>
        <p className="text-sm text-muted-foreground">{tableName} · Chơi cùng nhau</p>
        <h1 className="mt-1 font-display text-3xl font-semibold sm:text-4xl">
          Hôm nay, ai trả tiền?
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Chỉ là trò chơi, mọi người tự thống nhất việc trả tiền.
        </p>
      </header>
      {error && (
        <p role="alert" className="rounded-xl border border-danger p-3">
          {error}
        </p>
      )}
      {pending && (
        <Card className="space-y-2 p-4">
          <p role="status">Chưa rõ kết quả. Thử lại cùng yêu cầu để tránh tạo hoặc quay trùng.</p>
          <Button disabled={busy} onClick={() => void submit(pending)}>
            Thử lại yêu cầu
          </Button>
        </Card>
      )}
      {feed.isLoading && <p role="status">Đang tải vòng chơi…</p>}
      {feed.isError && (
        <div role="alert">
          <p>{getErrorMessage(feed.error)}</p>
          <Button variant="outline" onClick={refresh}>
            Tải lại vòng chơi
          </Button>
        </div>
      )}
      {!open && feed.data && (
        <p className="rounded-xl border p-3">
          Phiên đang kết thúc. Không mở hoặc thay đổi vòng chơi.
        </p>
      )}
      <div className="grid gap-5 md:grid-cols-[1.1fr_1fr]">
        <Card className="space-y-5 overflow-hidden p-5 sm:p-7">
          <p className="text-center font-semibold" role="status">
            {phaseLabel}
          </p>
          <GameWheel round={round} now={now} reduced={reduced} />
          {winner && (
            <div className="rounded-2xl bg-primary/15 p-4 text-center" role="status">
              <p>Lần này là…</p>
              <p className="break-words font-display text-3xl font-semibold">
                {winner.name}
                {winner.isYou ? ' · Bạn' : ''}
              </p>
            </div>
          )}
          {round?.isHost && waiting && (
            <div className="space-y-3">
              <Button size="lg" className="w-full" disabled={!canSpin} onClick={() => act('spin')}>
                Quay nào!
              </Button>
              <Button
                variant="outline"
                className="w-full"
                disabled={!canSpin}
                onClick={() => (shake.armed ? shake.stop() : void shake.start())}
              >
                {shake.armed ? 'Tắt lắc điện thoại' : 'Bật lắc điện thoại'}
              </Button>
              {shake.message && (
                <p className="text-xs text-muted-foreground" role="status">
                  {shake.message}
                </p>
              )}
            </div>
          )}
        </Card>
        <Card className="space-y-4 p-5 sm:p-6">
          <h2 className="text-xl font-semibold">Những người cùng chơi</h2>
          <p className="text-sm text-muted-foreground">
            Mỗi thiết bị tự tham gia bằng tên riêng. Từ 2 đến 12 người; người tạo bắt đầu quay.
          </p>
          <label className="block font-semibold">
            Tên trong vòng chơi
            <input
              maxLength={24}
              value={name}
              disabled={locked || spinning}
              onChange={(e) => {
                setName(e.target.value);
                try {
                  sessionStorage.setItem(nameKey, e.target.value);
                } catch {
                  /* Draft input still works. */
                }
              }}
              className="mt-2 block w-full rounded-xl border bg-background p-3 font-normal"
              placeholder="Bạn muốn mọi người gọi là gì?"
            />
          </label>
          <ol className="space-y-2">
            {round?.players.map((p, i) => (
              <li
                key={p.id}
                className={`flex items-center justify-between gap-2 rounded-xl border p-3 ${p.id === winner?.id ? 'border-primary bg-primary/10' : 'border-foreground/15'}`}
              >
                <span className="min-w-0 break-words">
                  <strong>
                    {i + 1}. {p.name}
                  </strong>
                  {p.isYou ? ' · Bạn' : ''}
                  {p.isHost ? ' · Người tạo' : ''}
                </span>
                {!p.eligible && <span className="text-xs">Đã rời phiên</span>}
              </li>
            ))}
          </ol>
          {waiting && (
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={
                  locked || !open || !name.trim() || (!mine && (round?.players.length ?? 0) >= 12)
                }
                onClick={() => act('join')}
              >
                {mine ? 'Cập nhật tên' : 'Tham gia vòng'}
              </Button>
              {mine && !round?.isHost && (
                <Button variant="outline" disabled={locked || !open} onClick={() => act('leave')}>
                  Rời vòng
                </Button>
              )}
              {round?.isHost && (
                <Button variant="outline" disabled={locked || !open} onClick={() => act('cancel')}>
                  Hủy vòng
                </Button>
              )}
            </div>
          )}
          {!waiting && (
            <Button
              className="w-full"
              disabled={!mayCreate || !name.trim() || feed.isError}
              onClick={() => void submit({ url: '/game', payload: { requestId: uuid(), name } })}
            >
              Tạo vòng mới
            </Button>
          )}
          {!waiting && !spinning && (feed.data?.nextRoundAt ?? 0) > now && (
            <p className="text-sm">
              Có thể tạo vòng mới sau {Math.ceil((feed.data!.nextRoundAt - now) / 1000)} giây.
            </p>
          )}
          {waiting && (
            <p className="text-xs text-muted-foreground">
              Phòng chờ còn {Math.max(1, Math.ceil((round!.expiresAt - now) / 60000))} phút.
            </p>
          )}
        </Card>
      </div>
      {!!feed.data?.history.length && (
        <details className="rounded-2xl border p-4">
          <summary className="cursor-pointer font-semibold">Các vòng trước</summary>
          <ul className="mt-3 space-y-2 text-sm">
            {feed.data.history.map((r) => (
              <li key={r.id}>
                {new Date(r.createdAt).toLocaleTimeString('vi-VN', {
                  timeZone: 'Asia/Ho_Chi_Minh',
                  hour: '2-digit',
                  minute: '2-digit',
                })}{' '}
                ·{' '}
                {r.winnerId ? r.players.find((p) => p.id === r.winnerId)?.name : phaseText(r, now)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
function phaseText(round: GameRound, now: number) {
  if (round.revealsAt !== null)
    return now < round.revealsAt ? 'Cả bàn cùng chờ kết quả…' : 'Đã có kết quả!';
  if (round.phase === 'CANCELLED') return 'Vòng đã hủy';
  if (round.phase === 'EXPIRED' || now >= round.expiresAt) return 'Phòng chờ đã hết hạn';
  return `Đang chờ tham gia · ${round.players.filter((p) => p.eligible).length}/12`;
}
