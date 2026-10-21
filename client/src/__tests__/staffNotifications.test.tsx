// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { StaffLayout } from '../layouts/StaffLayout';
const mock = vi.hoisted(() => ({
  get: vi.fn(),
  toast: vi.fn(),
  sound: vi.fn(),
  browser: vi.fn(),
  listeners: new Map<string, Set<(data: unknown) => void>>(),
}));
vi.mock('../features/auth/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'staff-a', name: 'Lan', role: 'STAFF' },
    accessToken: 'test',
    logout: vi.fn(),
  }),
}));
vi.mock('../components/ui/useToast', () => ({ useToast: () => ({ toast: mock.toast }) }));
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  api: { get: mock.get },
}));
vi.mock('../features/staff/notifications', async (original) => ({
  ...(await original<typeof import('../features/staff/notifications')>()),
  playAlert: mock.sound,
  notifyBrowser: mock.browser,
  requestNotifyPermission: () => Promise.resolve('denied'),
}));
vi.mock('../components/layout/InternalShell', () => ({
  InternalShell: ({ nav }: { nav: { label: string; badge?: number | null }[] }) => (
    <div>
      {nav.map((n) => (
        <span key={n.label}>
          {n.label}: {n.badge ?? 0}
        </span>
      ))}
    </div>
  ),
}));
vi.mock('../lib/socket', async () => {
  const { useEffect, useRef } = await import('react');
  return {
    connectStaffSocket: () => ({ connected: true }),
    disconnectSocket: vi.fn(),
    useSocketEvent: (event: string, fn: (data: unknown) => void) => {
      const ref = useRef(fn);
      ref.current = fn;
      useEffect(() => {
        const cb = (data: unknown) => ref.current(data);
        if (!mock.listeners.has(event)) mock.listeners.set(event, new Set());
        mock.listeners.get(event)!.add(cb);
        return () => {
          mock.listeners.get(event)?.delete(cb);
        };
      }, [event]);
    },
  };
});
let qc: QueryClient;
afterEach(() => {
  cleanup();
  qc.clear();
  mock.listeners.clear();
  vi.clearAllMocks();
});
describe('staff notifications', () => {
  it('uses the full pickup total for its badge and triggers toast, sound and refetch on an unpaid order', async () => {
    let total = 40;
    mock.get.mockImplementation(async (url: string) => ({
      data: {
        success: true,
        data:
          url === '/staff/pickups'
            ? { items: Array.from({ length: 30 }, (_, i) => ({ _id: `old-${i}` })), total }
            : { items: [] },
      },
    }));
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <StaffLayout />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText('Mang đi & đặt trước: 40');
    expect(mock.toast).not.toHaveBeenCalled();
    total = 41;
    act(() => {
      for (const fn of mock.listeners.get('order.created')!)
        fn({ orderId: 'new', status: 'AWAITING_PAYMENT' });
    });
    await screen.findByText('Mang đi & đặt trước: 41');
    await waitFor(() => expect(mock.sound).toHaveBeenCalledExactlyOnceWith('order'));
    expect(mock.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Đơn mang đi mới (1)' }),
    );
    expect(mock.browser).toHaveBeenCalledOnce();
  });
});
