// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { OrderReview } from '@may-cafe/contracts';
import { ToastProvider } from '../components/ui/Toast';
import { OrdersPage } from '../features/guest/OrdersPage';
import { ReceiptPage } from '../features/guest/ReceiptPage';

const mock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  api: mock,
}));
const response = (data: unknown) => ({ data: { success: true, data } });
const clients: QueryClient[] = [];
function mount(ui = <OrdersPage />) {
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
function order(
  id: string,
  status = 'SERVED',
  paymentStatus = 'PAID',
  review: OrderReview | null = null,
) {
  return {
    _id: id,
    code: id,
    items: [],
    total: 35000,
    status,
    paymentStatus,
    review,
    participantId: 'g1',
    createdAt: '2026-10-13T07:00:00.000Z',
    statusHistory: [],
  };
}
afterEach(() => {
  cleanup();
  for (const qc of clients.splice(0)) qc.clear();
  vi.resetAllMocks();
});

describe('reviews per completed order while the table remains open', () => {
  it('offers reviews only for served paid orders and displays saved reviews instead of a second form', async () => {
    mock.get.mockResolvedValue(
      response({
        orders: [
          order('waiting', 'AWAITING_PAYMENT', 'UNPAID'),
          order('pending', 'PENDING'),
          order('preparing', 'PREPARING'),
          order('unpaid', 'SERVED', 'UNPAID'),
          order('cancelled', 'CANCELLED', 'REFUNDED'),
          order('eligible'),
          order('reviewed', 'SERVED', 'PAID', {
            rating: 4,
            comment: 'Ngon',
            createdAt: '2026-10-13T07:01:00.000Z',
          }),
        ],
      }),
    );
    mount();
    await screen.findByText('Bạn đã đánh giá 4/5 sao');
    expect(screen.getAllByRole('button', { name: 'Đánh giá đơn' })).toHaveLength(1);
    expect(screen.getByText('“Ngon”')).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(mock.post).not.toHaveBeenCalled();
  });
  it('reviews A, then reviews a new B in the same visit without leaving or closing the table', async () => {
    const orders = [order('A')];
    mock.get.mockImplementation(async () => response({ orders: structuredClone(orders) }));
    mock.post.mockImplementation(
      async (url: string, payload: { rating: number; comment: string }) => {
        const target = orders.find((item) => url === `/orders/${item._id}/review`)!;
        target.review = { ...payload, createdAt: '2026-10-13T07:01:00.000Z' };
        return response({ review: target.review });
      },
    );
    const qc = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Đánh giá đơn' }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '4' } });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Đơn A ngon' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi đánh giá' }));
    await screen.findByText('Bạn đã đánh giá 4/5 sao');
    expect(screen.queryByRole('dialog')).toBeNull();
    orders.push(order('B'));
    await qc.invalidateQueries({ queryKey: ['my-orders'] });
    fireEvent.click(await screen.findByRole('button', { name: 'Đánh giá đơn' }));
    expect(screen.getByRole('combobox', { name: 'Số sao cho đơn B' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Gửi đánh giá' }));
    await screen.findByText('Bạn đã đánh giá 5/5 sao');
    expect(screen.getByText('Bạn đã đánh giá 4/5 sao')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Đánh giá đơn' })).toBeNull();
    expect(mock.post.mock.calls).toEqual([
      ['/orders/A/review', { rating: 4, comment: 'Đơn A ngon' }],
      ['/orders/B/review', { rating: 5, comment: '' }],
    ]);
    await qc.invalidateQueries({ queryKey: ['my-orders'] });
    expect(screen.getByText('Bạn đã đánh giá 4/5 sao')).toBeTruthy();
  });
  it('keeps the review form and comment after an error, allowing a retry', async () => {
    mock.get.mockResolvedValue(response({ orders: [order('A')] }));
    mock.post
      .mockRejectedValueOnce(new Error('Mất kết nối'))
      .mockResolvedValue(response({ review: { rating: 5 } }));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Đánh giá đơn' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Rất ngon' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi đánh giá' }));
    await screen.findByText('Mất kết nối');
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Rất ngon');
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Gửi đánh giá' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Gửi đánh giá' }));
    await waitFor(() => expect(mock.post).toHaveBeenCalledTimes(2));
    expect(mock.post.mock.calls[1]).toEqual(mock.post.mock.calls[0]);
  });
  it('retains the earlier review on the closed receipt and offers the missing review on another order', async () => {
    mock.get.mockResolvedValue(
      response({
        source: 'BILL_SNAPSHOT',
        tableName: 'Bàn 01',
        total: 70000,
        closedAt: '2026-10-13T08:00:00.000Z',
        orders: [
          order('A', 'SERVED', 'PAID', {
            rating: 4,
            comment: 'Đã đánh giá trước',
            createdAt: '2026-10-13T07:01:00.000Z',
          }),
          order('B'),
        ],
      }),
    );
    mock.post.mockResolvedValue(response({ review: { rating: 5 } }));
    mount(<ReceiptPage />);
    await screen.findByText('Bạn đã đánh giá 4/5 sao');
    expect(screen.getAllByRole('button', { name: 'Gửi đánh giá' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Gửi đánh giá' }));
    await waitFor(() =>
      expect(mock.post).toHaveBeenCalledWith('/receipts/orders/B/review', {
        rating: 5,
        comment: '',
      }),
    );
  });
});
