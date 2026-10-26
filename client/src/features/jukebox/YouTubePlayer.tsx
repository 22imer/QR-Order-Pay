import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

export interface YouTubeControls {
  play(): void;
  pause(): void;
  setVolume(volume: number): void;
}
interface EmbeddedPlayer {
  playVideo(): void;
  pauseVideo(): void;
  setVolume(volume: number): void;
  destroy(): void;
}
interface YouTubeApi {
  Player: new (
    element: HTMLElement,
    options: {
      width: string;
      height: string;
      host: string;
      videoId: string;
      playerVars: { origin: string; playsinline: number; autoplay: number };
      events: {
        onReady(event: { target: EmbeddedPlayer }): void;
        onStateChange(event: { data: number }): void;
        onError(event: { data: number }): void;
        onAutoplayBlocked(): void;
      };
    },
  ) => EmbeddedPlayer;
}
type YouTubeWindow = Window & { YT?: YouTubeApi; onYouTubeIframeAPIReady?: () => void };
let apiPromise: Promise<YouTubeApi> | null = null;
function loadApi(): Promise<YouTubeApi> {
  const host = window as YouTubeWindow;
  if (host.YT?.Player) return Promise.resolve(host.YT);
  if (apiPromise) return apiPromise;
  const request = new Promise<YouTubeApi>((resolve, reject) => {
    const previous = host.onYouTubeIframeAPIReady;
    const script = document.createElement('script');
    const fail = () => {
      script.remove();
      reject(new Error('Không tải được YouTube. Kiểm tra mạng rồi bấm Phát / thử lại.'));
    };
    const timer = window.setTimeout(fail, 15000);
    host.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timer);
      previous?.();
      if (host.YT?.Player) resolve(host.YT);
      else fail();
    };
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => {
      window.clearTimeout(timer);
      fail();
    };
    document.head.appendChild(script);
  });
  apiPromise = request.catch((error: unknown) => {
    apiPromise = null;
    throw error;
  });
  return apiPromise;
}

export const YouTubePlayer = forwardRef<
  YouTubeControls,
  {
    videoId: string;
    compact?: boolean;
    volume: number;
    onPlaying(playing: boolean): void;
    onEnded(): void;
    onError(message: string): void;
  }
>(function YouTubePlayer(props, ref) {
  const container = useRef<HTMLDivElement>(null),
    player = useRef<EmbeddedPlayer | null>(null);
  const ready = useRef(false),
    callbacks = useRef(props);
  callbacks.current = props;
  const retryStart = useRef<(() => void) | null>(null);
  useImperativeHandle(
    ref,
    () => ({
      play: () => {
        if (ready.current) player.current?.playVideo();
        else retryStart.current?.();
      },
      pause: () => {
        if (ready.current) player.current?.pauseVideo();
      },
      setVolume: (value) => {
        if (ready.current) player.current?.setVolume(value * 100);
      },
    }),
    [],
  );
  useEffect(() => {
    let stopped = false,
      instance: EmbeddedPlayer | null = null;
    const root = container.current;
    let loading = false;
    const start = () => {
      if (stopped || loading || instance || !root) return;
      loading = true;
      void loadApi()
        .then((api) => {
          if (stopped) return;
          const target = document.createElement('div');
          root.replaceChildren(target);
          instance = new api.Player(target, {
            width: '100%',
            height: '100%',
            host: 'https://www.youtube-nocookie.com',
            videoId: props.videoId,
            playerVars: { origin: window.location.origin, playsinline: 1, autoplay: 0 },
            events: {
              onReady: ({ target: current }) => {
                if (stopped) {
                  current.destroy();
                  return;
                }
                ready.current = true;
                player.current = current;
                current.setVolume(callbacks.current.volume * 100);
                current.playVideo();
              },
              onStateChange: ({ data }) => {
                if (stopped) return;
                callbacks.current.onPlaying(data === 1);
                if (data === 0) callbacks.current.onEnded();
              },
              onError: ({ data }) => {
                if (stopped) return;
                callbacks.current.onPlaying(false);
                callbacks.current.onError(
                  `YouTube không phát được video (mã ${data}). Video có thể bị xóa hoặc chặn nhúng. Thử bài khác.`,
                );
              },
              onAutoplayBlocked: () => {
                if (stopped) return;
                callbacks.current.onPlaying(false);
                callbacks.current.onError(
                  'Trình duyệt đang chặn tự phát. Bấm phát trong khung YouTube hoặc Phát / thử lại.',
                );
              },
            },
          });
          player.current = instance;
        })
        .catch((error: unknown) => {
          if (!stopped)
            callbacks.current.onError(
              error instanceof Error ? error.message : 'Không tải được YouTube.',
            );
        })
        .finally(() => {
          loading = false;
        });
    };
    retryStart.current = start;
    start();
    return () => {
      stopped = true;
      ready.current = false;
      retryStart.current = null;
      player.current = null;
      instance?.destroy();
      root?.replaceChildren();
    };
  }, [props.videoId]);
  return (
    <div
      aria-label="Trình phát YouTube"
      ref={container}
      className={
        props.compact
          ? 'aspect-video min-h-[200px] w-full max-w-[360px] overflow-hidden rounded-xl bg-black'
          : 'aspect-video min-h-[200px] w-full overflow-hidden rounded-xl bg-black'
      }
    />
  );
});
