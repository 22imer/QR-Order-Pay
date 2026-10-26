// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy } from 'react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import type { JukeboxFeed, JukeboxStaffFeed, JukeboxCatalogTrack } from '@may-cafe/contracts';
import { JukeboxPage } from '../features/jukebox/JukeboxPage';
import { JukeboxPlayer } from '../features/jukebox/JukeboxPlayer';
import { JukeboxCatalog } from '../features/jukebox/JukeboxCatalog';
import { PersistentJukebox, JukeboxRoute } from '../features/jukebox/PersistentJukebox';
import { InternalShell } from '../components/layout/InternalShell';
const mock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  active: true,
  owner: 'a',
  events: new Map<string, () => void>(),
  feed: null as JukeboxFeed | null,
  player: null as JukeboxStaffFeed | null,
  catalog: [] as JukeboxCatalogTrack[],
}));
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  api: mock,
}));
vi.mock('../lib/socket', () => ({
  useSocketEvent: (e: string, cb: () => void) => mock.events.set(e, cb),
}));
vi.mock('../features/auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-a' } }) }));
const tid = '507f1f77bcf86cd799439011',
  sid = '507f1f77bcf86cd799439012';
const song = { id: tid, title: 'Nắng', artist: 'An' };
const response = (data: unknown) => ({ data: { success: true, data } });
let qc: QueryClient,
  hidden = false,
  play: ReturnType<typeof vi.spyOn>,
  pause: ReturnType<typeof vi.spyOn>;
