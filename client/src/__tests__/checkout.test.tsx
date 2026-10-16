// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui/Toast';
import { StaffTables } from '../features/staff/Tables';
import { ReceiptPage } from '../features/guest/ReceiptPage';
import { CartPage } from '../features/guest/CartPage';
import { AdminReviews } from '../features/admin/Reviews';
import { useCart } from '../store/cart';

const mock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  api: mock,
}));
function mount(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>{ui}</ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
const response = (data: unknown) => ({ data: { success: true, data } });
beforeEach(() => {
  vi.clearAllMocks();
  useCart.getState().resetSession();
});
afterEach(cleanup);

describe('checkout interfaces', () => {
  function addCartItem() {
    useCart.getState().setSession('s1', 'g1');
    useCart.getState().add({
      productId: 'p1',
      variantId: 'v1',
      sizeName: 'S',
      sugarLevel: '50%',
      iceLevel: 'normal-ice',
      toppingIds: [],
      note: '',
      quantity: 1,
      unitPrice: 35000,
      name: 'Cà phê',
      variantName: 'S',
      image: '',
    });
    mock.get.mockResolvedValue(response({ active: true, status: 'OPEN' }));
  }

  it('checks and sends with one click, locking the cart throughout the quote request', async () => {
    addCartItem();
    let finishQuote!: (value: unknown) => void;
    mock.post.mockImplementation((url: string) => {
      if (url === '/orders/quote')
        return new Promise((resolve) => {
          finishQuote = resolve;
        });
      return Promise.resolve(response({ order: { code: 'MC1' } }));
    });
    const qc = mount(<CartPage />);
    const submit = screen.getByRole('button', { name: 'Đặt món' });
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(submit);
    await waitFor(() => expect(finishQuote).toBeTypeOf('function'));
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Xoá món' }).closest('fieldset')?.disabled).toBe(
      true,
    );
    fireEvent.click(submit);
    finishQuote(response({ quoteToken: 'signed-quote', total: 35000 }));
    await waitFor(() => expect(useCart.getState().items).toHaveLength(0));
    expect(mock.post.mock.calls.map((call) => call[0])).toEqual(['/orders/quote', '/orders']);
    expect(mock.post).toHaveBeenLastCalledWith(
      '/orders',
      expect.objectContaining({ quoteToken: 'signed-quote' }),
      expect.anything(),
    );
    qc.clear();
  });

  it('asks for consent only when the quoted price changes', async () => {
    addCartItem();
    mock.post.mockImplementation(async (url: string) =>
      response(url === '/orders/quote' ? { quoteToken: 'new-price-quote', total: 40000 } : {}),
    );
    const qc = mount(<CartPage />);
    const submit = screen.getByRole('button', { name: 'Đặt món' });
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(submit);
    await screen.findByRole('alert');
    expect(mock.post.mock.calls.map((call) => call[0])).toEqual(['/orders/quote']);
    expect(useCart.getState().items).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /Đặt món ·/ }));
    await waitFor(() => expect(useCart.getState().items).toHaveLength(0));
    expect(mock.post.mock.calls.map((call) => call[0])).toEqual(['/orders/quote', '/orders']);
    qc.clear();
  });

  it('keeps the cart and does not send an order when availability validation fails', async () => {
    addCartItem();
    mock.post.mockRejectedValue(new Error('Món đã hết'));
    const qc = mount(<CartPage />);
    const submit = screen.getByRole('button', { name: 'Đặt món' });
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(submit);
    await waitFor(() => expect(mock.post).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    expect(mock.post.mock.calls[0]![0]).toBe('/orders/quote');
    expect(useCart.getState().items).toHaveLength(1);
    qc.clear();
  });

  it('shows empty tables waiting for a guest QR instead of letting staff open a session', async () => {
    mock.get.mockImplementation(async (url: string) => {
      if (url === '/staff/awaiting-payments') return response({ items: [] });
      if (url === '/staff/tables')
        return response({ tables: [{ _id: 't1', name: 'Bàn 01', capacity: 4, isActive: true }] });
      return response({ items: [] });
    });

    const qc = mount(<StaffTables />);
    expect(await screen.findByText('Chờ khách quét QR')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Mở phiên/ })).toBeNull();
    expect(mock.post).not.toHaveBeenCalled();
    qc.clear();
  });

  it('requires explicit confirmation and sends the actual bill amount and payment method', async () => {
    mock.get.mockImplementation(async (url: string) => {
      if (url === '/staff/awaiting-payments') return response({ items: [] });
      if (url === '/staff/tables')
        return response({ tables: [{ _id: 't1', name: 'Bàn 01', isActive: true }] });
      if (url === '/staff/table-sessions')
        return response({
          items: [
            {
              session: { _id: 's1', status: 'CHECKOUT', version: 3 },
              table: { _id: 't1', name: 'Bàn 01' },
              orderCount: 1,
            },
          ],
        });
      return response({
        total: 70000,
        paidAmount: 0,
        orders: [
          {
            _id: 'o1',
            code: 'MC1',
            status: 'SERVED',
            paymentStatus: 'UNPAID',
            total: 70000,
            items: [{ nameSnapshot: 'Cà phê', quantity: 2, lineTotal: 70000 }],
          },
        ],
      });
    });
    mock.post.mockResolvedValue(
      response({ expiresAt: new Date(Date.now() + 120000).toISOString(), version: 4 }),
    );
    const qc = mount(<StaffTables />);
    const inspect = await screen.findByRole('button', { name: 'Kiểm tra & thu tiền' });
    await waitFor(() => expect((inspect as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(inspect);
    await screen.findByRole('dialog', { name: 'Thanh toán · Bàn 01' });
    expect(
      mock.post.mock.calls.filter((call) => String(call[0]).endsWith('/payments')),
    ).toHaveLength(0);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'BANK_TRANSFER' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đã nhận đủ tiền — đóng phiên' }));
    await waitFor(() =>
      expect(mock.post).toHaveBeenCalledWith(
        '/staff/table-sessions/s1/payments',
        { amount: 70000, method: 'BANK_TRANSFER', expectedVersion: 4 },
        {
          headers: { 'Idempotency-Key': expect.any(String), 'X-Payment-Claim': expect.any(String) },
        },
      ),
    );
    qc.clear();
  });

  it('submits a post-payment review through the limited receipt endpoint', async () => {
    mock.get.mockResolvedValue(
      response({
        source: 'BILL_SNAPSHOT',
        tableName: 'Bàn 01',
        total: 35000,
        closedAt: new Date().toISOString(),
        orders: [
          {
            _id: 'o1',
            code: 'MC1',
            total: 35000,
            status: 'SERVED',
            paymentStatus: 'PAID',
            participantId: 'g1',
            createdAt: new Date().toISOString(),
            items: [],
            review: null,
          },
        ],
      }),
    );
    mock.post.mockResolvedValue(response({ review: { rating: 4 } }));
    const qc = mount(<ReceiptPage />);
    await screen.findByText('Hóa đơn của bạn');
    expect(screen.queryByRole('button', { name: 'In hóa đơn' })).toBeNull();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '4' } });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Đồ uống ngon' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi đánh giá' }));
    await waitFor(() =>
      expect(mock.post).toHaveBeenCalledWith('/receipts/orders/o1/review', {
        rating: 4,
        comment: 'Đồ uống ngon',
      }),
    );
    qc.clear();
  });

  it('reuses the order idempotency key when a network failure is retried', async () => {
    useCart.getState().setSession('s1', 'g1');
    useCart.getState().add({
      productId: 'p1',
      variantId: 'v1',
      sizeName: 'S',
      sugarLevel: '50%',
      iceLevel: 'normal-ice',
      toppingIds: [],
      note: '',
      quantity: 1,
      unitPrice: 35000,
      name: 'Cà phê',
      variantName: 'S',
      image: '',
    });
    mock.get.mockResolvedValue(response({ active: true, status: 'OPEN' }));
    mock.post.mockImplementation(async (url: string) => {
      if (url === '/orders/quote')
        return response({
          quoteId: 'q1',
          quoteToken: 'signed-quote-token-value',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          total: 35000,
          items: [],
        });
      throw new Error('Network disconnected');
    });
    const qc = mount(<CartPage />);
    const submit = screen.getByRole('button', { name: 'Đặt món' });
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(submit);
    await waitFor(() =>
      expect(mock.post.mock.calls.filter((call) => call[0] === '/orders')).toHaveLength(1),
    );
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(submit);
    await waitFor(() =>
      expect(mock.post.mock.calls.filter((call) => call[0] === '/orders')).toHaveLength(2),
    );
    const orderCalls = mock.post.mock.calls.filter((call) => call[0] === '/orders');
    expect(orderCalls[0]![2]).toEqual(orderCalls[1]![2]);
    qc.clear();
  });

  it.each([
    { code: 'CONFLICT', status: 409, sameKey: true },
    { code: 'IDEMPOTENCY_CONFLICT', status: 409, sameKey: false },
  ])('keeps the order key after $code only when the order may exist', async (scenario) => {
    useCart.getState().setSession('s1', 'g1');
    useCart.getState().add({
      productId: 'p1',
      variantId: 'v1',
      sizeName: 'S',
      sugarLevel: '50%',
      iceLevel: 'normal-ice',
      toppingIds: [],
      note: '',
      quantity: 1,
      unitPrice: 35000,
      name: 'Cà phê',
      variantName: 'S',
      image: '',
    });
    mock.get.mockResolvedValue(response({ active: true, status: 'OPEN' }));
    const failure = Object.assign(new Error('Request failed'), {
      isAxiosError: true,
      response: {
        status: scenario.status,
        data: { success: false, error: { code: scenario.code, message: 'Lỗi' } },
      },
    });
    mock.post.mockImplementation(async (url: string) => {
      if (url === '/orders/quote')
        return response({
          quoteId: 'q1',
          quoteToken: 'signed-quote-token-value',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          total: 35000,
          items: [],
        });
      throw failure;
    });
    const qc = mount(<CartPage />);
    const submit = screen.getByRole('button', { name: 'Đặt món' });
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(submit);
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(submit);
    await waitFor(() =>
      expect(mock.post.mock.calls.filter((call) => call[0] === '/orders')).toHaveLength(2),
    );
    const [first, second] = mock.post.mock.calls.filter((call) => call[0] === '/orders');
    const key = (call: unknown[]) =>
      (call[2] as { headers: Record<string, string> }).headers['Idempotency-Key'];
    expect(key(first!) === key(second!)).toBe(scenario.sameKey);
    qc.clear();
  });

  it('shows review statistics and applies the selected star filter', async () => {
    mock.get.mockResolvedValue(
      response({
        total: 2,
        page: 1,
        limit: 20,
        averageRating: 4.5,
        distribution: [
          { rating: 1, count: 0 },
          { rating: 2, count: 0 },
          { rating: 3, count: 0 },
          { rating: 4, count: 1 },
          { rating: 5, count: 1 },
        ],
        items: [
          {
            _id: 'r1',
            rating: 5,
            comment: 'Rất ngon',
            createdAt: '2026-09-16T08:00:00.000Z',
            orderCode: 'MC1',
            orderTotal: 35000,
            tableName: 'Bàn 01',
          },
        ],
      }),
    );
    const qc = mount(<AdminReviews />);
    await screen.findByText('Đánh giá khách hàng');
    expect(screen.getByText('4.5')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lọc' }));
    await waitFor(() =>
      expect(mock.get).toHaveBeenLastCalledWith('/admin/reviews?rating=5&page=1'),
    );
    qc.clear();
  });
});
