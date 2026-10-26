// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { FreestylePanel } from '../features/freestyle/FreestylePanel';
import { FreestyleAdmin } from '../features/freestyle/FreestyleAdmin';
import { useCart } from '../store/cart';
const mock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  api: mock,
}));
vi.mock('../lib/socket', () => ({ useSocketEvent: vi.fn() }));
vi.mock('../features/auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'admin' } }) }));
const response = (data: unknown) => ({ data: { success: true, data } });
const session = {
  active: true,
  tableSessionId: 'sid',
  participantId: 'guest',
  tableName: 'Bàn 1',
  status: 'OPEN',
};
const recipe = {
  name: 'Freestyle · Quả + Đào',
  instructions: 'Lắc đều.',
  caffeine: false,
  dairy: false,
  components: [{ name: 'Nước quả', quantity: 200, unit: 'ml' as const }],
};
const rec = {
  ...recipe,
  productId: '507f1f77bcf86cd799439011',
  token: 'signed-freestyle-token',
  unitPrice: 45000,
  sizeName: 'M',
  sizeMl: 350,
  reason: 'M · 350 ml',
  expiresAt: new Date(Date.now() + 1800000).toISOString(),
};
const defaults = { enabled: false, price: 0, sizeName: 'M', sizeMl: 350, bases: [], flavors: [] };
let qc: QueryClient;
function mount(element: JSX.Element) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{element}</MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  sessionStorage.clear();
  useCart.getState().setSession('sid', 'guest');
  useCart.getState().clear();
  mock.get.mockImplementation(async (url: string) =>
    response(
      url === '/table-sessions/current'
        ? session
        : url === '/members/me'
          ? { member: { id: 'member-a' } }
          : url === '/admin/freestyle'
            ? { settings: defaults, version: 0, ingredients: [] }
            : {
                enabled: true,
                price: 45000,
                sizeName: 'M',
                sizeMl: 350,
                bases: ['Quả'],
                flavors: ['Đào'],
              },
    ),
  );
  mock.post.mockImplementation(async (url: string) =>
    response(
      url.endsWith('/validate')
        ? { unitPrice: 45000, sizeName: 'M', freestyle: recipe }
        : { mode: 'fallback', message: 'Gợi ý theo quy tắc.', recommendations: [rec] },
    ),
  );
  mock.put.mockImplementation(async (_url: string, body: { settings: unknown }) =>
    response({ settings: body.settings, version: 1 }),
  );
});
afterEach(() => {
  cleanup();
  qc.clear();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});
