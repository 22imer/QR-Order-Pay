import { useEffect, useRef, useState } from 'react';
import { jukeboxSource, type JukeboxStaffFeed } from '@may-cafe/contracts';
import { api, getAxiosError, getErrorMessage, unwrap } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { JukeboxCatalog } from './JukeboxCatalog';
import { jukeboxUuid, useJukeboxQuery } from './useJukebox';
import { YouTubePlayer, type YouTubeControls } from './YouTubePlayer';

export function JukeboxPlayer({
  admin = false,
  compact = false,
}: {
  admin?: boolean;
  compact?: boolean;
}): JSX.Element {
  const { user } = useAuth();
  return <Player key={user?.id} admin={admin} compact={compact} />;
}
function Player({ admin, compact }: { admin: boolean; compact: boolean }): JSX.Element {
  const [deviceId] = useState(jukeboxUuid),
    prefix = `/${admin ? 'admin' : 'staff'}/jukebox`;
  const feed = useJukeboxQuery<JukeboxStaffFeed>(
    `player:${deviceId}`,
    `${prefix}?deviceId=${deviceId}`,
    true,
  );
  const audio = useRef<HTMLAudioElement>(null),
    live = useRef(false),
    expiry = useRef(0),
    flight = useRef(false);
  const youtube = useRef<YouTubeControls>(null);
  function pausePlayback() {
    audio.current?.pause();
    youtube.current?.pause();
  }
  const mounted = useRef(true);
  const [active, setActive] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [playing, setPlaying] = useState(false);
  const [pending, setPending] = useState<{
    kind: 'next' | 'stop' | 'play';
    body: Record<string, unknown>;
  } | null>(null);
  const [volume, setVolume] = useState(0.5);
  const data = feed.data;
  const currentVersion = useRef(0);
  currentVersion.current = data?.playbackVersion ?? 0;
  function halt() {
    live.current = false;
    setActive(false);
    pausePlayback();
    setPlaying(false);
  }
  async function play() {
    if (!live.current || Date.now() >= expiry.current || !source) return;
    if (sourceType?.kind === 'youtube') {
      youtube.current?.play();
      return;
    }
    if (!audio.current?.getAttribute('src')) return;
    try {
      await audio.current.play();
      if (!live.current || Date.now() >= expiry.current) audio.current?.pause();
    } catch {
      setError(
        'Chưa phát được âm thanh. Bấm Phát / thử lại; nếu vẫn lỗi, kiểm tra URL hoặc chuyển bài.',
      );
      setPlaying(false);
    }
  }
  const source = data?.current?.audioUrl ?? '',
    generation = data?.playbackVersion ?? 0;
  const sourceType = jukeboxSource(source);
  useEffect(() => {
    if (audio.current) audio.current.volume = volume;
    youtube.current?.setVolume(volume);
  }, [volume, generation]);
  useEffect(() => {
    const element = audio.current;
    if (!active || !source) {
      pausePlayback();
      return;
    }
    setError('');
    setPlaying(false);
    void play();
    return () => element?.pause();
    // Source/generation changes start the selected snapshot from the beginning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, generation, active]);
  useEffect(() => {
    mounted.current = true;
    let heartbeatBusy = false;
    const element = audio.current;
    const release = () => {
      if (!live.current) return;
      halt();
      void api.post(`${prefix}/release`, { deviceId }).catch(() => {});
    };
    const visibility = () => {
      // Switching tabs keeps playback. On return, enforce the deadline even if
      // the browser suspended timers while this tab was in the background.
      if (!document.hidden && live.current && Date.now() >= expiry.current) {
        halt();
        setError('Quyền phát đã hết hạn. Bấm Bật phát trên máy này để kết nối lại.');
        feed.refresh();
      }
    };
    const deadline = window.setInterval(() => {
      if (live.current && Date.now() >= expiry.current) {
        halt();
        setError('Quyền phát đã hết hạn. Bấm Bật phát trên máy này để kết nối lại.');
        feed.refresh();
      }
    }, 500);
    const heartbeat = window.setInterval(() => {
      if (!live.current || heartbeatBusy) return;
      heartbeatBusy = true;
      void api
        .post(`${prefix}/heartbeat`, { deviceId })
        .then((r) => {
          if (!mounted.current || !live.current) return;
          const result = unwrap<JukeboxStaffFeed>(r);
          // Use remaining server duration: local clocks may be skewed.
          expiry.current = Date.now() + Math.max(0, result.lease.until - result.serverNow - 1000);
        })
        .catch((err) => {
          if (mounted.current) {
            halt();
            setError(getErrorMessage(err));
          }
        })
        .finally(() => {
          heartbeatBusy = false;
        });
    }, 10000);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', release);
    return () => {
      mounted.current = false;
      element?.pause();
      if (live.current) void api.post(`${prefix}/release`, { deviceId }).catch(() => {});
      live.current = false;
      window.clearInterval(deadline);
      window.clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', release);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefix, deviceId]);
  async function claim() {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError('');
    try {
      const result = unwrap<JukeboxStaffFeed>(await api.post(`${prefix}/claim`, { deviceId }));
      if (!mounted.current) {
        void api.post(`${prefix}/release`, { deviceId }).catch(() => {});
        return;
      }
      expiry.current = Date.now() + Math.max(0, result.lease.until - result.serverNow - 1000);
      live.current = true;
      setActive(true);
      await feed.accept(result);
    } catch (err) {
      halt();
      setError(getErrorMessage(err));
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  async function control(kind: 'next' | 'stop' | 'play', retry = false, trackId?: string) {
    if (flight.current || !live.current || !data || (!retry && pending)) return;
    if (Date.now() >= expiry.current) {
      halt();
      setError('Quyền phát đã hết hạn. Bấm Bật phát trên máy này để kết nối lại.');
      feed.refresh();
      return;
    }
    const command =
      retry && pending
        ? pending
        : {
            kind,
            body: {
              deviceId,
              requestId: jukeboxUuid(),
              playbackVersion: data.playbackVersion,
              ...(kind === 'play' ? { trackId } : {}),
            },
          };
    flight.current = true;
    setBusy(true);
    setError('');
    setPending(command);
    pausePlayback();
    try {
      const result = unwrap<JukeboxStaffFeed>(
        await api.post(`${prefix}/${command.kind}`, command.body),
      );
      setPending(null);
      await feed.accept(result);
    } catch (err) {
      const status = getAxiosError(err)?.response?.status;
      if (status && status < 500) setPending(null);
      setError(getErrorMessage(err));
    } finally {
      flight.current = false;
      setBusy(false);
      feed.refresh();
    }
  }
  async function release() {
    halt();
    setPending(null);
    try {
      await api.post(`${prefix}/release`, { deviceId });
      feed.refresh();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }
  return (
    <div
      aria-label="Trình phát nhạc của quán"
      hidden={compact && !active && !error}
      className={compact ? 'mb-6 space-y-3' : 'space-y-6'}
    >
      <header hidden={compact}>
        <h1 className="text-3xl font-semibold">Jukebox</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Máy tính này có thể phát nhạc qua loa của máy hoặc loa ngoài. Bấm Bật phát trên máy này,
          rồi Bài tiếp theo khi có bình chọn. Nhạc tiếp tục khi chuyển chức năng hoặc đổi tab; mỗi
          lần chỉ một máy phát.
        </p>
      </header>
      <div hidden={!compact}>
        <Link
          className="font-semibold text-primary underline"
          to={`/${admin ? 'admin' : 'staff'}/jukebox`}
        >
          Mở Jukebox
        </Link>
        <span className="ml-3 text-sm text-muted-foreground">
          Trình phát vẫn hoạt động khi chuyển chức năng.
        </span>
      </div>
      {feed.isError && <p role="alert">{getErrorMessage(feed.error)}</p>}
      {error && <p role="alert">{error}</p>}
      <audio
        key={generation}
        ref={audio}
        src={active && sourceType?.kind === 'audio' ? source : undefined}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => {
          if (active && source)
            setError('Nguồn nhạc không phát được. Kiểm tra URL hoặc chuyển bài.');
        }}
        onEnded={() => {
          if (live.current && !flight.current && currentVersion.current === generation)
            void control('next');
        }}
      />
      <Card
        className={
          compact && active && sourceType?.kind === 'youtube'
            ? 'space-y-4 p-4 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-4 lg:space-y-0'
            : compact
              ? 'space-y-3 p-4'
              : 'space-y-4 p-5'
        }
      >
        <div className="space-y-4">
          <p role="status">
            {active
              ? playing
                ? 'Đang phát trên thiết bị này'
                : 'Thiết bị này giữ quyền phát · đang dừng'
              : data?.lease.busy
                ? 'Có thiết bị đang giữ quyền phát'
                : 'Chưa bật thiết bị phát'}
          </p>
          <h2 className={compact ? 'text-lg font-semibold' : 'text-2xl font-semibold'}>
            {data?.current?.title ?? 'Chưa chọn bài'}
          </h2>
          {data?.current && <p>{data.current.artist}</p>}
          <div className="flex flex-wrap gap-2">
            {!active ? (
              <Button
                disabled={busy || !data || feed.isError || !!data.lease.busy}
                onClick={() => void claim()}
              >
                Bật phát trên máy này
              </Button>
            ) : (
              <>
                <Button
                  disabled={busy || !!pending || !source}
                  onClick={() => {
                    setError('');
                    if (playing) pausePlayback();
                    else void play();
                  }}
                >
                  {playing ? 'Tạm dừng' : 'Phát / thử lại'}
                </Button>
                <Button disabled={busy || !!pending} onClick={() => void control('next')}>
                  Bài tiếp theo
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || !!pending || !data?.current}
                  onClick={() => void control('stop')}
                >
                  Dừng chọn phát
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => void release()}>
                  Nhả thiết bị
                </Button>
              </>
            )}
          </div>
          {pending && (
            <div>
              <p>Chưa xác nhận thao tác. Thử lại trước khi chuyển bài khác.</p>
              <Button disabled={busy || !active} onClick={() => void control(pending.kind, true)}>
                Thử lại thao tác
              </Button>
            </div>
          )}
          <label className="flex items-center gap-3">
            Âm lượng
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
            />
          </label>
        </div>
        {active && sourceType?.kind === 'youtube' && (
          <YouTubePlayer
            key={generation}
            ref={youtube}
            compact={compact}
            videoId={sourceType.videoId}
            volume={volume}
            onPlaying={(value) => {
              if (!live.current || Date.now() >= expiry.current) {
                youtube.current?.pause();
                return;
              }
              setPlaying(value);
              if (value) setError('');
            }}
            onError={setError}
            onEnded={() => {
              if (live.current && !flight.current && currentVersion.current === generation)
                void control('next');
            }}
          />
        )}
      </Card>
      <section hidden={compact} aria-label="Hàng đợi" className="space-y-3">
        <h2 className="text-xl font-semibold">Hàng đợi theo vote</h2>
        <p className="text-sm text-muted-foreground">
          Nhiều vote trước; bằng nhau ưu tiên lượt chọn sớm nhất. Hết bài thì chờ quầy chọn tiếp.
        </p>
        {!data?.queue.length && <p>Chưa có bình chọn.</p>}
        <ol className="space-y-2">
          {data?.queue.map((t, i) => (
            <li key={t.id} className="rounded-2xl bg-card p-4">
              {i + 1}. {t.title} · {t.artist}
              <span className="ml-3 font-semibold">{t.votes} vote</span>
            </li>
          ))}
        </ol>
      </section>
      <section hidden={compact} aria-label="Nhân viên chọn bài" className="space-y-3">
        <h2 className="text-xl font-semibold">Tự chọn bài để phát</h2>
        <p className="text-sm text-muted-foreground">
          Chọn bất kỳ bài đang mở trong danh sách của quán, không cần có bình chọn. Bật phát trên
          máy này trước khi chọn. Nếu bài đã có bình chọn, lượt đó được dùng như khi phát từ hàng
          đợi.
        </p>
        {!data?.tracks.length && <p>Chưa có bài hát trong danh sách.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          {data?.tracks.map((track) => (
            <Card key={track.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <h3 className="break-words font-semibold">{track.title}</h3>
                <p className="text-sm text-muted-foreground">{track.artist}</p>
              </div>
              <Button
                size="sm"
                disabled={!active || busy || !!pending || data.current?.id === track.id}
                aria-label={`Phát ${track.title}`}
                onClick={() => void control('play', false, track.id)}
              >
                {data.current?.id === track.id ? 'Đang chọn phát' : 'Phát bài này'}
              </Button>
            </Card>
          ))}
        </div>
      </section>
      {admin && !compact && <JukeboxCatalog />}
    </div>
  );
}
