// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ReservationLayout } from '../layouts/ReservationLayout';
import { ReservationsPage } from '../features/reservations/ReservationsPage';
import { MemberPage } from '../features/guest/MemberPage';
import type { Reservation } from '@may-cafe/contracts';

const mock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  member: null as null | { id: string; name: string; phone: string; points: number },
  fail: 0,
}));
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  api: mock,
}));
vi.mock('../features/auth/useAuth', () => ({
  useAuth: (selector: (s: unknown) => unknown) => selector({ user: { id: 'staff-a' } }),
}));
vi.mock('../lib/socket', () => ({ useSocketEvent: vi.fn() }));
const member = { id: 'member-a', name: 'Lan', phone: '0901234567', points: 0 };
const tableId = '507f1f77bcf86cd799439011';
const result = (data: unknown) => ({ data: { success: true, data } });
let qc: QueryClient;
const row = (): Reservation => ({
  id: '507f1f77bcf86cd799439012',
  code: 'DB-TEST',
  tableId,
  tableName: 'Bàn cửa sổ',
  partySize: 2,
  startsAt: new Date(Date.now() + 5 * 60000).toISOString(),
  endsAt: new Date(Date.now() + 65 * 60000).toISOString(),
  arrivalDeadline: new Date(Date.now() + 20 * 60000).toISOString(),
  name: member.name,
  phone: member.phone,
  note: '',
  status: 'CONFIRMED',
  version: 0,
  checkedInAt: null,
  closedAt: null,
  tableSessionId: null,
  reason: '',
});
function mount(path = '/reservations', staff = false) {
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<ReservationLayout />}>
            <Route path="/reservations" element={<ReservationsPage />} />
            <Route path="/reservations/mine" element={<ReservationsPage mine />} />
            <Route path="/reservations/member" element={<MemberPage />} />
          </Route>
          <Route path="/staff/reservations" element={<ReservationsPage staff={staff} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  mock.member = member;
  mock.fail = 0;
  sessionStorage.clear();
  mock.get.mockImplementation(async (url: string, config?: { params?: { startsAt?: string } }) => {
    if (url === '/members/me') return result({ member: mock.member });
    if (url.endsWith('/availability')) {
      if (!config?.params?.startsAt) throw new Error('Search must include the selected time');
      return result({
        tables: [{ id: tableId, name: 'Bàn cửa sổ', code: 'B01', capacity: 4 }],
        startsAt: config.params.startsAt,
        endsAt: new Date(new Date(config.params.startsAt).getTime() + 3600000).toISOString(),
        durationMinutes: 60,
        graceMinutes: 15,
      });
    }
    if (url === '/table-sessions/current') throw new Error('Booking must not read a table session');
    return result({ items: [row()], total: 1 });
  });
  mock.post.mockImplementation(async (url: string) => {
    if (url === '/members/login') {
      mock.member = member;
      return result({ member });
    }
    if (mock.fail) throw { isAxiosError: true, message: 'Bàn vừa được đặt.', response: { status: mock.fail } };
    return result({ reservation: row() });
  });
});
afterEach(() => {
  cleanup();
  qc.clear();
  vi.clearAllMocks();
});
async function choose() {
  fireEvent.click(await screen.findByRole('button', { name: 'Tìm bàn trống' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Bàn cửa sổ · 4 chỗ' }));
}
describe('standalone reservation UI', () => {
  it('signs in through its own member route and never reads a QR session', async () => {
    mock.member = null;
    mount();
    fireEvent.click(await screen.findByRole('link', { name: 'Đăng nhập / Đăng ký' }));
    fireEvent.change(await screen.findByLabelText('Số điện thoại'), {
      target: { value: member.phone },
    });
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'Password@123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    await screen.findByRole('button', { name: 'Tìm bàn trống' });
    expect(mock.get.mock.calls.some(([url]) => url === '/table-sessions/current')).toBe(false);
    expect(screen.getByRole('link', { name: 'Tại quán' }).getAttribute('href')).toBe('/t');
  });
  it('searches in VN time, selects a table and creates only after explicit confirmation', async () => {
    mount();
    const at = '2026-10-23T10:30';
    fireEvent.change(await screen.findByLabelText('Ngày và giờ đến (giờ Việt Nam)'), {
      target: { value: at },
    });
    await choose();
    expect(mock.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đặt bàn' }));
    await screen.findByText('Đã giữ chỗ · DB-TEST');
    expect(mock.post.mock.calls[0]![0]).toBe('/reservations');
    expect(mock.post.mock.calls[0]![1]).toMatchObject({
      tableId,
      startsAt: '2026-10-23T03:30:00.000Z',
      partySize: 2,
      name: 'Lan',
      phone: member.phone,
    });
    expect(mock.post.mock.calls[0]![1]).not.toHaveProperty('tableSessionId');
  });
  it('clears a stale table choice when the time changes', async () => {
    mount();
    await choose();
    expect(screen.getByRole('button', { name: 'Xác nhận đặt bàn' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Số khách'), { target: { value: '5' } });
    expect(screen.queryByRole('button', { name: 'Xác nhận đặt bàn' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bàn cửa sổ · 4 chỗ' })).toBeNull();
    expect(mock.post).not.toHaveBeenCalled();
  });
  it('restores an uncertain request after reload and retries the identical payload', async () => {
    mock.fail = 502;
    mount();
    await choose();
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đặt bàn' }));
    await screen.findByRole('button', { name: 'Thử lại cùng yêu cầu' });
    const first = mock.post.mock.calls[0]![1];
    cleanup();
    qc.clear();
    mount();
    const retry = await screen.findByRole('button', { name: 'Thử lại cùng yêu cầu' });
    expect(screen.getByLabelText('Tên người đặt').matches(':disabled')).toBe(true);
    mock.fail = 0;
    fireEvent.click(retry);
    await screen.findByText('Đã giữ chỗ · DB-TEST');
    expect(mock.post.mock.calls[1]![1]).toEqual(first);
    expect(sessionStorage.length).toBe(0);
  });
  it('unlocks rejected bookings so another time can be selected', async () => {
    mock.fail = 409;
    mount();
    await choose();
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đặt bàn' }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Số khách').matches(':disabled')).toBe(false);
    expect(sessionStorage.length).toBe(0);
  });
  it('lets a member cancel an existing reservation with a reason and version', async () => {
    mount('/reservations/mine');
    fireEvent.click(await screen.findByRole('button', { name: 'Hủy lịch đặt' }));
    const cancel = screen.getByRole('button', { name: 'Xác nhận hủy lịch' });
    expect((cancel as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Lý do hủy lịch'), {
      target: { value: 'Đổi kế hoạch' },
    });
    fireEvent.click(cancel);
    await waitFor(() =>
      expect(mock.post).toHaveBeenCalledWith(`/reservations/${row().id}/cancel`, {
        expectedVersion: 0,
        reason: 'Đổi kế hoạch',
      }),
    );
  });
  it('checks in through the staff endpoint while keeping the counter form closed initially', async () => {
    mount('/staff/reservations', true);
    expect(screen.queryByRole('button', { name: 'Tìm bàn trống' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Xử lý lịch đặt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Khách đã đến — Check-in' }));
    await waitFor(() =>
      expect(mock.post).toHaveBeenCalledWith(`/staff/reservations/${row().id}/check-in`, {
        expectedVersion: 0,
      }),
    );
  });
});
