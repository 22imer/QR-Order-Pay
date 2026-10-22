// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { GameRound } from '@may-cafe/contracts';
import { GamePage } from '../features/game/GamePage';
import { wheelAngle } from '../features/game/gameAnimation';
import { createShakeDetector, useShakeToSpin } from '../features/game/gameMotion';
import { useCart } from '../store/cart';

const mock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  active: true,
  owner: 'host-a',
  open: true,
  fail: 0,
  round: null as GameRound | null,
  events: new Map<string, () => void>(),
}));
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  api: mock,
}));
vi.mock('../lib/socket', () => ({
  useSocketEvent: (event: string, callback: () => void) => {
    mock.events.set(event, callback);
  },
}));
const sid = '507f1f77bcf86cd799439011',
  rid = '507f1f77bcf86cd799439012';
const response = (data: unknown) => ({ data: { success: true, data } });
const round = (extra: Partial<GameRound> = {}): GameRound => ({
  id: rid,
  version: 1,
  phase: 'WAITING',
  isHost: true,
  canSpin: true,
  players: [
    { id: 'public-a', name: 'An', isYou: true, isHost: true, eligible: true },
    { id: 'public-b', name: 'Bình', isYou: false, isHost: false, eligible: true },
  ],
  winnerId: null,
  spinStartsAt: null,
  revealsAt: null,
  expiresAt: Date.now() + 600000,
  createdAt: Date.now(),
  ...extra,
});
let qc: QueryClient;
function mount() {
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <GamePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  mock.active = true;
  mock.owner = 'host-a';
  mock.open = true;
  mock.fail = 0;
  mock.round = null;
  mock.events.clear();
  sessionStorage.clear();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
    window.setTimeout(() => cb(performance.now()), 16),
  );
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
  mock.get.mockImplementation(async (url: string) => {
    if (url === '/table-sessions/current')
      return response(
        mock.active
          ? {
              active: true,
              tableSessionId: sid,
              participantId: mock.owner,
              status: mock.open ? 'OPEN' : 'CHECKOUT',
              table: { id: 'table', name: 'Bàn 01', code: 'B01' },
            }
          : { active: false, receiptAvailable: false },
      );
    if (url === '/game')
      return response({
        current: mock.round,
        history: [],
        open: mock.open,
        serverNow: Date.now(),
        nextRoundAt: 0,
      });
    throw new Error(`Unexpected read ${url}`);
  });
  mock.post.mockImplementation(async (url: string, payload: { name?: string }) => {
    if (mock.fail)
      throw { isAxiosError: true, message: 'Mất kết nối', response: { status: mock.fail } };
    if (url === '/game')
      mock.round = round({
        version: 0,
        canSpin: false,
        players: [
          { id: 'public-a', name: payload.name!, isHost: true, isYou: true, eligible: true },
        ],
      });
    if (url.endsWith('/spin'))
      mock.round = round({
        version: 2,
        phase: 'SPINNING',
        canSpin: false,
        winnerId: 'public-b',
        spinStartsAt: Date.now() + 500,
        revealsAt: Date.now() + 5000,
      });
    return response(mock.round);
  });
});
afterEach(() => {
  cleanup();
  qc.clear();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('table game UI and shared result', () => {
  it('requires QR capability and does not read or mutate games outside a table', async () => {
    mock.active = false;
    mount();
    await screen.findByText('Quét QR tại bàn để chơi cùng bạn bè.');
    expect(mock.get.mock.calls.map(([url]) => url)).toEqual(['/table-sessions/current']);
    expect(mock.post).not.toHaveBeenCalled();
  });
  it('creates only after explicit alias confirmation and keeps the table cart unchanged', async () => {
    const before = useCart.getState();
    mount();
    const input = await screen.findByLabelText('Tên trong vòng chơi');
    expect(mock.post).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'An' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tạo vòng mới' }));
    await waitFor(() => expect(mock.post).toHaveBeenCalledTimes(1));
    expect(mock.post.mock.calls[0]![0]).toBe('/game');
    expect(mock.post.mock.calls[0]![1]).toMatchObject({ name: 'An' });
    expect(useCart.getState()).toEqual(before);
    await screen.findByRole('button', { name: 'Quay nào!' });
    expect(screen.getByRole('button', { name: 'Quay nào!' }).hasAttribute('disabled')).toBe(true);
  });
  it('requires each guest to join and gives spin/cancel controls only to the host', async () => {
    mock.round = round({
      isHost: false,
      canSpin: false,
      players: [round().players[0]!, { ...round().players[1]!, isYou: false }],
    });
    mock.round.players[0]!.isYou = false;
    mount();
    const input = await screen.findByLabelText('Tên trong vòng chơi');
    fireEvent.change(input, { target: { value: 'Cường' } });
    expect(screen.queryByRole('button', { name: 'Quay nào!' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hủy vòng' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tham gia vòng' }));
    await waitFor(() => expect(mock.post).toHaveBeenCalledTimes(1));
    expect(mock.post.mock.calls[0]![0]).toBe(`/game/${rid}/join`);
    expect(mock.post.mock.calls[0]![1]).toMatchObject({ name: 'Cường', expectedVersion: 1 });
  });
  it('sends one versioned spin and never sends a client-selected winner or payment request', async () => {
    mock.round = round();
    mount();
    const button = await screen.findByRole('button', { name: 'Quay nào!' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(mock.post).toHaveBeenCalledTimes(1));
    expect(mock.post.mock.calls[0]![0]).toBe(`/game/${rid}/spin`);
    expect(Object.keys(mock.post.mock.calls[0]![1]).sort()).toEqual([
      'expectedVersion',
      'requestId',
    ]);
    await screen.findByText('Cả bàn cùng chờ kết quả…');
    expect(screen.queryByText('Lần này là…')).toBeNull();
  });
  it('reveals the same server-picked name after the common reveal time, including on late load', async () => {
    mock.round = round({
      phase: 'SPINNING',
      winnerId: 'public-b',
      canSpin: false,
      spinStartsAt: Date.now() - 4400,
      revealsAt: Date.now() + 100,
    });
    mount();
    await screen.findByText('Lần này là…');
    expect(screen.getByText('Bình', { selector: 'p' })).toBeTruthy();
    expect(document.querySelector('[data-game-wheel]')!.getAttribute('data-angle')).toBe('1620.00');
    expect(mock.post).not.toHaveBeenCalled();
  });
  it('refetches on a game event and reconnect without auto-joining or auto-spinning', async () => {
    mount();
    await screen.findByRole('button', { name: 'Tạo vòng mới' });
    mock.round = round({ isHost: false, canSpin: false });
    await act(async () => {
      mock.events.get('game.changed')?.();
    });
    await screen.findByText(/Đang chờ tham gia/);
    await act(async () => {
      mock.events.get('connect')?.();
    });
    expect(mock.get.mock.calls.filter(([url]) => url === '/game').length).toBeGreaterThanOrEqual(3);
    expect(mock.post).not.toHaveBeenCalled();
  });
  it('recovers an uncertain spin across reload using the same action and request ID', async () => {
    mock.round = round();
    mock.fail = 503;
    const ui = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Quay nào!' }));
    await screen.findByRole('button', { name: 'Thử lại yêu cầu' });
    const first = mock.post.mock.calls[0]!;
    ui.unmount();
    qc.clear();
    mock.fail = 0;
    mount();
    expect(mock.post).toHaveBeenCalledTimes(1);
    fireEvent.click(await screen.findByRole('button', { name: 'Thử lại yêu cầu' }));
    await waitFor(() => expect(mock.post).toHaveBeenCalledTimes(2));
    expect(mock.post.mock.calls[1]).toEqual(first);
    await waitFor(() => expect(sessionStorage.getItem(`mc-game-pending:${sid}:host-a`)).toBeNull());
  });
  it('isolates pending requests by identity and preserves the normal spin button on unsupported devices', async () => {
    sessionStorage.setItem(
      `mc-game-pending:${sid}:someone-else`,
      JSON.stringify({ url: '/game', payload: { name: 'Khác', requestId: 'old' } }),
    );
    mock.round = round();
    mount();
    const motion = await screen.findByRole('button', { name: 'Bật lắc điện thoại' });
    fireEvent.click(motion);
    await screen.findByText('Lắc cần HTTPS và cảm biến được hỗ trợ. Bạn vẫn có thể bấm Quay.');
    expect(mock.post).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Thử lại yêu cầu' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Quay nào!' }).hasAttribute('disabled')).toBe(false);
  });
  it('handles denied motion permission without a spin and keeps explicit button fallback', async () => {
    vi.stubGlobal('isSecureContext', true);
    const permission = vi.fn().mockResolvedValue('denied');
    vi.stubGlobal('DeviceMotionEvent', { requestPermission: permission });
    mock.round = round();
    mount();
    expect(permission).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Bật lắc điện thoại' }));
    await screen.findByText('Chưa được cấp quyền cảm biến. Hãy dùng nút Quay.');
    expect(permission).toHaveBeenCalledTimes(1);
    expect(mock.post).not.toHaveBeenCalled();
  });
  it('locks mutations during checkout', async () => {
    mock.open = false;
    mock.round = round({ canSpin: false, phase: 'CANCELLED' });
    mount();
    await screen.findByText('Phiên đang kết thúc. Không mở hoặc thay đổi vòng chơi.');
    expect(screen.getByRole('button', { name: 'Tạo vòng mới' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(mock.post).not.toHaveBeenCalled();
  });
});

describe('motion lifecycle and deterministic wheel geometry', () => {
  it('allows a fresh opt-in round after an abandoned lobby expires', async () => {
    mock.round = round({ expiresAt: Date.now() - 1000 });
    mount();
    await screen.findByText('Phòng chờ đã hết hạn');
    fireEvent.change(screen.getByLabelText('Tên trong vòng chơi'), { target: { value: 'An' } });
    expect(screen.queryByRole('button', { name: 'Quay nào!' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tạo vòng mới' }));
    await waitFor(() => expect(mock.post).toHaveBeenCalledTimes(1));
    expect(mock.post.mock.calls[0]![0]).toBe('/game');
  });
  it('aligns to the persisted winner at a common clock and honors reduced motion', () => {
    const r = round({ winnerId: 'public-b', spinStartsAt: 1000, revealsAt: 5500 });
    expect(wheelAngle(r, 500, false)).toBe(0);
    expect(wheelAngle(r, 5500, false)).toBe(1620);
    expect(wheelAngle(r, 3500, false)).toBe(wheelAngle({ ...r }, 3500, false));
    expect(wheelAngle(r, 3500, true)).toBe(0);
    expect(wheelAngle(r, 6000, true)).toBe(1620);
    expect(wheelAngle(r, 3500, false)).toBeGreaterThan(0);
  });
  it('ignores invalid/noisy/arming samples and debounces a deliberate double shake', () => {
    let time = 0;
    const spin = vi.fn(),
      detector = createShakeDetector(spin, () => time);
    const sample = (ms: number, x: number | null) => {
      time = ms;
      detector({ accelerationIncludingGravity: { x, y: 0, z: 0 } });
    };
    sample(0, 0);
    sample(100, 40);
    sample(300, 0);
    sample(800, null);
    sample(900, 0);
    expect(spin).not.toHaveBeenCalled();
    sample(1000, 40);
    sample(1200, 0);
    expect(spin).toHaveBeenCalledTimes(1);
    sample(1400, 40);
    sample(1600, 0);
    expect(spin).toHaveBeenCalledTimes(1);
  });
  it('drops a delayed permission grant after the round changes and removes sensors when hidden', async () => {
    vi.stubGlobal('isSecureContext', true);
    let grant!: (value: string) => void;
    vi.stubGlobal('DeviceMotionEvent', {
      requestPermission: vi.fn(
        () =>
          new Promise<string>((resolve) => {
            grant = resolve;
          }),
      ),
    });
    const spin = vi.fn();
    function Harness({ id }: { id: string }) {
      const motion = useShakeToSpin(id, true, spin);
      return (
        <>
          <button onClick={() => void motion.start()}>Enable</button>
          <p>{motion.armed ? 'Armed' : 'Off'}</p>
        </>
      );
    }
    const ui = render(<Harness id="one" />);
    fireEvent.click(screen.getByText('Enable'));
    ui.rerender(<Harness id="two" />);
    await act(async () => {
      grant('granted');
    });
    expect(screen.getByText('Off')).toBeTruthy();
    expect(spin).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Enable'));
    await act(async () => {
      grant('granted');
    });
    await screen.findByText('Armed');
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    fireEvent(document, new Event('visibilitychange'));
    await screen.findByText('Off');
    expect(spin).not.toHaveBeenCalled();
  });
});