function mount(page = <JukeboxPage />) {
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{page}</MemoryRouter>
    </QueryClientProvider>,
  );
}
function mountPersistent(other: JSX.Element = <h1>Trang bàn</h1>) {
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/staff/jukebox']}>
        <Routes>
          <Route
            element={
              <InternalShell
                title="Vận hành"
                home="/staff"
                nav={[]}
                name="Lan"
                role="STAFF"
                onLogout={vi.fn()}
                player={<PersistentJukebox />}
              />
            }
          >
            <Route
              path="/staff/jukebox"
              element={
                <>
                  <JukeboxRoute />
                  <Link to="/staff/tables">Đổi chức năng</Link>
                </>
              }
            />
            <Route
              path="/staff/tables"
              element={
                <>
                  {other}
                  <Link to="/staff/jukebox">Về chọn nhạc</Link>
                </>
              }
            />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.restoreAllMocks();
  delete (window as Window & { YT?: unknown }).YT;
  hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    this.dispatchEvent(new Event('pause'));
  });
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  mock.get.mockReset();
  mock.post.mockReset();
  mock.put.mockReset();
  mock.active = true;
  mock.owner = 'a';
  mock.events.clear();
  sessionStorage.clear();
  mock.feed = {
    tracks: [song],
    queue: [],
    current: null,
    playbackVersion: 0,
    serverNow: Date.now(),
    vote: { trackId: null, version: 0, remaining: 5, canVote: true },
  };
  mock.player = {
    ...mock.feed,
    current: null,
    vote: null,
    lease: { owned: false, busy: false, until: 0 },
  };
  mock.catalog = [
    { ...song, audioUrl: 'https://music.example.test/one.mp3', version: 1, enabled: true },
  ];
  mock.get.mockImplementation(async (url: string) => {
    if (url === '/table-sessions/current')
      return response(
        mock.active
          ? {
              active: true,
              tableSessionId: sid,
              participantId: mock.owner,
              status: 'OPEN',
              table: { name: 'Bàn 1' },
            }
          : { active: false },
      );
    if (url === '/jukebox') return response(mock.feed);
    if (url.endsWith('/tracks')) return response(mock.catalog);
    if (url.includes('/jukebox?')) return response(mock.player);
    throw new Error(url);
  });
  mock.post.mockImplementation(async (url: string) => {
    if (url.endsWith('/claim') || url.endsWith('/heartbeat')) {
      mock.player = {
        ...mock.player!,
        serverNow: Date.now(),
        lease: { owned: true, busy: true, until: Date.now() + 30000 },
      };
      return response(mock.player);
    }
    return response({});
  });
});
afterEach(() => {
  cleanup();
  qc.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe('jukebox guest and admin', () => {
  it('gates voting behind QR and makes no jukebox calls without an active session', async () => {
    mock.active = false;
    mount();
    await screen.findByText('Quét QR tại bàn để bình chọn nhạc cho quán.');
    expect(mock.get.mock.calls.map((c) => c[0])).toEqual(['/table-sessions/current']);
    expect(play).not.toHaveBeenCalled();
  });
  it('submits the shared ballot version and keeps entertainment silent on guest devices', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Chọn Nắng' }));
    await waitFor(() =>
      expect(mock.post).toHaveBeenCalledWith(
        '/jukebox/vote',
        expect.objectContaining({ trackId: tid, expectedVersion: 0 }),
      ),
    );
    expect(play).not.toHaveBeenCalled();
    expect(document.querySelector('audio')).toBeNull();
  });
  it('reflects session-wide votes on socket/reconnect and lets guests cancel', async () => {
    mount();
    await screen.findByRole('button', { name: 'Chọn Nắng' });
    mock.feed = {
      ...mock.feed!,
      vote: { ...mock.feed!.vote!, trackId: tid, version: 2 },
      queue: [{ ...song, votes: 2 }],
    };
    act(() => mock.events.get('jukebox.changed')?.());
    fireEvent.click(await screen.findByRole('button', { name: 'Hủy chọn Nắng' }));
    await waitFor(() =>
      expect(mock.post).toHaveBeenCalledWith(
        '/jukebox/vote',
        expect.objectContaining({ trackId: null, expectedVersion: 2 }),
      ),
    );
    const count = mock.get.mock.calls.length;
    act(() => mock.events.get('connect')?.());
    await waitFor(() => expect(mock.get.mock.calls.length).toBeGreaterThan(count));
  });
  it('locks checkout/exhausted sessions and the currently selected track', async () => {
    mock.feed!.vote!.canVote = false;
    mock.feed!.vote!.remaining = 0;
    mount();
    expect(
      (await screen.findByRole('button', { name: 'Chọn Nắng' })).hasAttribute('disabled'),
    ).toBe(true);
    expect(screen.getByText(/Còn 0\/5/)).toBeTruthy();
  });
  it('restores an uncertain ballot across reload and retries its exact payload', async () => {
    mock.post.mockRejectedValueOnce(new Error('offline'));
    const first = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Chọn Nắng' }));
    await screen.findByRole('button', { name: 'Thử lại' });
    const payload = mock.post.mock.calls[0]![1];
    first.unmount();
    qc.clear();
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(mock.post.mock.calls[1]![1]).toEqual(payload));
    expect(mock.post.mock.calls[1]![0]).toBe('/jukebox/vote');
  });
  it('never sends a previous participant pending vote for a new identity', async () => {
    sessionStorage.setItem(
      `mc-jukebox:${sid}:old`,
      JSON.stringify({ url: '/jukebox/vote', method: 'post', body: { requestId: 'old' } }),
    );
    mount();
    await screen.findByRole('button', { name: 'Chọn Nắng' });
    expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
    expect(mock.post).not.toHaveBeenCalled();
  });
  it('shows empty/error states instead of phantom music', async () => {
    mock.feed!.tracks = [];
    const one = mount();
    await screen.findByText('Quán chưa mở danh sách nhạc.');
    one.unmount();
    qc.clear();
    mock.get.mockRejectedValue(new Error('network down'));
    mount();
    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toContain('network down');
  });
  it('edits the real admin version and recovers an uncertain new track without duplicate create', async () => {
    mock.put.mockResolvedValue(response({}));
    const view = mount(<JukeboxCatalog />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa Nắng' }));
    fireEvent.change(screen.getByLabelText('Tên bài'), { target: { value: 'Mưa' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu bài' }));
    await waitFor(() =>
      expect(mock.put).toHaveBeenCalledWith(
        `/admin/jukebox/tracks/${tid}`,
        expect.objectContaining({ title: 'Mưa', expectedVersion: 1 }),
      ),
    );
    await waitFor(() =>
      expect((screen.getByLabelText('Tên bài') as HTMLInputElement).value).toBe(''),
    );
    mock.post.mockRejectedValueOnce(new Error('lost response'));
    fireEvent.change(screen.getByLabelText('Tên bài'), { target: { value: 'Mới' } });
    fireEvent.change(screen.getByLabelText('Nghệ sĩ'), { target: { value: 'Bình' } });
    fireEvent.change(screen.getByLabelText(/Link YouTube hoặc file nhạc/), {
      target: { value: 'https://music.example.test/new.mp3' },
    });
    fireEvent.submit(screen.getByRole('button', { name: 'Thêm bài' }).closest('form')!);
    await screen.findByRole('button', { name: 'Thử lại lưu bài' });
    const payload = mock.post.mock.calls[0]![1];
    view.unmount();
    qc.clear();
    mount(<JukeboxCatalog />);
    fireEvent.click(await screen.findByRole('button', { name: 'Thử lại lưu bài' }));
    await waitFor(() => expect(mock.post.mock.calls[1]![1]).toEqual(payload));
  });
});
describe('counter audio authority and recovery', () => {
  it('lets the owner explicitly choose a song with no votes and preserves a manual selection on exact retry', async () => {
    mount(<JukeboxPlayer />);
    const button = await screen.findByRole('button', { name: 'Phát Nắng' });
    expect(button.hasAttribute('disabled')).toBe(true);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Bật phát trên máy này' }).hasAttribute('disabled'),
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Bật phát trên máy này' }));
    await screen.findByRole('button', { name: 'Nhả thiết bị' });
    mock.post.mockRejectedValueOnce(new Error('lost manual response'));
    fireEvent.click(screen.getByRole('button', { name: 'Phát Nắng' }));
    await screen.findByRole('button', { name: 'Thử lại thao tác' });
    const call = mock.post.mock.calls.at(-1)!;
    expect(call[0]).toBe('/staff/jukebox/play');
    expect(call[1]).toMatchObject({ trackId: tid, playbackVersion: 0 });
    expect(screen.getByRole('button', { name: 'Phát Nắng' }).hasAttribute('disabled')).toBe(true);
    mock.player = { ...mock.player!, playbackVersion: 1, current: { ...song, audioUrl: 'https://music.example.test/one.mp3' } };
    mock.post.mockResolvedValue(response(mock.player));
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại thao tác' }));
    await waitFor(() => expect(mock.post.mock.calls.at(-1)).toEqual(call));
    await screen.findByText('Đang phát trên thiết bị này');
    expect(mock.post.mock.calls.some((c) => c[0].endsWith('/next'))).toBe(false);
  });
  it('never starts audio on page entry and disables claims while another device owns playback', async () => {
    mock.player!.lease.busy = true;
    mount(<JukeboxPlayer />);
    expect(
      (await screen.findByRole('button', { name: 'Bật phát trên máy này' })).hasAttribute(
        'disabled',
      ),
    ).toBe(true);
    expect(play).not.toHaveBeenCalled();
    expect(mock.post).not.toHaveBeenCalled();
  });
  async function claimCurrent() {
    mock.player!.current = { ...song, audioUrl: 'https://music.example.test/one.mp3' };
    const view = mount(<JukeboxPlayer />);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Bật phát trên máy này' }).hasAttribute('disabled'),
      ).toBe(false),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Bật phát trên máy này' }));
    await screen.findByRole('button', { name: 'Nhả thiết bị' });
    return view;
  }
  it('claims explicitly, sets volume and reports autoplay rejection with an explicit retry', async () => {
    play.mockRejectedValueOnce(new DOMException('blocked', 'NotAllowedError'));
    await claimCurrent();
    await screen.findByText(/Chưa phát được âm thanh/);
    expect(document.querySelector('audio')!.volume).toBe(0.5);
    fireEvent.click(screen.getByRole('button', { name: 'Phát / thử lại' }));
    await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
  });
  it('sends next from ended exactly once with the playback generation and preserves volume across songs', async () => {
    await claimCurrent();
    await waitFor(() => expect(play).toHaveBeenCalled());
    const old = document.querySelector('audio')!;
    hidden = true;
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    mock.post.mockImplementation(async (url: string) => {
      if (url.endsWith('/next')) {
        mock.player = {
          ...mock.player!,
          playbackVersion: 1,
          current: { ...song, title: 'Bài tiếp', audioUrl: 'https://music.example.test/two.mp3' },
        };
        return response(mock.player);
      }
      return response(mock.player);
    });
    fireEvent.ended(old);
    fireEvent.ended(old);
    await screen.findByRole('heading', { name: 'Bài tiếp' });
    expect(mock.post.mock.calls.filter((c) => c[0].endsWith('/next'))).toHaveLength(1);
    expect(mock.post.mock.calls.find((c) => c[0].endsWith('/next'))![1]).toMatchObject({
      playbackVersion: 0,
    });
    expect(document.querySelector('audio')!.volume).toBe(0.5);
  });
  it('keeps the same audio playing and renews its lease while the tab is hidden, then releases on unmount', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const view = await claimCurrent();
    await waitFor(() => expect(play).toHaveBeenCalled());
    const element = document.querySelector('audio')!;
    element.currentTime = 23;
    pause.mockClear();
    hidden = true;
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_001);
    });
    expect(mock.post.mock.calls.filter((c) => c[0].endsWith('/heartbeat'))).toHaveLength(2);
    expect(mock.post.mock.calls.some((c) => c[0].endsWith('/release'))).toBe(false);
    expect(document.querySelector('audio')).toBe(element);
    expect(element.currentTime).toBe(23);
    expect(pause).not.toHaveBeenCalled();
    hidden = false;
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(screen.getByRole('button', { name: 'Nhả thiết bị' })).toBeTruthy();
    view.unmount();
    expect(mock.post.mock.calls.filter((c) => c[0].endsWith('/release'))).toHaveLength(1);
    expect(pause).toHaveBeenCalled();
  });
  it('prevents late claims from resurrecting an unmounted player', async () => {
    qc.clear();
    let resolve!: (value: unknown) => void;
    mock.player!.lease.busy = false;
    mock.post.mockImplementation((url: string) =>
      url.endsWith('/claim')
        ? new Promise((r) => {
            resolve = r;
          })
        : Promise.resolve(response(mock.player)),
    );
    const next = mount(<JukeboxPlayer />);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Bật phát trên máy này' }).hasAttribute('disabled'),
      ).toBe(false),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Bật phát trên máy này' }));
    next.unmount();
    const before = play.mock.calls.length;
    await act(async () => {
      resolve(
        response({
          ...mock.player!,
          lease: { owned: true, busy: true, until: Date.now() + 30000 },
        }),
      );
    });
    expect(play.mock.calls.length).toBe(before);
    expect(mock.post.mock.calls.at(-1)![0]).toBe('/staff/jukebox/release');
  });
  it('keeps audio, position, volume and device ownership across navigation and a suspending destination', async () => {
    let resolve!: (module: { default: () => JSX.Element }) => void;
    const Destination = lazy(
      () =>
        new Promise<{ default: () => JSX.Element }>((r) => {
          resolve = r;
        }),
    );
    mock.player!.current = { ...song, audioUrl: 'https://music.example.test/one.mp3' };
    mountPersistent(<Destination />);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Bật phát trên máy này' }).hasAttribute('disabled'),
      ).toBe(false),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Bật phát trên máy này' }));
    await waitFor(() => expect(play).toHaveBeenCalled());
    const element = document.querySelector('audio')!;
    element.currentTime = 42;
    fireEvent.change(screen.getByRole('slider'), { target: { value: '0.7' } });
    const plays = play.mock.calls.length;
    const pauses = pause.mock.calls.length;
    fireEvent.click(screen.getByRole('link', { name: 'Đổi chức năng' }));
    await waitFor(() => expect(resolve).toBeTypeOf('function'));
    expect(document.querySelector('audio')).toBe(element);
    await act(async () => {
      resolve({ default: () => <h1>Trang bàn</h1> });
    });
    await screen.findByRole('heading', { name: 'Trang bàn' });
    expect(screen.getByRole('link', { name: 'Mở Jukebox' })).toBeTruthy();
    expect(element.currentTime).toBe(42);
    expect(element.volume).toBe(0.7);
    expect(mock.post.mock.calls.filter((c) => c[0].endsWith('/claim'))).toHaveLength(1);
    expect(mock.post.mock.calls.some((c) => c[0].endsWith('/release'))).toBe(false);
    fireEvent.click(screen.getByRole('link', { name: 'Về chọn nhạc' }));
    await screen.findByRole('heading', { name: 'Jukebox' });
    expect(document.querySelector('audio')).toBe(element);
    expect(play).toHaveBeenCalledTimes(plays);
    expect(pause).toHaveBeenCalledTimes(pauses);
    fireEvent.click(screen.getByRole('button', { name: 'Tạm dừng' }));
    fireEvent.click(screen.getByRole('link', { name: 'Đổi chức năng' }));
    await screen.findByRole('heading', { name: 'Trang bàn' });
    expect(screen.getByRole('button', { name: 'Phát / thử lại' })).toBeTruthy();
    expect(play).toHaveBeenCalledTimes(plays);
  });
  it('preserves the visible YouTube instance when navigating or hiding the browser tab', async () => {
    const commands = {
      playVideo: vi.fn(),
      pauseVideo: vi.fn(),
      setVolume: vi.fn(),
      destroy: vi.fn(),
    };
    const create = vi.fn(function (
      element: HTMLElement,
      options: {
        events: {
          onReady(event: { target: typeof commands }): void;
          onStateChange(event: { data: number }): void;
        };
      },
    ) {
      const iframe = document.createElement('iframe');
      iframe.title = 'Bài YouTube';
      element.replaceWith(iframe);
      commands.playVideo.mockImplementation(() => options.events.onStateChange({ data: 1 }));
      queueMicrotask(() => options.events.onReady({ target: commands }));
      return commands;
    });
    Object.assign(window, { YT: { Player: create } });
    mock.player!.current = { ...song, audioUrl: 'https://youtu.be/dQw4w9WgXcQ' };
    const view = mountPersistent();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Bật phát trên máy này' }).hasAttribute('disabled'),
      ).toBe(false),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Bật phát trên máy này' }));
    await screen.findByText('Đang phát trên thiết bị này');
    const iframe = document.querySelector('iframe')!;
    const pauseCount = commands.pauseVideo.mock.calls.length;
    hidden = true;
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    fireEvent.click(screen.getByRole('link', { name: 'Đổi chức năng' }));
    await screen.findByRole('heading', { name: 'Trang bàn' });
    expect(document.querySelector('iframe')).toBe(iframe);
    expect(iframe.closest('[hidden]')).toBeNull();
    expect(create).toHaveBeenCalledOnce();
    expect(commands.pauseVideo).toHaveBeenCalledTimes(pauseCount);
    expect(commands.destroy).not.toHaveBeenCalled();
    expect(mock.post.mock.calls.some((c) => c[0].endsWith('/release'))).toBe(false);
    view.unmount();
    expect(commands.destroy).toHaveBeenCalledOnce();
  });
  it('retains an uncertain next command across navigation and retries the exact request', async () => {
    mock.player!.current = { ...song, audioUrl: 'https://music.example.test/one.mp3' };
    mountPersistent();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Bật phát trên máy này' }).hasAttribute('disabled'),
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Bật phát trên máy này' }));
    await screen.findByRole('button', { name: 'Nhả thiết bị' });
    mock.post.mockRejectedValueOnce(new Error('lost response'));
    fireEvent.click(screen.getByRole('button', { name: 'Bài tiếp theo' }));
    await screen.findByRole('button', { name: 'Thử lại thao tác' });
    const request = mock.post.mock.calls.at(-1)!;
    fireEvent.click(screen.getByRole('link', { name: 'Đổi chức năng' }));
    await screen.findByRole('heading', { name: 'Trang bàn' });
    expect(screen.getByRole('button', { name: 'Bài tiếp theo' }).hasAttribute('disabled')).toBe(
      true,
    );
    mock.post.mockResolvedValue(response(mock.player));
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại thao tác' }));
    await waitFor(() => expect(mock.post.mock.calls.at(-1)).toEqual(request));
    expect(mock.post.mock.calls.filter((c) => c[0].endsWith('/next'))).toHaveLength(2);
    expect(mock.post.mock.calls.some((c) => c[0].endsWith('/release'))).toBe(false);
  });
  it('halts on return after a suspended tab outlives its lease and releases on pagehide', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    await claimCurrent();
    hidden = true;
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    vi.setSystemTime(Date.now() + 31_000);
    mock.player!.lease = { owned: false, busy: false, until: 0 };
    hidden = false;
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await screen.findByText('Quyền phát đã hết hạn. Bấm Bật phát trên máy này để kết nối lại.');
    expect(screen.queryByRole('button', { name: 'Nhả thiết bị' })).toBeNull();
    expect(pause).toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Bật phát trên máy này' }).hasAttribute('disabled'),
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Bật phát trên máy này' }));
    await screen.findByRole('button', { name: 'Nhả thiết bị' });
    act(() => window.dispatchEvent(new Event('pagehide')));
    expect(mock.post.mock.calls.at(-1)![0]).toBe('/staff/jukebox/release');
  });
  it('shows a failed URL and allows recovery without automatic repeated skips', async () => {
    await claimCurrent();
    fireEvent.error(document.querySelector('audio')!);
    await screen.findByText('Nguồn nhạc không phát được. Kiểm tra URL hoặc chuyển bài.');
    expect(mock.post.mock.calls.filter((c) => c[0].endsWith('/next'))).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Bài tiếp theo' }).hasAttribute('disabled')).toBe(
      false,
    );
  });
  it('retries an uncertain next with the same key and version', async () => {
    await claimCurrent();
    mock.post.mockRejectedValueOnce(new Error('lost response'));
    fireEvent.click(screen.getByRole('button', { name: 'Bài tiếp theo' }));
    await screen.findByRole('button', { name: 'Thử lại thao tác' });
    const prior = mock.post.mock.calls.at(-1)![1];
    expect(screen.getByRole('button', { name: 'Bài tiếp theo' }).hasAttribute('disabled')).toBe(
      true,
    );
    mock.post.mockResolvedValue(response(mock.player));
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại thao tác' }));
    await waitFor(() => expect(mock.post.mock.calls.at(-1)![1]).toEqual(prior));
  });
  it('stops audio on heartbeat failure and refuses auto-claim', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    await claimCurrent();
    const last = mock.post.mock.calls.length;
    mock.post.mockRejectedValue(new Error('lease lost'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10001);
    });
    vi.useRealTimers();
    await screen.findByText('lease lost');
    expect(screen.queryByRole('button', { name: 'Nhả thiết bị' })).toBeNull();
    expect(mock.post.mock.calls.slice(last).filter((c) => c[0].endsWith('/claim'))).toHaveLength(0);
  });
});