const ask = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Gợi ý công thức' }));
  await screen.findByRole('button', { name: 'Thêm công thức vào giỏ' });
};
describe('Freestyle customer ordering', () => {
  it('checks QR context before loading recipes', async () => {
    mock.get.mockResolvedValue(response({ active: false }));
    mount(<FreestylePanel context="TABLE" />);
    expect(await screen.findByText(/Quét QR vào bàn đang mở/)).toBeTruthy();
    expect(mock.get).toHaveBeenCalledTimes(1);
  });
  it('shows disabled configuration and offers no suggestion action', async () => {
    mock.get.mockImplementation(async (url: string) =>
      response(url === '/table-sessions/current' ? session : { enabled: false }),
    );
    mount(<FreestylePanel context="TABLE" />);
    expect(await screen.findByText('Quán chưa mở Freestyle.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Gợi ý công thức' })).toBeNull();
  });
  it('sends preferences and validates canonical recipe and price before adding to the table cart', async () => {
    mount(<FreestylePanel context="TABLE" />);
    fireEvent.change(await screen.findByLabelText('Ngân sách Freestyle'), {
      target: { value: '50000' },
    });
    fireEvent.click(screen.getByLabelText('Không caffeine'));
    await ask();
    expect(mock.post.mock.calls[0]?.[1]).toMatchObject({
      context: 'TABLE',
      maxBudget: 50000,
      preferences: { noCaffeine: true },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm công thức vào giỏ' }));
    await waitFor(() => expect(useCart.getState().items).toHaveLength(1));
    expect(useCart.getState().items[0]).toMatchObject({
      freestyleToken: rec.token,
      freestyle: recipe,
      unitPrice: 45000,
      sugarLevel: 'Theo công thức',
      toppingIds: [],
    });
    expect(mock.post.mock.calls[1]).toEqual([
      '/ai/freestyle/validate',
      { context: 'TABLE', productId: rec.productId, token: rec.token },
    ]);
  });
  it('discards late validation after table identity changes', async () => {
    let resolve!: (value: unknown) => void;
    mock.post.mockImplementation(async (url: string) =>
      url.endsWith('/validate')
        ? new Promise((r) => {
            resolve = r;
          })
        : response({ message: 'Gợi ý', recommendations: [rec] }),
    );
    const onAdd = vi.fn();
    mount(<FreestylePanel context="TABLE" onAdd={onAdd} />);
    await ask();
    fireEvent.click(screen.getByRole('button', { name: 'Thêm công thức vào giỏ' }));
    await act(async () => {
      qc.setQueryData(['guest-session'], { ...session, participantId: 'other' });
      resolve(response({ unitPrice: 45000, sizeName: 'M', freestyle: recipe }));
    });
    expect(onAdd).not.toHaveBeenCalled();
    expect(useCart.getState().items).toEqual([]);
  });
  it('does not add a stale/short-stock suggestion rejected by the server', async () => {
    mock.post.mockImplementation(async (url: string) => {
      if (url.endsWith('/validate')) throw new Error('Không đủ nguyên liệu.');
      return response({ message: 'Gợi ý', recommendations: [rec] });
    });
    mount(<FreestylePanel context="TABLE" />);
    await ask();
    fireEvent.click(screen.getByRole('button', { name: 'Thêm công thức vào giỏ' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Không đủ nguyên liệu.');
    expect(useCart.getState().items).toEqual([]);
  });
  it('gates expired recommendations and clears results when preferences change', async () => {
    mock.post.mockResolvedValue(
      response({
        message: 'Cũ',
        recommendations: [{ ...rec, expiresAt: new Date(Date.now() - 1000).toISOString() }],
      }),
    );
    mount(<FreestylePanel context="TABLE" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Gợi ý công thức' }));
    expect(
      (
        (await screen.findByRole('button', {
          name: 'Đã hết hạn · tạo lại gợi ý',
        })) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByLabelText('Không sữa'));
    expect(screen.queryByText('Cũ')).toBeNull();
  });
  it('adds pickup recipes to the parent callback with member context', async () => {
    const onAdd = vi.fn();
    mount(<FreestylePanel context="PICKUP" onAdd={onAdd} />);
    await ask();
    fireEvent.click(screen.getByRole('button', { name: 'Thêm công thức vào giỏ' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledOnce());
    expect(mock.post.mock.calls[0]?.[1]).toMatchObject({ context: 'PICKUP' });
    expect(useCart.getState().items).toEqual([]);
  });
});
describe('Freestyle ADMIN configuration', () => {
  it('keeps typed comma separated tags and removes references when a flavor is deleted', async () => {
    mount(<FreestyleAdmin />);
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm vị' }));
    const tags = screen.getByLabelText('Từ khóa vị 1');
    fireEvent.change(tags, { target: { value: 'đào, ít ngọt' } });
    expect((tags as HTMLInputElement).value).toBe('đào, ít ngọt');
    fireEvent.blur(tags);
    expect((tags as HTMLInputElement).value).toBe('đào, ít ngọt');
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ vị 1' }));
    expect(screen.queryByLabelText('Tên vị 1')).toBeNull();
  });
  it('retries an uncertain save with the identical request ID and payload', async () => {
    mock.put.mockRejectedValueOnce(new Error('Mất kết nối.'));
    mount(<FreestyleAdmin />);
    fireEvent.click(await screen.findByRole('button', { name: 'Lưu cấu hình Freestyle' }));
    const retry = await screen.findByRole('button', { name: 'Thử lại lưu Freestyle' });
    expect(
      (screen.getByRole('button', { name: 'Lưu cấu hình Freestyle' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(retry);
    await waitFor(() => expect(mock.put).toHaveBeenCalledTimes(2));
    expect(mock.put.mock.calls[1]?.[1]).toEqual(mock.put.mock.calls[0]?.[1]);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Thử lại lưu Freestyle' })).toBeNull(),
    );
    expect(sessionStorage.getItem('mc-freestyle-save:admin')).toBeNull();
  });
  it('reloads the current server version before saving instead of reusing stale cached data', async () => {
    mount(<FreestyleAdmin />);
    await screen.findByLabelText('Giá Freestyle');
    mock.get.mockResolvedValue(
      response({ settings: { ...defaults, price: 55000 }, version: 7, ingredients: [] }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại bản đã lưu' }));
    await waitFor(() =>
      expect((screen.getByLabelText('Giá Freestyle') as HTMLInputElement).value).toBe('55000'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Lưu cấu hình Freestyle' }));
    await waitFor(() => expect(mock.put).toHaveBeenCalledOnce());
    expect(mock.put.mock.calls[0]?.[1]).toMatchObject({
      expectedVersion: 7,
      settings: { price: 55000 },
    });
  });
});
