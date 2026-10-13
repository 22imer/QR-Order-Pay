// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AxiosError, type AxiosResponse } from 'axios';
import type * as apiModule from '../lib/api';
import { ToastProvider } from '../components/ui/Toast';
import { useCart } from '../store/cart';
import { JoinPage } from '../features/guest/JoinPage';

/**
 * Node 26 công bố `globalThis.localStorage` (trả `undefined` nếu thiếu `--localstorage-file`) nên
 * vitest không copy `localStorage` của jsdom sang global nữa, và `window.localStorage` cũng trỏ về
 * global đó. Store `useCart` dùng `zustand/persist` nên cần storage thật để không nổ khi tạo store.
 * Shim in-memory dưới đây nằm trong `vi.hoisted` (chạy trước mọi import) và cố ý ghi đè, để mỗi lần
 * chạy test luôn sạch như nhau, không phụ thuộc storage cấp file của Node.
 */
const mocks = vi.hoisted(() => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string): string | null => data.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      data.set(key, String(value));
    },
    removeItem: (key: string): void => {
      data.delete(key);
    },
    clear: (): void => {
      data.clear();
    },
    key: (index: number): string | null => Array.from(data.keys())[index] ?? null,
    get length(): number {
      return data.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    writable: true,
    configurable: true,
  });
  return { get: vi.fn(), post: vi.fn(), patch: vi.fn(), disconnect: vi.fn() };
});

vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof apiModule>()),
  api: { get: mocks.get, post: mocks.post, patch: mocks.patch },
}));
vi.mock('../lib/socket', () => ({
  disconnectSocket: mocks.disconnect,
  connectGuestSocket: vi.fn(),
  getSocket: () => null,
}));

const token = 'qr-token-1';
const ok = (data: unknown) => ({ data: { success: true, data } });

function joined(created: boolean) {
  return {
    guestSessionId: 'g-1',
    participantId: 'p-1',
    tableSessionId: 's-new',
    created,
    table: { id: 't-1', code: 'T04', name: 'Bàn 04', capacity: 4 },
    tableSession: { id: 's-new', status: 'OPEN', startedAt: '2026-09-17T00:00:00.000Z' },
  };
}

// Route `/menu` thật được thay bằng dấu mốc để khẳng định JoinPage đã điều hướng.
function mount(entry: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/t/:token" element={<JoinPage />} />
            <Route path="/menu" element={<div>TRANG-THU-DON</div>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useCart.getState().resetSession();
});
afterEach(cleanup);

describe('JoinPage tự mở phiên khi quét QR bàn chưa có phiên', () => {
  it('auto-joins once and lands on the menu when the server opens a new session', async () => {
    mocks.post.mockResolvedValue(ok(joined(true)));
    mount(`/t/${token}`);
    await screen.findByText('TRANG-THU-DON');
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledWith('/table-sessions/join', { tableToken: token });
    expect(useCart.getState().tableSessionId).toBe('s-new');
    expect(useCart.getState().participantId).toBe('p-1');
    expect(mocks.disconnect).toHaveBeenCalledTimes(1);
  });

  it('joins an already open session without opening a new one', async () => {
    mocks.post.mockResolvedValue(ok(joined(false)));
    mount(`/t/${token}`);
    await screen.findByText('TRANG-THU-DON');
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(useCart.getState().tableSessionId).toBe('s-new');
  });

  it('drops the previous cart when the joined session changes', async () => {
    useCart.getState().setSession('s-old', 'p-old');
    useCart.getState().add({
      productId: 'pr-1',
      variantId: 'v-1',
      sizeName: 'S',
      sugarLevel: '50%',
      iceLevel: 'normal-ice',
      toppingIds: [],
      note: '',
      quantity: 2,
      unitPrice: 35000,
      name: 'Cà phê',
      variantName: 'S',
      image: '',
    });
    expect(useCart.getState().items).toHaveLength(1);
    mocks.post.mockResolvedValue(ok(joined(true)));
    mount(`/t/${token}`);
    await screen.findByText('TRANG-THU-DON');
    expect(useCart.getState().tableSessionId).toBe('s-new');
    expect(useCart.getState().items).toEqual([]);
    expect(await screen.findByText('Phiên trước đã kết thúc — đây là phiên mới')).toBeTruthy();
  });

  it('explains a closed table on FORBIDDEN and stays on the QR screen', async () => {
    mocks.post.mockRejectedValue(
      new AxiosError('Bàn chưa mở phiên', 'ERR_BAD_REQUEST', undefined, undefined, {
        status: 403,
        data: { success: false, error: { code: 'FORBIDDEN', message: 'Bàn chưa mở phiên' } },
      } as AxiosResponse),
    );
    mount(`/t/${token}`);
    expect(await screen.findByText('Bàn chưa mở phiên')).toBeTruthy();
    expect(await screen.findByText('Chưa vào được bàn')).toBeTruthy();
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(useCart.getState().tableSessionId).toBeNull();
    await waitFor(() =>
      expect((screen.getByRole('button', { name: /Vào bàn/ }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    expect(screen.queryByText('TRANG-THU-DON')).toBeNull();
  });
});
