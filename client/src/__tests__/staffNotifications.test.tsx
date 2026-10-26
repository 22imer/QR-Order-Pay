// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { StaffLayout } from '../layouts/StaffLayout';
import { RecentCancellations } from '../features/staff/RecentCancellations';
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
function Destination() {
  return <output>{useLocation().pathname}</output>;
}
afterEach(() => {
  cleanup();
  qc.clear();
  mock.listeners.clear();
  vi.clearAllMocks();
});
describe('staff notifications', () => {
  it('routes each staff customer alert to its matching function', async () => {
    let reservations = 0,
      services: unknown[] = [];
    mock.get.mockImplementation(async (url: string) => ({
      data: {
        success: true,
        data: {
          items: url === '/staff/service-requests' ? services : [],
          total: url === '/staff/reservations' ? reservations : 0,
        },
      },
    }));
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/staff/kds']}>
          <StaffLayout />
          <Destination />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(qc.getQueryData(['staff-service-requests'])).toEqual({ items: [], total: 0 }),
    );
    const emit = (event: string, data: unknown) =>
      act(() => {
        for (const fn of mock.listeners.get(event) ?? []) fn(data);
      });
    const openLast = (path: string) => {
      act(() => mock.toast.mock.calls.at(-1)![0].onClick());
      expect(screen.getByText(path)).toBeTruthy();
    };
    emit('order.created', { orderId: 'pickup-new', status: 'AWAITING_PAYMENT' });
    await waitFor(() => expect(mock.toast).toHaveBeenCalled());
    openLast('/staff/pickups');
    emit('order.created', {
      orderId: 'table-new',
      tableSessionId: 'table',
      status: 'AWAITING_PAYMENT',
    });
    openLast('/staff/tables');
    emit('cancelRequest.created', { requestId: 'r-new', orderCode: 'REQ01' });
    openLast('/staff/kds');
    emit('order.statusChanged', { orderId: 'cancel-new', status: 'CANCELLED' });
    openLast('/staff/tables');
    services = [{ _id: 'service-new', status: 'OPEN', type: 'CALL_STAFF', tableName: 'Bàn 1' }];
    emit('serviceRequest.created', {});
    await waitFor(() =>
      expect(mock.toast).toHaveBeenLastCalledWith(
        expect.objectContaining({ title: 'Yêu cầu mới (1)' }),
      ),
    );
    openLast('/staff/service-requests');
    await waitFor(() => expect(qc.getQueryData(['reservation-alerts', 'staff-a'])).toBeTruthy());
    reservations = 1;
    emit('reservation.changed', {});
    await waitFor(() =>
      expect(mock.toast).toHaveBeenLastCalledWith(
        expect.objectContaining({ title: 'Lịch đặt bàn mới (1)' }),
      ),
    );
    openLast('/staff/reservations');
    emit('payment.confirmed', {});
    openLast('/staff/payments');
    expect(
      mock.browser.mock.calls.filter((call) => typeof call[2] === 'function').length,
    ).toBeGreaterThanOrEqual(6);
  });
  it('announces cancellations once across realtime and polling, refreshes the cashier list and keeps initial history quiet', async () => {
    let rows = [{ _id: 'old', code: 'OLD01' }];
    mock.get.mockImplementation(async (url: string, options?: { params?: { status: string } }) => ({
      data: {
        success: true,
        data: {
          items: url === '/staff/orders' && options?.params?.status === 'CANCELLED' ? rows : [],
        },
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
    await waitFor(() =>
      expect(qc.getQueryData(['staff-cancelled-orders'])).toEqual({ items: rows }),
    );
    expect(mock.toast).not.toHaveBeenCalled();
    const cashReads = mock.get.mock.calls.filter(
      ([url]) => url === '/staff/awaiting-payments',
    ).length;
    rows = [{ _id: 'new', code: 'NEW01' }, ...rows];
    act(() => {
      for (const listener of mock.listeners.get('order.statusChanged')!) {
        listener({ orderId: 'new', orderCode: 'NEW01', status: 'CANCELLED' });
        listener({ orderId: 'new', orderCode: 'NEW01', status: 'CANCELLED' });
      }
    });
    await waitFor(() =>
      expect(qc.getQueryData(['staff-cancelled-orders'])).toEqual({ items: rows }),
    );
    expect(mock.toast).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ title: 'Đơn NEW01 đã hủy' }),
    );
    expect(mock.browser).toHaveBeenCalledOnce();
    expect(mock.sound).toHaveBeenCalledExactlyOnceWith('request');
    expect(
      mock.get.mock.calls.filter(([url]) => url === '/staff/awaiting-payments').length,
    ).toBeGreaterThan(cashReads);
    rows = [{ _id: 'missed', code: 'MISSED01' }, ...rows];
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['staff-cancelled-orders'] });
    });
    await waitFor(() => expect(mock.toast).toHaveBeenCalledTimes(2));
    expect(mock.toast).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Đơn MISSED01 đã hủy' }),
    );
  });

  it('shows new cancellation requests in the KDS badge immediately and refreshes on resolution', async () => {
    let rows: Array<{ _id: string; orderId: { code: string } }> = [];
    mock.get.mockImplementation(async (url: string) => ({
      data: { success: true, data: { items: url === '/staff/cancel-requests' ? rows : [] } },
    }));
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <StaffLayout />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(qc.getQueryData(['staff-cancel-requests'])).toEqual({ items: [] }));
    rows = [{ _id: 'request1', orderId: { code: 'REQ01' } }];
    act(() => {
      for (const listener of mock.listeners.get('cancelRequest.created')!)
        listener({ requestId: 'request1', orderCode: 'REQ01' });
    });
    await screen.findByText('KDS: 1');
    expect(mock.toast).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ title: 'Khách yêu cầu hủy đơn REQ01' }),
    );
    rows = [];
    act(() => {
      for (const listener of mock.listeners.get('cancelRequest.resolved')!)
        listener({ requestId: 'request1' });
    });
    await screen.findByText('KDS: 0');
    expect(mock.toast).toHaveBeenCalledOnce();
  });

  it('loads recent cancellations after opening the page, shows their destination and reason, and offers retry on failure', async () => {
    let fail = true;
    mock.get.mockImplementation(async () => {
      if (fail) throw new Error('Không tải được');
      return {
        data: {
          success: true,
          data: {
            items: [
              {
                _id: 'o1',
                code: 'CUP01',
                tableName: 'Bàn 01',
                cancelReason: 'Khách hủy',
                paymentStatus: 'UNPAID',
                statusHistory: [{ to: 'CANCELLED', at: '2026-10-26T05:00:00Z' }],
                items: [{ quantity: 2, nameSnapshot: 'Cappuccino' }],
              },
            ],
          },
        },
      };
    });
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = () => (
      <QueryClientProvider client={qc}>
        <RecentCancellations />
      </QueryClientProvider>
    );
    const view = render(tree());
    const retry = await screen.findByRole('button', { name: /thử lại/i });
    fail = false;
    fireEvent.click(retry);
    await screen.findByText('CUP01 · Bàn 01');
    expect(screen.getByText('Khách hủy')).toBeTruthy();
    expect(screen.getByText('2 × Cappuccino')).toBeTruthy();
    expect(screen.getByText('Chưa thu tiền')).toBeTruthy();
    view.unmount();
    qc.clear();
    render(tree());
    await screen.findByText('CUP01 · Bàn 01');
    expect(mock.get).toHaveBeenLastCalledWith('/staff/orders', { params: { status: 'CANCELLED' } });
  });

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
