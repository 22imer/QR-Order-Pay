// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { InsightsReport } from '@may-cafe/contracts';
import { SmartInsights } from '../features/insights/SmartInsights';
import { CompanionSuggestions } from '../features/insights/CompanionSuggestions';
import { AdminInventory } from '../features/admin/Inventory';
import { ToastProvider } from '../components/ui/Toast';
const mock = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  api: mock,
}));
vi.mock('../features/guest/guestContext', () => ({
  useGuestContext: () => ({ tableName: 'Bàn 1' }),
}));
const response = (data: unknown) => ({ data: { success: true, data } });
const a = '507f1f77bcf86cd799439011',
  b = '507f1f77bcf86cd799439012';
const product = {
  _id: b,
  name: 'Bánh B',
  description: '',
  image: '/favicon.svg',
  basePrice: 39000,
  variants: [],
  allowedOptions: { sizes: [], sugarLevels: ['0%'], iceLevels: ['no-ice'], toppingIds: [] },
  toppingIds: [],
  tags: [],
  isAvailable: true,
};
const report: InsightsReport = {
  from: '2026-10-01',
  to: '2026-10-22',
  channel: 'ALL',
  generatedAt: '2026-10-23T10:00:00Z',
  sample: {
    orders: 0,
    activeDays: 0,
    patternOrders: 0,
    capped: false,
    limit: 2000,
    skippedLargeBaskets: 0,
    minimumOrders: 20,
    minimumPairOrders: 5,
  },
  summary: { orderValue: 0, cups: 0, averageOrderValue: 0 },
  comparison: {
    from: '2026-09-09',
    to: '2026-09-30',
    orders: 0,
    capped: false,
    orderChangePct: null,
  },
  hours: Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0, cups: 0 })),
  topProducts: [],
  pairs: [],
  margins: {
    totalVariants: 1,
    completeVariants: 0,
    items: [
      {
        productId: a,
        variantId: null,
        name: 'Trà A',
        size: null,
        price: 30000,
        ingredientCost: null,
        grossMargin: null,
        marginPct: null,
        missing: ['Trà nguyên liệu'],
      },
    ],
  },
  advice: [{ code: 'LOW_SAMPLE', text: 'Chưa đủ dữ liệu để kết luận xu hướng.' }],
};
let qc: QueryClient;
function wrap(node: JSX.Element) {
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ToastProvider>{node}</ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}
function mount(node: JSX.Element) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(wrap(node));
}
beforeEach(() => {
  mock.get.mockImplementation(async (url: string) =>
    response(
      url === '/admin/insights'
        ? report
        : url === '/categories'
          ? { products: [product], toppings: [] }
          : {
              items: [{ productId: b, name: product.name, image: product.image, unitPrice: 30000 }],
            },
    ),
  );
  mock.patch.mockResolvedValue(response({}));
});
afterEach(() => {
  cleanup();
  qc.clear();
  vi.resetAllMocks();
});
describe('Smart Insights admin', () => {
  it('shows missing cost honestly, scope/basis and no conclusions on empty sales', async () => {
    mount(<SmartInsights />);
    expect(await screen.findByText('Chưa có đơn hoàn tất phù hợp trong kỳ này.')).toBeTruthy();
    expect(screen.getByText('Chưa đủ giá vốn')).toBeTruthy();
    expect(screen.getByText(/Chưa có cặp đạt ngưỡng/)).toBeTruthy();
    expect(screen.getByText(/không phải lợi nhuận đơn cũ/)).toBeTruthy();
    expect(mock.get.mock.calls.every((c) => c[0] === '/admin/insights')).toBe(true);
  });
  it('applies dates/channel explicitly and prevents an invalid range request', async () => {
    mount(<SmartInsights />);
    await screen.findByText('Chưa đủ giá vốn');
    fireEvent.change(screen.getByLabelText('Insights từ ngày'), {
      target: { value: '2026-10-01' },
    });
    fireEvent.change(screen.getByLabelText('Insights đến ngày'), {
      target: { value: '2026-10-22' },
    });
    fireEvent.change(screen.getByLabelText('Kênh Insights'), { target: { value: 'PICKUP' } });
    expect(mock.get).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Xem phân tích' }));
    await waitFor(() => expect(mock.get).toHaveBeenCalledTimes(2));
    expect(mock.get.mock.calls[1]?.[1].params).toEqual({
      from: '2026-10-01',
      to: '2026-10-22',
      channel: 'PICKUP',
    });
    fireEvent.change(screen.getByLabelText('Insights từ ngày'), {
      target: { value: '2026-01-01' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Xem phân tích' }));
    expect((await screen.findByRole('alert')).textContent).toContain('1 đến 93');
    expect(mock.get).toHaveBeenCalledTimes(2);
  });
  it('handles load errors and retries without inventing values', async () => {
    mock.get.mockRejectedValueOnce(new Error('Không kết nối'));
    mount(<SmartInsights />);
    expect((await screen.findByRole('alert')).textContent).toContain('Không kết nối');
    expect(screen.queryByText('Chưa đủ giá vốn')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Chưa đủ giá vốn')).toBeTruthy();
  });
  it('persists per-base-unit cost and allows clearing unknown instead of silently treating it as zero', async () => {
    mock.get.mockResolvedValue(
      response({
        ingredients: [
          {
            id: a,
            code: 'TEA',
            name: 'Trà',
            unit: 'g',
            onHand: 10,
            reserved: 0,
            available: 10,
            lowStockThreshold: 0,
            isActive: true,
            isLowStock: false,
            version: 4,
            unitCost: null,
          },
        ],
        recipes: [],
        products: [],
        toppings: [],
      }),
    );
    mount(<AdminInventory />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa' }));
    fireEvent.change(screen.getByLabelText('Giá vốn nguyên liệu'), { target: { value: '12.345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu nguyên liệu' }));
    await waitFor(() => expect(mock.patch).toHaveBeenCalledOnce());
    expect(mock.patch.mock.calls[0]?.[1]).toMatchObject({ expectedVersion: 4, unitCost: 12.345 });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Sửa' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu nguyên liệu' }));
    await waitFor(() => expect(mock.patch).toHaveBeenCalledTimes(2));
    expect(mock.patch.mock.calls[1]?.[1].unitCost).toBeNull();
  });
});
describe('customer companion suggestions', () => {
  it('does not request an empty or Freestyle-only basket and hides data gaps', async () => {
    mount(
      <CompanionSuggestions
        items={[{ productId: a, freestyleToken: 'signed' }]}
        context="TABLE"
        onAdd={vi.fn()}
      />,
    );
    expect(mock.get).not.toHaveBeenCalled();
    expect(screen.queryByText('Khách thường gọi kèm')).toBeNull();
  });
  it('opens a fresh product configuration and only adds after explicit confirmation, using current price', async () => {
    const onAdd = vi.fn();
    mount(<CompanionSuggestions items={[{ productId: a }]} context="PICKUP" onAdd={onAdd} />);
    const button = await screen.findByRole('button', { name: /Chọn Bánh B/ });
    expect(onAdd).not.toHaveBeenCalled();
    fireEvent.click(button);
    const add = await screen.findByRole('button', { name: /Thêm vào giỏ/ });
    expect(onAdd).not.toHaveBeenCalled();
    fireEvent.click(add);
    expect(onAdd).toHaveBeenCalledOnce();
    expect(onAdd.mock.calls[0]?.[0]).toMatchObject({ productId: b, unitPrice: 39000 });
    expect(mock.get.mock.calls[0]?.[1].params.context).toBe('PICKUP');
  });
  it('excludes products already in the basket and makes no automatic substitution', async () => {
    mount(
      <CompanionSuggestions
        items={[{ productId: a }, { productId: b }]}
        context="TABLE"
        onAdd={vi.fn()}
      />,
    );
    await waitFor(() => expect(mock.get).toHaveBeenCalledOnce());
    expect(screen.queryByText('Khách thường gọi kèm')).toBeNull();
  });
  it('rejects a suggestion that has sold out before selection', async () => {
    mock.get.mockImplementation(async (url: string) =>
      response(
        url === '/categories'
          ? { products: [], toppings: [] }
          : { items: [{ productId: b, name: 'Bánh B', unitPrice: 30000 }] },
      ),
    );
    const onAdd = vi.fn();
    mount(<CompanionSuggestions items={[{ productId: a }]} context="TABLE" onAdd={onAdd} />);
    fireEvent.click(await screen.findByRole('button', { name: /Chọn Bánh B/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('Món vừa hết');
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('discards late catalog responses when checkout becomes locked', async () => {
    let resolve!: (value: unknown) => void;
    mock.get.mockImplementation(async (url: string) =>
      url === '/categories'
        ? new Promise((r) => {
            resolve = r;
          })
        : response({ items: [{ productId: b, name: 'Bánh B', unitPrice: 30000 }] }),
    );
    const onAdd = vi.fn(),
      view = mount(
        <CompanionSuggestions items={[{ productId: a }]} context="TABLE" onAdd={onAdd} />,
      );
    fireEvent.click(await screen.findByRole('button', { name: /Chọn Bánh B/ }));
    await act(async () => {
      view.rerender(
        wrap(
          <CompanionSuggestions
            items={[{ productId: a }]}
            context="TABLE"
            disabled
            onAdd={onAdd}
          />,
        ),
      );
    });
    await act(async () => {
      resolve(response({ products: [product], toppings: [] }));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onAdd).not.toHaveBeenCalled();
  });
});
