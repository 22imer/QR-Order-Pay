// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { AdminInventory } from '../features/admin/Inventory';
import { ToastProvider } from '../components/ui/Toast';

const mock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn() }));
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  api: mock,
}));
const ingredientId = '111111111111111111111111';
const productId = '222222222222222222222222';
const variantId = '333333333333333333333333';
const clients: QueryClient[] = [];
const response = (data: unknown) => ({ data: { success: true, data } });
function mount() {
  mock.get.mockResolvedValue(
    response({
      ingredients: [
        {
          id: ingredientId,
          code: 'TEA',
          name: 'Trà khô',
          unit: 'g',
          onHand: 100,
          reserved: 20,
          available: 80,
          lowStockThreshold: 10,
          isLowStock: false,
          isActive: true,
          version: 7,
        },
      ],
      recipes: [],
      products: [
        {
          id: productId,
          name: 'Trà đào',
          isAvailable: true,
          effectiveAvailable: true,
          variants: [{ id: variantId, name: 'L', isAvailable: true, effectiveAvailable: true }],
        },
      ],
      toppings: [],
    }),
  );
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(qc);
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <AdminInventory />
      </ToastProvider>
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((q) => q.clear());
  vi.resetAllMocks();
});
describe('inventory management', () => {
  it('submits stock receipt with the observed version, reason and idempotency key', async () => {
    mock.post.mockResolvedValue(response({}));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Nhập / xuất / kiểm kê' }));
    fireEvent.change(screen.getByLabelText('Số lượng'), { target: { value: '12.5' } });
    fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: 'Nhập trà buổi sáng' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ghi nhận' }));
    await waitFor(() =>
      expect(mock.post).toHaveBeenCalledWith(
        `/admin/inventory/ingredients/${ingredientId}/movements`,
        expect.objectContaining({
          type: 'RECEIPT',
          quantity: 12.5,
          reason: 'Nhập trà buổi sáng',
          expectedVersion: 7,
          idempotencyKey: expect.any(String),
        }),
      ),
    );
  });
  it('keeps the same stock operation after network uncertainty instead of allowing a duplicate receipt', async () => {
    mock.post
      .mockRejectedValueOnce(new AxiosError('Network Error'))
      .mockResolvedValueOnce(response({}));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Nhập / xuất / kiểm kê' }));
    fireEvent.change(screen.getByLabelText('Số lượng'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: 'Nhập tồn đầu' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ghi nhận' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Thử lại cùng thao tác' }));
    await waitFor(() => expect(mock.post).toHaveBeenCalledTimes(2));
    expect(mock.post.mock.calls[0]).toEqual(mock.post.mock.calls[1]);
  });
  it('saves a base recipe and a complete size override', async () => {
    mock.put.mockResolvedValue(response({}));
    mount();
    fireEvent.click(await screen.findByRole('tab', { name: 'Công thức' }));
    fireEvent.change(screen.getByLabelText('Món hoặc topping'), {
      target: { value: `PRODUCT:${productId}` },
    });
    fireEvent.click(screen.getByLabelText('Áp dụng công thức và kiểm soát kho'));
    fireEvent.click(screen.getByRole('button', { name: 'Thêm dòng nguyên liệu' }));
    fireEvent.change(screen.getByLabelText('Nguyên liệu 1'), { target: { value: ingredientId } });
    fireEvent.change(screen.getByLabelText('Định lượng 1'), { target: { value: '10' } });
    fireEvent.click(screen.getByLabelText('Công thức riêng size L'));
    fireEvent.change(screen.getAllByLabelText('Định lượng 1')[1]!, { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu công thức' }));
    await waitFor(() =>
      expect(mock.put).toHaveBeenCalledWith(`/admin/inventory/recipes/PRODUCT/${productId}`, {
        enabled: true,
        components: [{ ingredientId, quantity: 10 }],
        variants: [{ variantId, components: [{ ingredientId, quantity: 15 }] }],
        expectedVersion: 0,
      }),
    );
  });
  it('loads paginated ledger only when the history tab is opened', async () => {
    mount();
    await screen.findByText('Trà khô');
    expect(mock.get).toHaveBeenCalledTimes(1);
    mock.get.mockResolvedValue(response({ items: [], total: 0, page: 1, limit: 30 }));
    fireEvent.click(screen.getByRole('tab', { name: 'Lịch sử kho' }));
    await screen.findByText('Chưa có biến động kho.');
    expect(mock.get).toHaveBeenCalledWith('/admin/inventory/movements', { params: { page: 1 } });
  });
});
