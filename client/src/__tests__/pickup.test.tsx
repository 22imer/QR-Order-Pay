// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { PickupPage } from '../features/pickup/PickupPage';
import { ToastProvider } from '../components/ui/Toast';
import type { PickupOrder } from '@may-cafe/contracts';
const mock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  member: { id: 'member-a', name: 'Lan', phone: '0901234567', points: 20 } as {
    id: string;
    name: string;
    phone: string;
    points: number;
  } | null,
  listeners: new Map<string, () => void>(),
}));
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  api: mock,
}));
vi.mock('../features/auth/useAuth', () => ({
  useAuth: (selector: (s: { user: { id: string } }) => unknown) =>
    selector({ user: { id: 'staff-a' } }),
}));
vi.mock('../features/guest/useMember', () => ({
  useMember: () => ({ data: { member: mock.member }, isPending: false, isError: false }),
}));
vi.mock('../lib/socket', () => ({
  useSocketEvent: (event: string, fn: () => void) => mock.listeners.set(event, fn),
}));
vi.mock('../features/guest/ProductDetailModal', () => ({
  ProductDetailModal: ({
    product,
    onAdd,
    onAdded,
  }: {
    product: { _id: string } | null;
    onAdd: (v: unknown) => void;
    onAdded: () => void;
  }) =>
    product ? (
      <button
        onClick={() => {
          onAdd({
            productId: product._id,
            variantId: null,
            sizeName: null,
            sugarLevel: '0%',
            iceLevel: 'normal-ice',
            toppingIds: [],
            note: 'ít ngọt',
            quantity: 1,
            unitPrice: 30000,
            name: 'Trà thử',
            variantName: '',
            image: '',
          });
          onAdded();
        }}
      >
        Thêm món đã tùy chỉnh
      </button>
    ) : null,
}));
const response = (data: unknown) => ({ data: { success: true, data } });
const product = {
  _id: '507f1f77bcf86cd799439011',
  name: 'Trà thử',
  variants: [],
  basePrice: 30000,
  image: '',
  isAvailable: true,
};
const quote = {
  quoteId: 'q',
  quoteToken: 'valid-quote-token-long-enough',
  expiresAt: '2026-10-20T12:00:00Z',
  total: 30000,
  subtotal: 30000,
  items: [],
};
const order = (extra: Partial<PickupOrder> = {}): PickupOrder => ({
  _id: '507f1f77bcf86cd799439012',
  code: 'MDTEST1',
  tableSessionId: null,
  participantId: 'member:member-a',
  fulfillmentType: 'TAKEAWAY',
  scheduledAt: null,
  items: [
    {
      productId: product._id,
      variantId: null,
      sizeName: null,
      sugarLevel: '0%',
      iceLevel: 'normal-ice',
      toppingIds: [],
      toppingNamesSnapshot: [],
      variantNameSnapshot: '',
      note: '',
      quantity: 1,
      unitPrice: 30000,
      lineTotal: 30000,
      nameSnapshot: 'Trà thử',
    },
  ],
  total: 30000,
  status: 'AWAITING_PAYMENT',
  paymentStatus: 'UNPAID',
  paidAmount: 0,
  balanceDue: 30000,
  version: 4,
  cancelReason: '',
  review: null,
  createdAt: '2026-10-20T00:00:00Z',
  updatedAt: '2026-10-20T00:00:00Z',
  statusHistory: [],
  pickup: {
    name: 'Lan',
    phone: '0901234567',
    scheduledAt: null,
    outcome: 'ACTIVE',
    closedAt: null,
    reason: '',
  },
  billId: null,
  ...extra,
});
let qc: QueryClient;
function mount(staff = false) {
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ToastProvider>
          <PickupPage staff={staff} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
async function draft() {
  fireEvent.click(await screen.findByRole('button', { name: 'Tạo đơn mang đi' }));
  fireEvent.click(await screen.findByRole('button', { name: /Trà thử/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Thêm món đã tùy chỉnh' }));
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.listeners.clear();
  sessionStorage.clear();
  mock.member = { id: 'member-a', name: 'Lan', phone: '0901234567', points: 20 };
  mock.get.mockImplementation(async (url: string) =>
    response(
      url === '/categories' || url.endsWith('/catalog')
        ? { products: [product], toppings: [] }
        : { items: [], total: 0 },
    ),
  );
  mock.post.mockImplementation(async (url: string) =>
    response(url.endsWith('/quote') ? quote : { order: order(), created: true }),
  );
  mock.patch.mockResolvedValue(response({ order: order() }));
});
afterEach(() => {
  cleanup();
  qc?.clear();
});
describe('pickup ordering and counter UI', () => {
  it('shows products in batches and lets customers search and select a later item', async () => {
    const products = Array.from({ length: 7 }, (_, index) => ({
      ...product,
      _id: `507f1f77bcf86cd79943901${index}`,
      name: `Món số ${index + 1}`,
    }));
    mock.get.mockImplementation(async (url: string) =>
      response(url === '/categories' ? { products, toppings: [] } : { items: [], total: 0 }),
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Tạo đơn mang đi' }));
    await screen.findByRole('button', { name: /Món số 1/ });
    expect(screen.getAllByRole('button', { name: /Món số/ })).toHaveLength(6);
    expect(screen.queryByRole('button', { name: /Món số 7/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Xem thêm món (1)' }));
    expect(screen.getAllByRole('button', { name: /Món số/ })).toHaveLength(7);
    fireEvent.change(screen.getByLabelText('Tìm món mang đi'), { target: { value: 'Món số 7' } });
    expect(screen.getAllByRole('button', { name: /Món số/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /Món số 7/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Thêm món đã tùy chỉnh' }));
    expect(screen.getByText(/1 × Trà thử/)).toBeTruthy();
    expect(mock.post).not.toHaveBeenCalled();
  });
  it('shows voucher and point details plus item configuration on the finalized member invoice', async () => {
    mock.get.mockImplementation(async (url: string) =>
      response(
        url.endsWith('/bill')
          ? {
              invoiceCode: 'HD-PICKUP',
              title: 'Mang đi',
              closedAt: '2026-10-20T00:00:00Z',
              total: 15000,
              order: {
                code: 'MDTEST1',
                subtotal: 30000,
                voucherCode: 'PICK10',
                voucherDiscount: 10000,
                pointsDiscount: 5000,
                redeemedPoints: 5,
                items: [
                  {
                    name: 'Trà thử',
                    size: null,
                    quantity: 1,
                    lineTotal: 30000,
                    sugarLevel: '0%',
                    iceLevel: 'normal-ice',
                    toppings: ['Trân châu'],
                    note: 'Đóng nắp',
                  },
                ],
              },
            }
          : { items: [order({ billId: 'bill', status: 'SERVED' })], total: 1 },
      ),
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Xem hóa đơn' }));
    await screen.findByText('Voucher PICK10');
    expect(screen.getByText('Đổi 5 điểm')).toBeTruthy();
    expect(screen.getByText(/Trân châu.*Đóng nắp/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'In hóa đơn' })).toBeNull();
  });
  it('asks anonymous customers to sign in without exposing any pickup list', () => {
    mock.member = null;
    mount();
    expect(screen.getByRole('link', { name: /Đăng nhập/ }).getAttribute('href')).toBe('/pickup/member');
    expect(mock.get).not.toHaveBeenCalled();
  });
  it('creates a quoted standalone order with its own basket and does not send a client member identity', async () => {
    mount();
    await draft();
    fireEvent.click(screen.getByRole('button', { name: 'Đặt món mang đi' }));
    await waitFor(() =>
      expect(mock.post).toHaveBeenCalledWith(
        '/pickups',
        expect.objectContaining({
          pickup: {
            fulfillmentType: 'TAKEAWAY',
            name: 'Lan',
            phone: '0901234567',
            scheduledAt: null,
          },
          quoteToken: quote.quoteToken,
        }),
      ),
    );
    const payload = mock.post.mock.calls.find(([path]) => path === '/pickups')![1];
    expect(payload.requestId).toMatch(/^[a-f0-9-]{36}$/);
    expect(payload).not.toHaveProperty('memberId');
    expect(payload.items[0].note).toBe('ít ngọt');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Đóng đơn nháp' })).toBeNull());
  });
  it('requires review of a changed total before sending and keeps discounts visible', async () => {
    mock.post.mockImplementation(async (url: string) =>
      response(
        url.endsWith('/quote')
          ? { ...quote, total: 25000, voucherDiscount: 5000, voucherCode: 'SAVE' }
          : {},
      ),
    );
    mount();
    await draft();
    fireEvent.click(screen.getByRole('button', { name: 'Đặt món mang đi' }));
    await screen.findByRole('button', { name: 'Xác nhận đặt đơn' });
    expect(mock.post.mock.calls.filter(([u]) => u === '/pickups')).toHaveLength(0);
    expect(screen.getByText('Voucher SAVE')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đặt đơn' }));
    await waitFor(() =>
      expect(mock.post.mock.calls.filter(([u]) => u === '/pickups')).toHaveLength(1),
    );
  });
  it('serializes pickup time with explicit Vietnam offset', async () => {
    mount();
    await draft();
    fireEvent.click(screen.getByLabelText('Hẹn giờ nhận'));
    fireEvent.change(screen.getByLabelText('Giờ nhận (giờ Việt Nam)'), {
      target: { value: '2026-10-21T14:30' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Đặt món mang đi' }));
    await waitFor(() =>
      expect(mock.post).toHaveBeenCalledWith(
        '/pickups',
        expect.objectContaining({
          pickup: expect.objectContaining({
            fulfillmentType: 'PICKUP',
            scheduledAt: '2026-10-21T07:30:00.000Z',
          }),
        }),
      ),
    );
  });
  it('locks uncertain submissions and recovers the exact payload/key after a remount', async () => {
    let fail = true;
    mock.post.mockImplementation(async (url: string) => {
      if (url.endsWith('/quote')) return response(quote);
      if (fail)
        throw {
          isAxiosError: true,
          response: { status: 502, data: { error: { message: 'Mất phản hồi' } } },
        };
      return response({});
    });
    const mounted = mount();
    await draft();
    fireEvent.click(screen.getByRole('button', { name: 'Đặt món mang đi' }));
    await screen.findByRole('button', { name: 'Thử lại cùng yêu cầu' });
    expect(screen.getByLabelText('Tên người nhận').matches(':disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Đóng đơn nháp' }).matches(':disabled')).toBe(true);
    const first = mock.post.mock.calls.find(([u]) => u === '/pickups')![1];
    mounted.unmount();
    qc.clear();
    fail = false;
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Thử lại cùng yêu cầu' }));
    await waitFor(() =>
      expect(mock.post.mock.calls.filter(([u]) => u === '/pickups')).toHaveLength(2),
    );
    expect(mock.post.mock.calls.filter(([u]) => u === '/pickups')[1]![1]).toEqual(first);
    expect(mock.post.mock.calls.filter(([u]) => u.endsWith('/quote'))).toHaveLength(1);
  });
  it('uses the version captured when opening collection and preserves payment key after server failure', async () => {
    let row = order();
    mock.get.mockImplementation(async () => response({ items: [row], total: 1 }));
    let fail = true;
    mock.post.mockImplementation(async () => {
      if (fail) throw { isAxiosError: true, response: { status: 504 } };
      return response({});
    });
    mount(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Xử lý đơn' }));
    row = order({ version: 5 });
    await act(async () => {
      mock.listeners.get('order.statusChanged')?.();
    });
    fireEvent.click(screen.getByLabelText(/Tôi đã kiểm tra/));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận thu tiền' }));
    await screen.findByRole('button', { name: 'Thử lại cùng yêu cầu' });
    expect(screen.getByLabelText('Số tiền thực nhận').matches(':disabled')).toBe(true);
    const first = mock.post.mock.calls[0]!;
    expect(first[1].expectedVersion).toBe(4);
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại cùng yêu cầu' }));
    await waitFor(() => expect(mock.post).toHaveBeenCalledTimes(2));
    expect(mock.post.mock.calls[1]).toEqual(first);
  });
  it('requires refund confirmation/reason and does not offer unpaid cancellation for collected money', async () => {
    mock.get.mockResolvedValue(
      response({ items: [order({ paidAmount: 10000, balanceDue: 20000 })], total: 1 }),
    );
    mount(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Xử lý đơn' }));
    expect(screen.queryByRole('button', { name: 'Xác nhận hủy đơn' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Đã hoàn đủ tiền & hủy' }).matches(':disabled')).toBe(
      true,
    );
    fireEvent.change(screen.getByLabelText('Lý do'), {
      target: { value: 'Khách đổi ý, đã hoàn tiền' },
    });
    fireEvent.click(screen.getByLabelText(/Tôi đã kiểm tra/));
    fireEvent.click(screen.getByRole('button', { name: 'Đã hoàn đủ tiền & hủy' }));
    await waitFor(() =>
      expect(mock.post).toHaveBeenCalledWith(
        expect.stringMatching(/\/refund$/),
        {
          amount: 10000,
          expectedVersion: 4,
          method: 'CASH',
          reason: 'Khách đổi ý, đã hoàn tiền',
          refundConfirmed: true,
        },
        expect.anything(),
      ),
    );
  });
  it('does not show the previous member list after account identity changes', async () => {
    mock.get.mockResolvedValue(response({ items: [order()], total: 1 }));
    const mounted = mount();
    await screen.findByText('MDTEST1');
    mock.member = { id: 'member-b', name: 'Minh', phone: '0901234568', points: 0 };
    mock.get.mockImplementation(() => new Promise(() => {}));
    mounted.rerender(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <PickupPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.queryByText('MDTEST1')).toBeNull());
  });
});
