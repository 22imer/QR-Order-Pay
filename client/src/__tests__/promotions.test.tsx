// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { MemberPage } from '../features/guest/MemberPage';
import { CartPage } from '../features/guest/CartPage';
import { AdminMembers } from '../features/admin/Members';
import { AdminVouchers } from '../features/admin/Vouchers';
import { useCart } from '../store/cart';
import { ToastProvider } from '../components/ui/Toast';
const mock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  api: mock,
}));
const response = (data: unknown) => ({ data: { success: true, data } });
const member = {
  id: 'member1',
  name: 'Khách thử',
  phone: '0901234567',
  points: 10,
  isActive: true,
  version: 4,
  createdAt: new Date().toISOString(),
};
const clients: QueryClient[] = [];
function mount(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(qc);
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ToastProvider>{ui}</ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return qc;
}
function cart() {
  useCart.getState().setSession('s1', 'g1');
  useCart.getState().add({
    productId: 'p1',
    variantId: null,
    sizeName: null,
    sugarLevel: '0%',
    iceLevel: 'normal-ice',
    toppingIds: [],
    note: '',
    quantity: 1,
    unitPrice: 60000,
    name: 'Latte',
    variantName: '',
    image: '',
  });
  mock.get.mockImplementation(async (url: string) =>
    response(url === '/members/me' ? { member } : { active: true, status: 'OPEN' }),
  );
}
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((q) => q.clear());
  vi.resetAllMocks();
  useCart.getState().resetSession();
});
describe('members and promotions UI', () => {
  it('registers with phone/password and shows a server failure without claiming success', async () => {
    mock.get.mockResolvedValue(response({ member: null }));
    mock.post.mockRejectedValue(new Error('SĐT đã được đăng ký.'));
    mount(<MemberPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Chưa có tài khoản? Đăng ký' }));
    fireEvent.change(screen.getByLabelText('Tên của bạn'), { target: { value: 'Khách thử' } });
    fireEvent.change(screen.getByLabelText('Số điện thoại'), { target: { value: '0901234567' } });
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'Password@123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tạo tài khoản' }));
    await screen.findByRole('alert');
    expect(mock.post).toHaveBeenCalledWith('/members/register', {
      name: 'Khách thử',
      phone: '0901234567',
      password: 'Password@123',
    });
    expect(screen.queryByText('10 điểm')).toBeNull();
  });
  it('shows member balance/history and clears private cached history when logging out', async () => {
    let loggedIn = true;
    mock.get.mockImplementation(async (url: string) =>
      response(
        url === '/members/me'
          ? { member: loggedIn ? member : null }
          : {
              items: [
                {
                  id: 'e1',
                  orderCode: 'MC1',
                  type: 'RETURN',
                  points: 5,
                  balanceAfter: 10,
                  createdAt: new Date().toISOString(),
                },
              ],
              total: 1,
            },
      ),
    );
    mock.post.mockImplementation(async () => {
      loggedIn = false;
      return response({});
    });
    const qc = mount(<MemberPage />);
    await screen.findByText('Hoàn điểm · MC1');
    fireEvent.click(screen.getByRole('button', { name: 'Đăng xuất thành viên' }));
    await screen.findByRole('button', { name: 'Đăng nhập' });
    await waitFor(() => expect(qc.getQueryData(['member-points', member.id, 1])).toBeUndefined());
    expect(screen.queryByText('Hoàn điểm · MC1')).toBeNull();
  });
  it('shows authoritative voucher discount and sends the code with a signed quote', async () => {
    cart();
    mock.post.mockImplementation(async (url: string) =>
      response(
        url === '/orders/quote'
          ? {
              total: 50000,
              subtotal: 60000,
              voucherCode: 'SAVE10',
              voucherDiscount: 10000,
              quoteToken: 'signed',
            }
          : {},
      ),
    );
    mount(<CartPage />);
    await screen.findByLabelText('Điểm muốn đổi');
    fireEvent.change(screen.getByLabelText('Mã voucher'), { target: { value: 'save10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra ưu đãi' }));
    await screen.findByText('Voucher SAVE10');
    expect(mock.post.mock.calls.map((c) => c[0])).toEqual(['/orders/quote']);
    fireEvent.click(screen.getByRole('button', { name: 'Đặt món' }));
    await waitFor(() =>
      expect(mock.post).toHaveBeenCalledWith(
        '/orders',
        expect.objectContaining({ voucherCode: 'SAVE10', quoteToken: 'signed' }),
        expect.anything(),
      ),
    );
    const body = mock.post.mock.calls.find((c) => c[0] === '/orders')![1];
    expect(body).not.toHaveProperty('voucherDiscount');
    expect(body).not.toHaveProperty('memberId');
  });
  it('keeps both selections and stops when server rejects the balance', async () => {
    cart();
    mock.post.mockImplementation(async (_url: string, body: { redeemPoints?: number }) => {
      if (body.redeemPoints === 0)
        return response({
          total: 50000,
          subtotal: 60000,
          voucherCode: 'SAVE10',
          voucherDiscount: 10000,
          voucherAllowsPoints: true,
          maxRedeemPoints: 10,
          quoteToken: 'base',
        });
      throw new Error('Không đủ điểm để đổi.');
    });
    mount(<CartPage />);
    fireEvent.change(screen.getByLabelText('Mã voucher'), { target: { value: 'SAVE10' } });
    const points = await screen.findByLabelText('Điểm muốn đổi');
    fireEvent.change(points, { target: { value: '10' } });
    expect((screen.getByLabelText('Mã voucher') as HTMLInputElement).value).toBe('SAVE10');
    fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra ưu đãi' }));
    await screen.findByText('Không đủ điểm để đổi.');
    expect(mock.post).toHaveBeenCalledWith(
      '/orders/quote',
      expect.objectContaining({ voucherCode: 'SAVE10', redeemPoints: 10 }),
    );
    expect(mock.post.mock.calls.some((c) => c[0] === '/orders')).toBe(false);
  });
  it('shows and submits both discounts when the voucher allows points', async () => {
    cart();
    mock.post.mockImplementation(async (url: string, body: { redeemPoints?: number }) =>
      response(
        url === '/orders/quote'
          ? {
              subtotal: 60000,
              voucherCode: 'SAVE10',
              voucherDiscount: 10000,
              voucherAllowsPoints: true,
              maxRedeemPoints: 10,
              total: body.redeemPoints ? 40000 : 50000,
              pointsDiscount: body.redeemPoints ? 10000 : 0,
              redeemedPoints: body.redeemPoints ?? 0,
              quoteToken: 'combined',
            }
          : {},
      ),
    );
    mount(<CartPage />);
    const points = await screen.findByLabelText('Điểm muốn đổi');
    fireEvent.change(points, { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Mã voucher'), { target: { value: 'SAVE10' } });
    expect((points as HTMLInputElement).value).toBe('10');
    fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra ưu đãi' }));
    await screen.findByText('Đổi 10 điểm');
    await screen.findByText('Voucher SAVE10');
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Đặt món' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Đặt món' }));
    await waitFor(() =>
      expect(mock.post).toHaveBeenCalledWith(
        '/orders',
        expect.objectContaining({
          voucherCode: 'SAVE10',
          redeemPoints: 10,
          quoteToken: 'combined',
        }),
        expect.anything(),
      ),
    );
  });
  it('retains the post-voucher maximum when editing points and shows server rejection', async () => {
    cart();
    mock.get.mockImplementation(async (url: string) =>
      response(
        url === '/members/me'
          ? { member: { ...member, points: 100 } }
          : { active: true, status: 'OPEN' },
      ),
    );
    mock.post.mockImplementation(async (_url: string, body: { redeemPoints?: number }) => {
      if ((body.redeemPoints ?? 0) > 25) throw new Error('Chỉ được đổi tối đa 25 điểm.');
      return response({
        total: 50000,
        subtotal: 60000,
        voucherCode: 'SAVE10',
        voucherDiscount: 10000,
        voucherAllowsPoints: true,
        maxRedeemPoints: 25,
        quoteToken: 'base',
      });
    });
    mount(<CartPage />);
    const points = await screen.findByLabelText('Điểm muốn đổi');
    fireEvent.change(screen.getByLabelText('Mã voucher'), { target: { value: 'SAVE10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra ưu đãi' }));
    await screen.findByText('Có thể đổi tối đa 25 điểm với lựa chọn hiện tại.');
    fireEvent.change(points, { target: { value: '26' } });
    expect((points as HTMLInputElement).max).toBe('25');
    fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra ưu đãi' }));
    await screen.findByText('Chỉ được đổi tối đa 25 điểm.');
    expect(mock.post.mock.calls.some((c) => c[0] === '/orders')).toBe(false);
  });
  it('shows exclusive voucher policy without silently discarding the selected points', async () => {
    cart();
    mock.post.mockImplementation(async (_url: string, body: { redeemPoints?: number }) => {
      if (body.redeemPoints) throw new Error('Voucher này không cho phép dùng kèm điểm.');
      return response({
        total: 50000,
        subtotal: 60000,
        voucherCode: 'SAVE10',
        voucherDiscount: 10000,
        voucherAllowsPoints: false,
        maxRedeemPoints: 0,
        quoteToken: 'exclusive',
      });
    });
    mount(<CartPage />);
    const points = await screen.findByLabelText('Điểm muốn đổi');
    fireEvent.change(points, { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Mã voucher'), { target: { value: 'SAVE10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra ưu đãi' }));
    await screen.findByText('Voucher này không cho phép dùng kèm điểm.');
    expect((points as HTMLInputElement).value).toBe('10');
    expect((points as HTMLInputElement).max).toBe('0');
    expect(mock.post.mock.calls.some((c) => c[0] === '/orders')).toBe(false);
  });
  it('admin submits explicit member lock using observed version', async () => {
    mock.get.mockImplementation(async (url: string) =>
      response(url.endsWith('/points') ? { items: [], total: 0 } : { items: [member], total: 1 }),
    );
    mock.patch.mockResolvedValue(response({}));
    mount(<AdminMembers />);
    fireEvent.click(await screen.findByRole('button', { name: 'Chi tiết' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Khóa tài khoản và đăng xuất mọi thiết bị' }),
    );
    await waitFor(() =>
      expect(mock.patch).toHaveBeenCalledWith('/admin/members/member1', {
        expectedVersion: 4,
        isActive: false,
      }),
    );
  });
  it('admin can create a percent voucher with cap, date and member quota', async () => {
    mock.get.mockResolvedValue(response({ items: [] }));
    mock.post.mockResolvedValue(response({}));
    mount(<AdminVouchers />);
    fireEvent.click(screen.getByRole('button', { name: 'Tạo voucher' }));
    fireEvent.change(screen.getByLabelText('Mã voucher'), { target: { value: 'MEMBER20' } });
    fireEvent.change(screen.getByLabelText('Tên chương trình'), {
      target: { value: 'Ưu đãi thành viên' },
    });
    fireEvent.change(screen.getByLabelText('Loại giảm'), { target: { value: 'PERCENT' } });
    fireEvent.change(screen.getByLabelText('Giá trị giảm'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('Giảm tối đa (đ, để trống nếu không giới hạn)'), {
      target: { value: '15000' },
    });
    fireEvent.click(screen.getByLabelText('Yêu cầu đăng nhập thành viên'));
    fireEvent.click(screen.getByLabelText('Cho phép dùng kèm điểm'));
    fireEvent.change(screen.getByLabelText('Lượt mỗi thành viên (để trống nếu không giới hạn)'), {
      target: { value: '1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu voucher' }));
    await waitFor(() =>
      expect(mock.post).toHaveBeenCalledWith(
        '/admin/vouchers',
        expect.objectContaining({
          code: 'MEMBER20',
          type: 'PERCENT',
          value: 20,
          maxDiscount: 15000,
          memberRequired: true,
          perMemberLimit: 1,
          allowPointRedemption: true,
        }),
      ),
    );
  });
});
