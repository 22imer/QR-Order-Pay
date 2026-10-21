// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PickupLayout } from '../layouts/PickupLayout';
import { PickupPage } from '../features/pickup/PickupPage';
import { MemberPage } from '../features/guest/MemberPage';
import { ToastProvider } from '../components/ui/Toast';
import { useCart } from '../store/cart';

const mock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  member: null as { id: string; name: string; phone: string; points: number } | null,
  failCreate: false,
}));
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  api: mock,
}));
vi.mock('../features/auth/useAuth', () => ({
  useAuth: (selector: (s: { user: null }) => unknown) => selector({ user: null }),
}));
vi.mock('../lib/socket', () => ({ useSocketEvent: vi.fn() }));
vi.mock('../features/guest/ProductDetailModal', () => ({
  ProductDetailModal: ({
    product,
    onAdd,
    onAdded,
  }: {
    product: unknown;
    onAdd: (item: unknown) => void;
    onAdded: () => void;
  }) =>
    product ? (
      <button
        onClick={() => {
          onAdd({
            productId: '507f1f77bcf86cd799439011',
            variantId: null,
            sizeName: null,
            sugarLevel: '0%',
            iceLevel: 'normal-ice',
            toppingIds: [],
            quantity: 1,
            note: '',
            unitPrice: 30000,
            name: 'Trà thử',
            variantName: '',
            image: '',
          });
          onAdded();
        }}
      >
        Thêm món thử
      </button>
    ) : null,
}));
const response = (data: unknown) => ({ data: { success: true, data } });
const member = { id: 'member-a', name: 'Lan', phone: '0901234567', points: 0 };
let qc: QueryClient;
function mount(path = '/pickup') {
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          <Routes>
            <Route element={<PickupLayout />}>
              <Route path="/pickup" element={<PickupPage view="order" />} />
              <Route path="/pickup/orders" element={<PickupPage view="orders" />} />
              <Route path="/pickup/member" element={<MemberPage />} />
            </Route>
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  mock.member = member;
  mock.failCreate = false;
  sessionStorage.clear();
  useCart.getState().resetSession();
  mock.get.mockImplementation(async (url: string) => {
    if (url === '/members/me') return response({ member: mock.member });
    if (url === '/categories')
      return response({
        products: [
          {
            _id: '507f1f77bcf86cd799439011',
            name: 'Trà thử',
            variants: [],
            isAvailable: true,
            basePrice: 30000,
            image: '',
          },
        ],
        toppings: [],
      });
    if (url === '/table-sessions/current') throw new Error('Pickup must not read a table session');
    return response({ items: [], total: 0 });
  });
  mock.post.mockImplementation(async (url: string) => {
    if (url === '/members/login') {
      mock.member = member;
      return response({ member });
    }
    if (url === '/members/logout') {
      mock.member = null;
      return response({});
    }
    if (url.endsWith('/quote'))
      return response({
        total: 30000,
        subtotal: 30000,
        quoteToken: 'valid-quote-token-long-enough',
        items: [],
      });
    if (url === '/pickups' && mock.failCreate)
      throw { isAxiosError: true, response: { status: 502 } };
    return response({});
  });
});
afterEach(() => {
  cleanup();
  qc.clear();
  vi.clearAllMocks();
});
async function add() {
  fireEvent.click(await screen.findByRole('button', { name: /Trà thử/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Thêm món thử' }));
}
async function openCart(count = 1) {
  fireEvent.click(await screen.findByRole('button', { name: `Giỏ hàng mang đi (${count})` }));
  return screen.findByRole('dialog', { name: 'Giỏ mang đi' });
}
function closeCart() {
  fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
}
function nav(name: string) {
  fireEvent.click(screen.getAllByRole('link', { name })[0]!);
}
describe('independent pickup routes', () => {
  it('signs in within the pickup shell and opens its catalog without a table API or cart', async () => {
    mock.member = null;
    mount();
    fireEvent.click(await screen.findByRole('link', { name: 'Đăng nhập / Đăng ký thành viên' }));
    fireEvent.change(await screen.findByLabelText('Số điện thoại'), {
      target: { value: member.phone },
    });
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'Password@123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    await screen.findByRole('button', { name: /Trà thử/ });
    expect(screen.getByRole('link', { name: 'Tại quán' }).getAttribute('href')).toBe('/t');
    expect(mock.get.mock.calls.some(([url]) => url === '/table-sessions/current')).toBe(false);
    expect(screen.queryByRole('link', { name: 'Gọi nhân viên' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Xem giỏ' })).toBeNull();
  });
  it('keeps its draft across order tabs without changing the existing table cart', async () => {
    useCart.getState().setSession('table-session', 'table-guest');
    useCart.getState().add({
      productId: 'table-product',
      variantId: null,
      sizeName: null,
      sugarLevel: '0%',
      iceLevel: 'normal-ice',
      toppingIds: [],
      quantity: 1,
      note: '',
      unitPrice: 10000,
      name: 'Món tại bàn',
      variantName: '',
      image: '',
    });
    const tableCart = useCart.getState().items;
    mount();
    await add();
    await openCart();
    fireEvent.change(screen.getByLabelText('Tên người nhận'), {
      target: { value: 'Người nhận riêng' },
    });
    closeCart();
    nav('Đơn của tôi');
    await screen.findByRole('heading', { name: 'Đơn mang đi của tôi' });
    expect(screen.queryByLabelText('Tên người nhận')).toBeNull();
    nav('Đặt món');
    await openCart();
    expect(screen.getByRole('button', { name: 'Xóa Trà thử' })).toBeTruthy();
    expect((screen.getByLabelText('Tên người nhận') as HTMLInputElement).value).toBe(
      'Người nhận riêng',
    );
    expect(useCart.getState().items).toEqual(tableCart);
    expect(useCart.getState().tableSessionId).toBe('table-session');
    expect(mock.get.mock.calls.some(([url]) => url === '/table-sessions/current')).toBe(false);
  });
  it('recovers an uncertain create across tabs, retries the same request and then opens pickup history', async () => {
    mock.failCreate = true;
    mount();
    await add();
    await openCart();
    fireEvent.click(screen.getByRole('button', { name: 'Đặt món mang đi' }));
    await screen.findByRole('button', { name: 'Thử lại cùng yêu cầu' });
    const first = mock.post.mock.calls.find(([url]) => url === '/pickups')![1];
    closeCart();
    nav('Đơn của tôi');
    await screen.findByRole('heading', { name: 'Đơn mang đi của tôi' });
    nav('Đặt món');
    const retry = await screen.findByRole('button', { name: 'Thử lại cùng yêu cầu' });
    expect(screen.getByLabelText('Tên người nhận').matches(':disabled')).toBe(true);
    mock.failCreate = false;
    fireEvent.click(retry);
    await screen.findByRole('heading', { name: 'Đơn mang đi của tôi' });
    await waitFor(() =>
      expect(mock.post.mock.calls.filter(([url]) => url === '/pickups')).toHaveLength(2),
    );
    expect(mock.post.mock.calls.filter(([url]) => url === '/pickups')[1]![1]).toEqual(first);
    nav('Đặt món');
    await screen.findByRole('button', { name: /Trà thử/ });
    expect(screen.queryByText(/1 × Trà thử/)).toBeNull();
  });
  it('opens an empty cart, edits quantities and removes items without creating an order', async () => {
    mount();
    await openCart(0);
    expect(screen.getByText('Giỏ hàng chưa có món.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Chọn món' }));
    await add();
    await openCart();
    fireEvent.click(screen.getByRole('button', { name: 'Tăng số lượng' }));
    expect(screen.getByText('Tổng: 60.000₫')).toBeTruthy();
    closeCart();
    const floating = screen.getByRole('button', { name: 'Giỏ hàng mang đi (2)' });
    expect(floating.textContent).toContain('60.000₫');
    await openCart(2);
    fireEvent.click(screen.getByRole('button', { name: 'Giảm số lượng' }));
    expect(screen.getByText('Tổng: 30.000₫')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Xóa Trà thử' }));
    expect(screen.getByText('Giỏ hàng chưa có món.')).toBeTruthy();
    expect(mock.post).not.toHaveBeenCalled();
  });
  it('filters categories and search while revealing the catalog in batches', async () => {
    const original = mock.get.getMockImplementation()!;
    mock.get.mockImplementation(async (url: string) =>
      url === '/categories'
        ? response({
            categories: [
              { _id: 'tea', name: 'Trà' },
              { _id: 'coffee', name: 'Cà phê' },
            ],
            products: Array.from({ length: 8 }, (_, i) => ({
              _id: `product-${i}`,
              name: `Món ${i + 1}`,
              categoryId: i < 6 ? 'tea' : 'coffee',
              isAvailable: true,
              basePrice: 30000,
              variants: [],
              image: '',
            })),
            toppings: [],
          })
        : original(url),
    );
    mount();
    await screen.findByRole('button', { name: /Món 1 ·/ });
    expect(screen.queryByRole('button', { name: /Món 7 ·/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Xem thêm món (2)' }));
    expect(screen.getByRole('button', { name: /Món 8 ·/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cà phê' }));
    expect(screen.queryByRole('button', { name: /Món 1 ·/ })).toBeNull();
    fireEvent.change(screen.getByLabelText('Tìm món mang đi'), { target: { value: 'không có' } });
    expect(screen.getByText('Không tìm thấy món.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Xem tất cả' }));
    expect(screen.getByRole('button', { name: /Món 1 ·/ })).toBeTruthy();
    expect(mock.post).not.toHaveBeenCalled();
  });
});
