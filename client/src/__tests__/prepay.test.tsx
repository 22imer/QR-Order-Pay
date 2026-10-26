// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../components/ui/Toast';
import { AwaitingPayments } from '../features/staff/AwaitingPayments';
import { TableDisplayPage } from '../features/guest/TableDisplayPage';
import { StaffTables } from '../features/staff/Tables';

const mock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), qr: vi.fn() }));
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  api: mock,
}));
vi.mock('qrcode', () => ({ default: { toDataURL: mock.qr } }));
const response = (data: unknown) => ({ data: { success: true, data } });
const clients: QueryClient[] = [];
function mount(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(qc);
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
  return qc;
}
afterEach(() => {
  cleanup();
  for (const qc of clients.splice(0)) qc.clear();
  vi.useRealTimers();
  vi.resetAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('table QR display and manual prepayment', () => {
  it('keeps a static QR and download link unchanged after a minute without refreshing or joining', async () => {
    vi.useFakeTimers();
    window.history.replaceState(null, '', '/display#display-secret');
    mock.qr.mockResolvedValue('data:image/png;base64,aW1hZ2U=');
    mock.get.mockResolvedValue(
      response({
        tableId: 't1',
        tableName: 'Bàn 01',
        url: 'https://cafe.test/t/qrs1.fixed.signature',
        expiresAt: null,
        serverTime: Date.now(),
      }),
    );
    mount(<TableDisplayPage />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByText('QR cố định · Có thể tải ảnh để in tại bàn')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(65000);
    });
    expect(mock.get).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Tải ảnh QR' }).getAttribute('download')).toContain(
      'Bàn 01',
    );
    expect(mock.post).not.toHaveBeenCalled();
  });
  it('records the entered installment and keeps the order waiting instead of claiming it reached KDS', async () => {
    mock.get.mockResolvedValue(
      response({
        items: [
          {
            _id: 'partial',
            code: 'MC2',
            tableSessionId: 's2',
            tableName: 'Bàn 02',
            total: 35000,
            paidAmount: 5000,
            balanceDue: 30000,
            version: 2,
            items: [],
          },
        ],
      }),
    );
    mock.post.mockImplementation(async (url: string) =>
      response(
        url.endsWith('/payment-claim')
          ? { expiresAt: new Date(Date.now() + 120000).toISOString(), version: 3 }
          : {},
      ),
    );
    mount(<AwaitingPayments />);
    fireEvent.click(await screen.findByRole('button', { name: 'Kiểm tra & nhận tiền' }));
    const input = await screen.findByLabelText('Số tiền thực nhận (VND)');
    fireEvent.change(input, { target: { value: '10000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ghi nhận khoản thu một phần' }));
    await waitFor(() =>
      expect(mock.post).toHaveBeenCalledWith(
        '/staff/orders/partial/payments',
        { amount: 10000, method: 'CASH', expectedVersion: 2 },
        {
          headers: { 'Idempotency-Key': expect.any(String), 'X-Payment-Claim': expect.any(String) },
        },
      ),
    );
    await screen.findByText('Đã ghi nhận khoản thu; đơn vẫn chờ thanh toán đủ');
  });
  it('does not open a collection dialog or send money when another employee holds the table', async () => {
    mock.get.mockResolvedValue(
      response({
        items: [
          {
            _id: 'locked',
            code: 'MC3',
            tableSessionId: 's3',
            tableName: 'Bàn 03',
            total: 35000,
            version: 0,
            items: [],
          },
        ],
      }),
    );
    mock.post.mockRejectedValue(new Error('Bàn đang được nhân viên khác thu tiền'));
    mount(<AwaitingPayments />);
    fireEvent.click(await screen.findByRole('button', { name: 'Kiểm tra & nhận tiền' }));
    await screen.findByText('Chưa nhận được quyền thu tiền');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mock.post.mock.calls.every((call) => String(call[0]).endsWith('/payment-claim'))).toBe(
      true,
    );
  });
  it('rotates after 60 seconds, hides expired QR when offline and never joins on behalf of the display', async () => {
    vi.useFakeTimers();
    window.history.replaceState(null, '', '/display#display-secret');
    mock.qr.mockResolvedValue('data:image/png;base64,aW1hZ2U=');
    mock.get
      .mockResolvedValueOnce(
        response({
          tableId: 't1',
          tableName: 'Bàn 01',
          url: 'https://cafe.test/t/short-ticket',
          serverTime: 1000,
          expiresAt: 61000,
        }),
      )
      .mockRejectedValue(new Error('Mất mạng'));
    mount(<TableDisplayPage />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByAltText('QR vào Bàn 01')).toBeTruthy();
    expect(mock.get).toHaveBeenCalledWith('/table-displays/qr', {
      headers: { 'X-Table-Display-Token': 'display-secret' },
    });
    expect(mock.qr).toHaveBeenCalledWith('https://cafe.test/t/short-ticket', expect.anything());
    expect(screen.getByRole('link', { name: 'Mở link vào bàn' }).getAttribute('href')).toBe(
      'https://cafe.test/t/short-ticket',
    );
    expect((screen.getByRole('textbox', { name: 'Link vào bàn' }) as HTMLInputElement).value).toBe(
      'https://cafe.test/t/short-ticket',
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Mở link vào bàn' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Link vào bàn' })).toBeNull();
    expect(screen.getByText('Mất mạng')).toBeTruthy();
    expect(mock.post).not.toHaveBeenCalled();
  });
  it('confirms exactly one order amount and reuses its key after a network failure', async () => {
    const order = {
      _id: 'o1',
      code: 'MC1',
      tableName: 'Bàn 01',
      tableSessionId: 's1',
      total: 35000,
      version: 0,
      status: 'AWAITING_PAYMENT',
      paymentStatus: 'UNPAID',
      items: [{ quantity: 1, nameSnapshot: 'Cà phê', sizeName: 'S', lineTotal: 35000 }],
    };
    mock.get.mockResolvedValue(response({ items: [order] }));
    let received = 0;
    mock.post.mockImplementation(async (url: string) => {
      if (url.endsWith('/payment-claim'))
        return response({ expiresAt: new Date(Date.now() + 120000).toISOString(), version: 1 });
      if (url.endsWith('/payments') && received++ === 0) throw new Error('Mất kết nối');
      return response({ replayed: false });
    });
    mount(<AwaitingPayments />);
    fireEvent.click(await screen.findByRole('button', { name: 'Kiểm tra & nhận tiền' }));
    const confirm = await screen.findByRole('button', { name: 'Đã nhận đủ tiền — chuyển KDS' });
    expect(
      mock.post.mock.calls.filter((call) => String(call[0]).endsWith('/payments')),
    ).toHaveLength(0);
    fireEvent.click(confirm);
    await screen.findByText('Mất kết nối');
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại cùng khoản thu' }));
    await waitFor(() =>
      expect(
        mock.post.mock.calls.filter((call) => String(call[0]).endsWith('/payments')),
      ).toHaveLength(2),
    );
    const attempts = mock.post.mock.calls.filter((call) => String(call[0]).endsWith('/payments'));
    expect(attempts[0]).toEqual(attempts[1]);
    expect(attempts[0]).toEqual([
      '/staff/orders/o1/payments',
      { amount: 35000, method: 'CASH', expectedVersion: 0 },
      { headers: { 'Idempotency-Key': expect.any(String), 'X-Payment-Claim': expect.any(String) } },
    ]);
  });
  it('does not offer closure while a prepaid order is still being prepared', async () => {
    const table = { _id: 't1', name: 'Bàn 01', code: 'B01', capacity: 4, isActive: true };
    mock.get.mockImplementation(async (url: string) => {
      if (url === '/staff/awaiting-payments' || url === '/staff/orders') return response({ items: [] });
      if (url === '/staff/tables') return response({ tables: [table] });
      if (url === '/staff/table-sessions')
        return response({
          items: [{ session: { _id: 's1', status: 'OPEN', version: 2 }, table, orderCount: 1 }],
        });
      return response({
        total: 0,
        paidAmount: 35000,
        orders: [
          { _id: 'o1', status: 'PREPARING', paymentStatus: 'PAID', total: 35000, items: [] },
        ],
      });
    });
    mount(<StaffTables />);
    await screen.findByText(/Còn đơn chưa phục vụ/);
    expect(screen.queryByRole('button', { name: 'Đóng phiên không còn nợ' })).toBeNull();
    expect(mock.patch).not.toHaveBeenCalled();
  });
  it('closes a fully served prepaid session without collecting money again and retains its bill', async () => {
    let closed = false;
    const table = { _id: 't1', name: 'Bàn 01', code: 'B01', capacity: 4, isActive: true };
    const orders = [
      {
        _id: 'o1',
        code: 'MC1',
        status: 'SERVED',
        paymentStatus: 'PAID',
        total: 35000,
        items: [{ nameSnapshot: 'Espresso', quantity: 1, lineTotal: 35000 }],
      },
    ];
    mock.get.mockImplementation(async (url: string) => {
      if (url === '/staff/awaiting-payments' || url === '/staff/orders') return response({ items: [] });
      if (url === '/staff/tables') return response({ tables: [table] });
      if (url === '/staff/table-sessions')
        return response({
          items: closed
            ? []
            : [{ session: { _id: 's1', status: 'OPEN', version: 2 }, table, orderCount: 1 }],
        });
      return response({
        tableCode: 'B01',
        status: closed ? 'CLOSED' : 'OPEN',
        closedAt: closed ? '2026-10-12T08:00:00.000Z' : null,
        total: closed ? 35000 : 0,
        paidAmount: 35000,
        orders,
      });
    });
    mock.patch.mockImplementation(async () => {
      closed = true;
      qc.setQueryData(['staff-table-sessions'], { items: [] });
      return response({ billId: 'b1' });
    });
    const qc = mount(<StaffTables />);
    fireEvent.click(await screen.findByRole('button', { name: 'Đóng phiên không còn nợ' }));
    await screen.findByRole('dialog', { name: 'Hóa đơn đã thanh toán' });
    await screen.findByRole('button', { name: 'In hóa đơn' });
    expect(screen.getByText(/Espresso/)).toBeTruthy();
    expect(mock.patch).toHaveBeenCalledWith('/staff/table-sessions/s1/status', {
      status: 'CLOSED',
      expectedVersion: 2,
    });
    expect(mock.post).not.toHaveBeenCalled();
  });
});
