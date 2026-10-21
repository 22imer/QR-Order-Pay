// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../components/ui/Toast';
import { AIPage } from '../features/ai/AISheet';
import { PickupPage } from '../features/pickup/PickupPage';
import { ProductDetailModal } from '../features/guest/ProductDetailModal';
import { useCart } from '../store/cart';
const mock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  table: null as string | null,
  member: { id: 'a', name: 'Lan', phone: '0901234567', points: 0 } as {
    id: string;
    name: string;
    phone: string;
    points: number;
  } | null,
  memberError: false,
}));
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  api: mock,
}));
vi.mock('../features/guest/guestContext', () => ({
  useGuestContext: () => ({ tableName: mock.table }),
}));
vi.mock('../features/guest/useMember', () => ({
  useMember: () => ({
    data: { member: mock.member },
    isPending: false,
    isError: mock.memberError,
    error: new Error('Không kết nối được'),
  }),
}));
vi.mock('../features/auth/useAuth', () => ({
  useAuth: (selector: (s: { user: null }) => unknown) => selector({ user: null }),
}));
vi.mock('../lib/socket', () => ({ useSocketEvent: vi.fn() }));
const product = {
  _id: '507f1f77bcf86cd799439011',
  name: 'Trà AI',
  description: 'Trà thử',
  image: '',
  basePrice: 30000,
  variants: [],
  allowedOptions: { sizes: [], sugarLevels: ['0%'], iceLevels: ['normal-ice'], toppingIds: [] },
  toppingIds: [],
  tags: [],
  isAvailable: true,
};
const response = (data: unknown) => ({ data: { success: true, data } });
let qc: QueryClient;
function mount(path = '/ai') {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          <Routes>
            <Route path="/ai" element={<AIPage />} />
            <Route path="/pickup" element={<PickupPage />} />
            <Route
              path="/product"
              element={
                <ProductDetailModal
                  product={product}
                  toppings={[]}
                  onClose={() => undefined}
                  onAdded={() => undefined}
                />
              }
            />
            <Route path="/member" element={<p>Đăng nhập ở đây</p>} />
            <Route path="/t" element={<p>Quét QR tại bàn</p>} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  mock.table = null;
  mock.member = { id: 'a', name: 'Lan', phone: '0901234567', points: 0 };
  mock.memberError = false;
  sessionStorage.clear();
  useCart.getState().clear();
  mock.get.mockImplementation(async (url: string) =>
    response(
      url === '/categories' ? { products: [product], toppings: [] } : { items: [], total: 0 },
    ),
  );
  mock.post.mockImplementation(async (url: string) =>
    response(
      url.endsWith('/validate')
        ? { valid: true, total: 30000, violations: [] }
        : {
            mode: 'fallback',
            message: 'Gợi ý trà',
            recommendations: [
              {
                productId: product._id,
                variantId: null,
                name: product.name,
                image: '',
                unitPrice: 30000,
                reason: 'Phù hợp',
                evidence: {
                  variant: null,
                  price: 30000,
                  caffeine: false,
                  dairy: false,
                  withinBudget: true,
                },
              },
            ],
          },
    ),
  );
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false })),
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  qc.clear();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
async function choose() {
  fireEvent.click(await screen.findByRole('button', { name: 'Hỏi AI' }));
  fireEvent.click(await screen.findByRole('button', { name: /Trà AI.*Phù hợp/ }));
  fireEvent.click(screen.getByRole('button', { name: /Thêm vào giỏ|Chọn mang đi/ }));
}
describe('AI ordering destination', () => {
  it('requires QR for the table menu even when already signed in as a member', async () => {
    mount('/product');
    fireEvent.click(screen.getByRole('button', { name: /Quét QR để đặt/ }));
    await screen.findByText('Quét QR tại bàn');
    expect(useCart.getState().items).toHaveLength(0);
    expect(screen.queryByText('Đã thêm vào giỏ')).toBeNull();
    expect(screen.queryByText('Đã chọn món mang đi')).toBeNull();
  });
  it('routes an anonymous table-menu visitor to QR without creating an orphan cart', async () => {
    mock.member = null;
    mount('/product');
    fireEvent.click(screen.getByRole('button', { name: /Quét QR để đặt/ }));
    await screen.findByText('Quét QR tại bàn');
    expect(useCart.getState().items).toHaveLength(0);
    expect(screen.queryByText('Đã thêm vào giỏ')).toBeNull();
    expect(screen.queryByText('Đã chọn món mang đi')).toBeNull();
  });
  it('keeps table-menu access independent of membership errors', async () => {
    mock.memberError = true;
    mount('/product');
    fireEvent.click(screen.getByRole('button', { name: /Quét QR để đặt/ }));
    await screen.findByText('Quét QR tại bàn');
    expect(useCart.getState().items).toHaveLength(0);
    expect(screen.queryByText('Đã thêm vào giỏ')).toBeNull();
    expect(screen.queryByText('Đã chọn món mang đi')).toBeNull();
  });
  it('does not turn table AI into pickup ordering when there is no QR session', async () => {
    mount();
    const ask = await screen.findByRole('button', { name: 'Hỏi AI' });
    expect((ask as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('link', { name: 'Quét QR để dùng tại bàn' }).getAttribute('href')).toBe(
      '/t',
    );
    expect(useCart.getState().items).toHaveLength(0);
    expect(mock.post).not.toHaveBeenCalled();
  });
  it('adds AI recommendations directly to the pickup draft without touching the table cart', async () => {
    mount('/pickup');
    fireEvent.click(await screen.findByRole('button', { name: 'Tạo đơn mang đi' }));
    const ai = await screen.findByRole('button', { name: 'Hỏi AI cho đơn mang đi' });
    await waitFor(() => expect((ai as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(ai);
    await choose();
    await waitFor(() => expect(screen.getByText(/1 × Trà AI/)).toBeTruthy());
    expect(useCart.getState().items).toHaveLength(0);
  });
  it('keeps the table cart destination for customers already at a table', async () => {
    mock.table = 'B01';
    mount();
    await choose();
    await waitFor(() => expect(useCart.getState().items).toHaveLength(1));
    expect(screen.queryByRole('button', { name: 'Đặt món mang đi' })).toBeNull();
  });
});
