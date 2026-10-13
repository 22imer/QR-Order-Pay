// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../components/ui/Toast';
import { StaffTables } from '../features/staff/Tables';

const mock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  api: mock,
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
const response = (data: unknown) => ({ data: { success: true, data } });

describe('staff printing after payment', () => {
  it.each([false, true])(
    'keeps the whole-table bill after the session disappears (read failure: %s)',
    async (failBillRead) => {
      let paid = false;
      let failRead = failBillRead;
      const table = { _id: 't1', code: 'B01', name: 'Bàn 01', capacity: 4, isActive: true };
      const orders = ['Cà phê', 'Trà đào'].map((name, i) => ({
        _id: `o${i}`,
        code: `MC${i}`,
        total: 35000,
        status: 'SERVED',
        paymentStatus: 'UNPAID',
        participantId: `guest${i}`,
        items: [{ nameSnapshot: name, quantity: 1, lineTotal: 35000 }],
      }));
      mock.get.mockImplementation(async (url: string) => {
        if (url === '/staff/awaiting-payments') return response({ items: [] });
        if (url === '/staff/tables') return response({ tables: [table] });
        if (url === '/staff/table-sessions')
          return response({
            items: paid
              ? []
              : [
                  {
                    session: { _id: 's1', status: 'CHECKOUT', version: 3 },
                    table,
                    orderCount: 2,
                  },
                ],
          });
        if (paid && failRead) throw new Error('Tải hóa đơn thất bại');
        return response({
          tableCode: 'B01',
          status: paid ? 'CLOSED' : 'CHECKOUT',
          closedAt: paid ? '2026-09-27T08:00:00.000Z' : null,
          total: 70000,
          paidAmount: paid ? 70000 : 0,
          orders,
        });
      });
      mock.post.mockImplementation(async (url: string) => {
        if (url.endsWith('/payment-claim'))
          return response({ expiresAt: new Date(Date.now() + 120000).toISOString(), version: 4 });
        if (url.endsWith('/release')) return response({});
        paid = true;
        // Realtime may remove the session card before the HTTP response arrives.
        qc.setQueryData(['staff-table-sessions'], { items: [] });
        await new Promise((resolve) => setTimeout(resolve, 20));
        return response({ billId: 'b1' });
      });
      const print = vi.spyOn(window, 'print').mockImplementation(() => {});
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={qc}>
          <ToastProvider>
            <StaffTables />
          </ToastProvider>
        </QueryClientProvider>,
      );
      const checkout = await screen.findByRole(
        'button',
        { name: 'Kiểm tra & thu tiền' },
        { timeout: 5000 },
      );
      await waitFor(() => expect((checkout as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(checkout);
      fireEvent.click(await screen.findByRole('button', { name: 'Đã nhận đủ tiền — đóng phiên' }));
      const dialog = await screen.findByRole('dialog', { name: 'Hóa đơn đã thanh toán' });
      if (failBillRead) {
        await within(dialog).findByText('Thanh toán đã thành công. Hãy tải lại hóa đơn để in.');
        expect(within(dialog).queryByRole('button', { name: 'In hóa đơn' })).toBeNull();
        failRead = false;
        fireEvent.click(within(dialog).getByRole('button', { name: 'Thử lại' }));
      }
      const button = await within(dialog).findByRole('button', { name: 'In hóa đơn' });
      expect(within(dialog).getByText(/Cà phê/)).toBeTruthy();
      expect(within(dialog).getByText(/Trà đào/)).toBeTruthy();
      expect(within(dialog).getByText('Tổng đã thanh toán')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Kiểm tra & thu tiền' })).toBeNull();
      fireEvent.click(button);
      expect(print).toHaveBeenCalledTimes(1);
      fireEvent.click(within(dialog).getByRole('button', { name: 'Đóng' }));
      fireEvent.click(screen.getByRole('button', { name: /In hóa đơn vừa thanh toán/ }));
      await screen.findByRole('button', { name: 'In hóa đơn' });
      expect(
        mock.post.mock.calls.filter((call) => String(call[0]).endsWith('/payments')),
      ).toHaveLength(1);
      qc.clear();
    },
  );
});
