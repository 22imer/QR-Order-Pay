// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Workforce } from '../features/staff/Workforce';
import type { WorkforceWeek, WorkShiftDto } from '@may-cafe/contracts';
const mock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  userId: '507f1f77bcf86cd799439011',
  listeners: new Map<string, () => void>(),
}));
vi.mock('../lib/socket', () => ({
  useSocketEvent: (event: string, callback: () => void) => {
    mock.listeners.set(event, callback);
  },
}));
vi.mock('../features/auth/useAuth', () => ({
  useAuth: (selector: (state: { user: { id: string } }) => unknown) =>
    selector({ user: { id: mock.userId } }),
}));
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  api: mock,
}));
const now = '2026-10-19T03:00:00.000Z';
const staffId = '507f1f77bcf86cd799439011';
const response = (data: unknown) => ({ data: { success: true, data } });
const shift = (extra: Partial<WorkShiftDto> = {}): WorkShiftDto => ({
  id: '507f1f77bcf86cd799439012',
  staffId,
  staffName: 'Lan',
  label: 'Ca sáng',
  startsAt: '2026-10-19T02:50:00.000Z',
  endsAt: '2026-10-19T05:00:00.000Z',
  status: 'SCHEDULED',
  note: '',
  clockInAt: null,
  clockOutAt: null,
  effectiveInAt: null,
  effectiveOutAt: null,
  correctionReason: '',
  correctedByName: '',
  cancelReason: '',
  version: 4,
  lateMinutes: 0,
  workedMinutes: null,
  attendance: 'WAITING',
  ...extra,
});
const week = (extra: Partial<WorkforceWeek> = {}): WorkforceWeek => ({
  from: '2026-10-19',
  until: '2026-10-26T00:00:00+07:00',
  now,
  shifts: [shift()],
  currentShift: null,
  staff: [{ id: staffId, name: 'Lan', isActive: true }],
  policy: { version: 0, rules: [], ordersPerStaffHour: 6 },
  peaks: null,
  cash: null,
  coverage: [],
  metrics: [],
  shiftMetrics: [],
  ...extra,
});
let qc: QueryClient;
function mount(admin = false) {
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Workforce admin={admin} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  mock.listeners.clear();
  mock.userId = staffId;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(now));
  mock.get.mockResolvedValue(response(week()));
  mock.post.mockResolvedValue(response({ shift: shift() }));
  mock.patch.mockResolvedValue(response({ shift: shift() }));
  mock.put.mockResolvedValue(response({ version: 1, rules: [] }));
});
afterEach(() => {
  cleanup();
  qc?.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe('workforce UI', () => {
  it.each([false, true])(
    'refreshes an already open workforce page on realtime change, admin=%s',
    async (admin) => {
      mount(admin);
      await screen.findByText('Lan · Ca sáng');
      mock.get.mockResolvedValue(
        response(week({ shifts: [shift({ label: 'Lịch cập nhật tức thì' })] })),
      );
      act(() => mock.listeners.get('workforce.changed')!());
      await screen.findByText('Lan · Lịch cập nhật tức thì');
      expect(screen.queryByText('Lan · Ca sáng')).toBeNull();
      expect(mock.get).toHaveBeenCalledTimes(2); // No clock advance or refresh button.
    },
  );
  it('refetches after reconnect to recover notifications missed while offline', async () => {
    mount();
    await screen.findByText('Lan · Ca sáng');
    mock.get.mockResolvedValue(
      response(week({ shifts: [shift({ label: 'Đã đổi khi offline' })] })),
    );
    act(() => mock.listeners.get('connect')!());
    await screen.findByText('Lan · Đã đổi khi offline');
  });
  it('shows a newly saved shift immediately and navigates to its date when outside the viewed week', async () => {
    const next = shift({
      label: 'Ca tuần sau',
      startsAt: '2026-10-26T02:00:00Z',
      endsAt: '2026-10-26T05:00:00Z',
    });
    mock.post.mockImplementation(async () => {
      mock.get.mockResolvedValue(response(week({ shifts: [next] })));
      return response({ shift: next });
    });
    mount(true);
    await screen.findByText('Lan · Ca sáng');
    fireEvent.click(screen.getByRole('button', { name: 'Xếp ca' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await screen.findByText('Lan · Ca tuần sau');
    expect(mock.get).toHaveBeenCalledWith('/admin/workforce', { params: { from: '2026-10-26' } });
  });
  it('opens a draft from historical demand and saves only after administrator review', async () => {
    mock.get.mockResolvedValue(
      response(
        week({
          policy: { version: 2, rules: [], ordersPerStaffHour: 4 },
          peaks: {
            from: '2026-09-20T17:00:00Z',
            until: '2026-10-18T17:00:00Z',
            weeks: 4,
            paidOrders: 24,
            minimumOrders: 20,
            ordersPerStaffHour: 4,
            enoughData: true,
            items: [
              {
                day: 1,
                hour: 7,
                orders: 24,
                occurrences: 4,
                averageOrders: 6,
                recommendedStaff: 2,
              },
            ],
          },
        }),
      ),
    );
    mount(true);
    await screen.findByText('Lan · Ca sáng');
    fireEvent.click(screen.getByRole('button', { name: 'Nhu cầu nhân sự' }));
    expect(screen.getByText('Gợi ý tối thiểu 2 người')).toBeTruthy();
    expect(mock.put).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Dùng gợi ý Thứ 2 07:00' }));
    expect((screen.getByLabelText('Số người tối thiểu') as HTMLInputElement).value).toBe('2');
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() =>
      expect(mock.put).toHaveBeenCalledWith('/admin/workforce/policy', {
        expectedVersion: 2,
        ordersPerStaffHour: 4,
        rules: [{ day: 1, startMinute: 420, endMinute: 480, minStaff: 2, label: 'Cao điểm 07:00' }],
      }),
    );
  });
  it('shows closed cash shift evidence separately from employee performance', async () => {
    mock.get.mockResolvedValue(
      response(
        week({
          cash: {
            total: 60,
            closedCount: 60,
            totalDifference: -600,
            items: [
              {
                id: 'cash1',
                code: 'CA01',
                status: 'CLOSED',
                openedAt: now,
                closedAt: now,
                openedByName: 'Người thu',
                closedByName: 'Người chốt',
                expectedCash: 100,
                countedCash: 90,
                difference: -10,
                reconciliationNote: 'Đã ghi lý do thiếu',
              },
            ],
          },
        }),
      ),
    );
    mount(true);
    await screen.findByText('Lan · Ca sáng');
    fireEvent.click(screen.getByRole('button', { name: 'Đối soát ca thu ngân' }));
    expect(screen.getByText(/Người thu/).textContent).toContain('Người chốt');
    expect(screen.getByText('Đã ghi lý do thiếu')).toBeTruthy();
    expect(screen.getByText(/Hiển thị 1\/60 ca/)).toBeTruthy();
    expect(screen.getByText(/60 ca chốt trong tuần/).textContent).toContain('-600');
  });
  it('previews copying, prevents conflicting confirmation and retries the same request after a lost response', async () => {
    const p = {
      from: '2026-10-19',
      targetFrom: '2026-10-26',
      snapshot: 'a'.repeat(64),
      shifts: [
        {
          sourceId: 's1',
          staffId,
          staffName: 'Lan',
          label: 'Ca sáng',
          startsAt: '2026-10-26T02:00:00Z',
          endsAt: '2026-10-26T05:00:00Z',
          note: '',
        },
      ],
      conflicts: [] as Array<{ staffName: string; label: string; reason: string }>,
    };
    let copies = 0;
    mock.post.mockImplementation(async (url: string) => {
      if (url.endsWith('copy-preview')) return response(p);
      if (++copies === 1) throw new Error('Mất kết nối');
      return response({ count: 1 });
    });
    mount(true);
    await screen.findByText('Lan · Ca sáng');
    fireEvent.click(screen.getByRole('button', { name: 'Sao chép lịch tuần' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xem trước lịch sao chép' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Xác nhận sao chép 1 ca' }));
    await screen.findByRole('button', { name: 'Thử lại sao chép' });
    const body = mock.post.mock.calls.find((c) => c[0].endsWith('/copy'))![1];
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại sao chép' }));
    await screen.findByText('Đã sao chép 1 ca.');
    expect(mock.post.mock.calls.filter((c) => c[0].endsWith('/copy')).map((c) => c[1])).toEqual([
      body,
      body,
    ]);
    expect(mock.get).toHaveBeenCalledWith('/admin/workforce', { params: { from: '2026-10-26' } });
  });
  it('disables copying when preview reports a conflict', async () => {
    mock.post.mockResolvedValue(
      response({
        from: '2026-10-19',
        targetFrom: '2026-10-26',
        snapshot: 'a'.repeat(64),
        shifts: [],
        conflicts: [{ staffName: 'Lan', label: 'Ca sáng', reason: 'Trùng lịch ca đã có' }],
      }),
    );
    mount(true);
    await screen.findByText('Lan · Ca sáng');
    fireEvent.click(screen.getByRole('button', { name: 'Sao chép lịch tuần' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xem trước lịch sao chép' }));
    const button = await screen.findByRole('button', { name: 'Xác nhận sao chép 0 ca' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(mock.post).toHaveBeenCalledTimes(1);
  });
  it('exports staff attendance through the own-scope endpoint using a safe filename', async () => {
    class DownloadURL extends URL {
      static override createObjectURL = vi.fn(() => 'blob:test');
      static override revokeObjectURL = vi.fn();
    }
    vi.stubGlobal('URL', DownloadURL);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    mock.get.mockImplementation(async (url: string) =>
      url.endsWith('/export') ? { data: new Blob(['csv']) } : response(week()),
    );
    mount();
    await screen.findByText('Lan · Ca sáng');
    fireEvent.click(screen.getByRole('button', { name: 'Xuất bảng công CSV' }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(mock.get).toHaveBeenCalledWith('/staff/workforce/export', {
      params: { from: '2026-10-19' },
      responseType: 'blob',
    });
    expect(DownloadURL.createObjectURL).toHaveBeenCalledTimes(1);
  });
  it('does not reuse another employee cached schedule after switching accounts', async () => {
    const view = mount();
    await screen.findByText('Lan · Ca sáng');
    mock.userId = '507f1f77bcf86cd799439099';
    let finish!: (value: ReturnType<typeof response>) => void;
    mock.get.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    view.rerender(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <Workforce />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.queryByText('Lan · Ca sáng')).toBeNull();
    finish(response(week({ shifts: [] })));
    await screen.findAllByText('Chưa có lịch ca.');
  });
  it('can create request IDs on HTTP LAN browsers without crypto.randomUUID', async () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    mount(true);
    await screen.findByText('Lan · Ca sáng');
    fireEvent.click(screen.getByRole('button', { name: 'Xếp ca' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() =>
      expect(mock.post).toHaveBeenCalledWith(
        '/admin/workforce/shifts',
        expect.objectContaining({
          requestId: expect.stringMatching(
            /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/,
          ),
        }),
      ),
    );
  });
  it('limits staff controls to own server-timed punches and sends expectedVersion', async () => {
    mount();
    const button = await screen.findByRole('button', { name: 'Vào ca' });
    expect(screen.queryByRole('button', { name: 'Xếp ca' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sửa lịch' })).toBeNull();
    fireEvent.click(button);
    await waitFor(() =>
      expect(mock.post).toHaveBeenCalledWith(`/staff/workforce/${shift().id}/clock-in`, {
        expectedVersion: 4,
      }),
    );
    expect(mock.get).toHaveBeenCalledWith('/staff/workforce', { params: { from: '2026-10-19' } });
  });
  it('keeps the active shift out button when viewing another week', async () => {
    mock.get.mockResolvedValue(
      response(
        week({
          shifts: [],
          currentShift: shift({
            status: 'WORKING',
            attendance: 'WORKING',
            effectiveInAt: now,
            clockInAt: now,
          }),
        }),
      ),
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Tuần sau' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ra ca' }));
    await waitFor(() =>
      expect(mock.post).toHaveBeenCalledWith(`/staff/workforce/${shift().id}/clock-out`, {
        expectedVersion: 4,
      }),
    );
  });
  it('submits schedule times explicitly in Vietnam timezone and allows overnight', async () => {
    mount(true);
    await screen.findByText('Lan · Ca sáng');
    fireEvent.click(screen.getByRole('button', { name: 'Xếp ca' }));
    fireEvent.change(screen.getByLabelText('Tên ca'), { target: { value: 'Ca đêm' } });
    fireEvent.change(screen.getByLabelText('Bắt đầu (giờ Việt Nam)'), {
      target: { value: '2026-10-19T22:00' },
    });
    fireEvent.change(screen.getByLabelText('Kết thúc (giờ Việt Nam)'), {
      target: { value: '2026-10-20T02:00' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() =>
      expect(mock.post).toHaveBeenCalledWith(
        '/admin/workforce/shifts',
        expect.objectContaining({
          staffId,
          label: 'Ca đêm',
          startsAt: '2026-10-19T15:00:00.000Z',
          endsAt: '2026-10-19T19:00:00.000Z',
          requestId: expect.any(String),
        }),
      ),
    );
  });
  it('retains an ambiguous write and retries the identical payload/key without allowing edits', async () => {
    mock.post.mockRejectedValueOnce(new Error('Mất kết nối'));
    mount(true);
    await screen.findByText('Lan · Ca sáng');
    fireEvent.click(screen.getByRole('button', { name: 'Xếp ca' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await screen.findByText('Chưa rõ kết quả ghi nhận. Giữ nguyên yêu cầu để thử lại an toàn.');
    const first = mock.post.mock.calls[0];
    expect(
      (screen.getByLabelText('Tên ca') as HTMLInputElement).closest('fieldset')?.disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại yêu cầu' }));
    await waitFor(() => expect(mock.post).toHaveBeenCalledTimes(2));
    expect(mock.post.mock.calls[1]).toEqual(first);
    await screen.findByText('Đã ghi nhận.');
  });
  it('shows a stale version error without claiming success and keeps the correction form', async () => {
    mock.post.mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: { error: { message: 'Ca đã thay đổi. Hãy tải lại.' } } },
    });
    mount(true);
    await screen.findByText('Lan · Ca sáng');
    fireEvent.click(screen.getByRole('button', { name: 'Điều chỉnh giờ' }));
    fireEvent.change(screen.getByLabelText('Lý do điều chỉnh'), {
      target: { value: 'Quên ra ca' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Ca đã thay đổi. Hãy tải lại.');
    expect(screen.queryByText('Đã ghi nhận.')).toBeNull();
    expect((screen.getByLabelText('Lý do điều chỉnh') as HTMLInputElement).value).toBe(
      'Quên ra ca',
    );
    expect(mock.post).toHaveBeenCalledWith(
      `/admin/workforce/shifts/${shift().id}/attendance`,
      expect.objectContaining({ expectedVersion: 4, reason: 'Quên ra ca' }),
    );
  });
  it('shows minimum coverage and actual presence separately; adds and saves a staffing rule', async () => {
    mock.get.mockResolvedValue(
      response(
        week({
          coverage: [
            {
              label: 'Cao điểm thử',
              startsAt: now,
              endsAt: '2026-10-19T04:00:00Z',
              required: 3,
              scheduled: 1,
              shortage: 2,
              presentNow: 0,
            },
          ],
        }),
      ),
    );
    mount(true);
    await screen.findByText('Lan · Ca sáng');
    fireEvent.click(screen.getByRole('button', { name: 'Nhu cầu nhân sự' }));
    expect(screen.getByText('Đã xếp 1/3 người · Thiếu 2')).toBeTruthy();
    expect(screen.getByText('Đang chấm công 0/3 người')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cấu hình nhu cầu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thêm khung giờ' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Lưu' }));
    await waitFor(() =>
      expect(mock.put).toHaveBeenCalledWith('/admin/workforce/policy', {
        expectedVersion: 0,
        ordersPerStaffHour: 6,
        rules: [{ label: 'Cao điểm sáng', day: 1, startMinute: 420, endMinute: 540, minStaff: 2 }],
      }),
    );
  });
  it('explains missing performance samples and shows overnight shifts on both days', async () => {
    mock.get.mockResolvedValue(
      response(
        week({
          shifts: [
            shift({
              startsAt: '2026-10-19T15:00:00Z',
              endsAt: '2026-10-19T19:00:00Z',
              label: 'Ca đêm',
            }),
          ],
          metrics: [
            {
              staffId,
              staffName: 'Lan',
              scheduledMinutes: 240,
              workedMinutes: 0,
              openAttendances: 1,
              absentShifts: 0,
              lateShifts: 0,
              confirmed: 1,
              preparing: 0,
              ready: 0,
              served: 0,
              outsideShiftActions: 1,
              preparationSamples: 0,
              averagePreparationMinutes: null,
              reviewedOrders: 0,
              averageOrderRating: null,
            },
          ],
        }),
      ),
    );
    mount();
    await waitFor(() => expect(screen.getAllByText('Lan · Ca đêm')).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: 'Hiệu suất' }));
    expect(screen.getAllByText('Chưa có mẫu')).toHaveLength(2);
    expect(screen.getByText(/Sao là đánh giá đơn/)).toBeTruthy();
  });
});
