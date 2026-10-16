// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui/Toast';
import { AccountPage } from '../features/auth/AccountPage';
import { AdminUsers } from '../features/admin/Users';
import { AdminToppings } from '../features/admin/Toppings';
import { PaymentAccounting } from '../features/staff/PaymentAccounting';

const mock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  setState: vi.fn(),
  clearSession: vi.fn(),
  user: { id: 'self', name: 'Quản lý', email: 'admin@test.vn', role: 'ADMIN' as const },
}));
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  api: mock,
}));
vi.mock('../features/auth/useAuth', () => ({
  useAuth: Object.assign(
    (selector: (state: { user: typeof mock.user }) => unknown) => selector({ user: mock.user }),
    { setState: mock.setState, getState: () => ({ clearSession: mock.clearSession }) },
  ),
}));
const response = (data: unknown) => ({ data: { success: true, data } });
const clients: QueryClient[] = [];
function mount(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(qc);
  render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <ToastProvider>{ui}</ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
afterEach(() => {
  cleanup();
  for (const qc of clients.splice(0)) qc.clear();
  vi.resetAllMocks();
});

describe('accounts, toppings and compact receipts', () => {
  it('cancels or confirms employee deletion by name', async () => {
    mock.get.mockResolvedValue(
      response({
        users: [
          {
            id: 'staff',
            name: 'Nhân viên A',
            email: 'staff@test.vn',
            role: 'STAFF',
            isActive: true,
          },
        ],
      }),
    );
    mock.delete.mockResolvedValue(response({}));
    mount(<AdminUsers />);
    fireEvent.click(await screen.findByRole('button', { name: 'Xóa' }));
    expect(screen.getByRole('dialog', { name: 'Xóa nhân viên?' })).toBeTruthy();
    expect(screen.getByText('Nhân viên A', { selector: 'strong' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(mock.delete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Xóa' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xóa nhân viên' }));
    await waitFor(() => expect(mock.delete).toHaveBeenCalledWith('/admin/users/staff'));
  });

  it('edits own name and signs out after changing password', async () => {
    mock.get.mockResolvedValue(response(mock.user));
    mock.patch.mockResolvedValue(response({ user: { ...mock.user, name: 'Tên mới' } }));
    mock.post.mockResolvedValue(response({ ok: true }));
    mount(<AccountPage />);
    fireEvent.change(await screen.findByLabelText('Họ tên'), { target: { value: 'Tên mới' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thông tin' }));
    await waitFor(() => expect(mock.patch).toHaveBeenCalledWith('/auth/me', { name: 'Tên mới' }));
    fireEvent.change(screen.getByLabelText('Mật khẩu hiện tại'), {
      target: { value: 'Password@123' },
    });
    fireEvent.change(screen.getByLabelText('Mật khẩu mới'), {
      target: { value: 'NewPassword@123' },
    });
    fireEvent.change(screen.getByLabelText('Nhập lại mật khẩu mới'), {
      target: { value: 'Mismatch@123' },
    });
    expect(
      (screen.getByRole('button', { name: 'Đổi mật khẩu' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText('Nhập lại mật khẩu mới'), {
      target: { value: 'NewPassword@123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Đổi mật khẩu' }));
    await waitFor(() => expect(mock.clearSession).toHaveBeenCalled());
    expect(mock.post).toHaveBeenCalledWith('/auth/password', {
      currentPassword: 'Password@123',
      newPassword: 'NewPassword@123',
    });
  });

  it('disables self lock and confirms another account lock before submitting', async () => {
    mock.get.mockResolvedValue(
      response({
        users: [
          { ...mock.user, isActive: true },
          {
            id: 'staff',
            name: 'Nhân viên A',
            email: 'staff@test.vn',
            role: 'STAFF',
            isActive: true,
          },
        ],
      }),
    );
    mock.patch.mockResolvedValue(response({}));
    mount(<AdminUsers />);
    const buttons = await screen.findAllByRole('button', { name: 'Khoá' });
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(buttons[1]!);
    expect(mock.patch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Khóa tài khoản' }));
    await waitFor(() =>
      expect(mock.patch).toHaveBeenCalledWith('/admin/users/staff', { isActive: false }),
    );
  });

  it('requires topping deletion confirmation and offers restore', async () => {
    const topping = {
      _id: 'top',
      name: 'Trân châu',
      price: 8000,
      isAvailable: true,
      isArchived: false,
    };
    mock.get.mockResolvedValue(
      response({ toppings: [topping, { ...topping, _id: 'old', name: 'Kem', isArchived: true }] }),
    );
    mock.delete.mockResolvedValue(response({}));
    mock.patch.mockResolvedValue(response({}));
    mount(<AdminToppings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Xóa' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(mock.delete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Xóa' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xóa topping' }));
    await waitFor(() => expect(mock.delete).toHaveBeenCalledWith('/admin/toppings/top'));
    fireEvent.click(screen.getByText('Topping đã xóa (1)'));
    fireEvent.click(screen.getByRole('button', { name: 'Khôi phục' }));
    await waitFor(() =>
      expect(mock.patch).toHaveBeenCalledWith('/admin/toppings/old', { isArchived: false }),
    );
  });

  it('keeps payment ID collapsed while showing table, order and amount', async () => {
    mock.get.mockResolvedValue(
      response({
        items: [
          {
            id: 'long-payment-id',
            amount: 35000,
            method: 'CASH',
            status: 'SUCCESS',
            paidAt: '2026-10-15T01:00:00Z',
            orders: [{ tableName: 'Bàn 01', code: 'MC01' }],
          },
        ],
        total: 1,
        corrections: [],
        targets: [],
      }),
    );
    mount(<PaymentAccounting />);
    expect(await screen.findByText('Bàn 01 · MC01')).toBeTruthy();
    const details = screen.getByText('Mã khoản thu: long-payment-id').closest('details')!;
    expect(details.open).toBe(false);
    fireEvent.click(screen.getByText('Chi tiết'));
    expect(details.open).toBe(true);
    expect(screen.getByText('Quy định điều chỉnh').closest('details')?.open).toBe(false);
  });
});
