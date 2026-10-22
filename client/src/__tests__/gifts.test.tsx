// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { GiftsPage } from '../features/gifts/GiftsPage';
import { ToastProvider } from '../components/ui/Toast';
import { useCart } from '../store/cart';
import type { GiftView } from '@may-cafe/contracts';

const mock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  active: true,
  participant: 'payer-a',
  rows: [] as GiftView[],
  fail: 0,
  tableSession: '507f1f77bcf86cd799439022',
}));
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  api: mock,
}));
const sid = '507f1f77bcf86cd799439011',
  tableId = '507f1f77bcf86cd799439012',
  productId = '507f1f77bcf86cd799439013';
const result = (data: unknown) => ({ data: { success: true, data } });
let qc: QueryClient;
const row = (extra: Partial<GiftView> = {}): GiftView => ({
  id: '507f1f77bcf86cd799439014',
  direction: 'RECEIVED',
  status: 'PENDING',
  recipientTableName: 'Bàn nhận',
  message: 'Chúc vui!',
  showSenderTable: false,
  version: 0,
  expiresAt: new Date(Date.now() + 300000).toISOString(),
  createdAt: new Date().toISOString(),
  orderStatus: null,
  items: [
    {
      productId,
      variantId: null,
      name: 'Trà đào',
      variantName: '',
      toppingNames: [],
      sugarLevel: '50%',
      iceLevel: 'normal-ice',
      toppingIds: [],
      note: '',
      quantity: 1,
    },
  ],
  ...extra,
});
function mount() {
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ToastProvider>
          <GiftsPage />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  sessionStorage.clear();
  mock.active = true;
  mock.participant = 'payer-a';
  mock.rows = [];
  mock.fail = 0;
  mock.tableSession = '507f1f77bcf86cd799439022';
  useCart.setState({
    tableSessionId: sid,
    participantId: 'payer-a',
    items: [
      {
        clientId: 'table-cart',
        productId,
        variantId: null,
        sizeName: null,
        name: 'Giỏ bàn',
        variantName: '',
        image: '',
        sugarLevel: '50%',
        iceLevel: 'normal-ice',
        toppingIds: [],
        note: '',
        unitPrice: 10000,
        quantity: 1,
      },
    ],
  });
  mock.get.mockImplementation(async (url: string) => {
    if (url === '/table-sessions/current')
      return result(
        mock.active
          ? {
              active: true,
              tableSessionId: sid,
              participantId: mock.participant,
              status: 'OPEN',
              table: { id: 'x', name: 'Bàn gửi', code: 'A' },
            }
          : { active: false, receiptAvailable: false },
      );
    if (url === '/gifts/tables')
      return result({
        items: [
          { tableId, sessionId: mock.tableSession, name: 'Bàn nhận', code: 'B', available: true },
          { tableId: 'empty', sessionId: '', name: 'Bàn trống', code: 'E', available: false },
        ],
      });
    if (url === '/gifts')
      return result({
        items: mock.rows,
        total: mock.rows.length,
        incomingCount: mock.rows.filter((g) => g.direction === 'RECEIVED' && g.status === 'PENDING')
          .length,
        page: 1,
      });
    if (url === '/categories')
      return result({
        products: [
          {
            _id: productId,
            name: 'Trà đào',
            description: '',
            image: '',
            basePrice: 30000,
            variants: [],
            allowedOptions: {
              sizes: [],
              sugarLevels: ['50%'],
              iceLevels: ['normal-ice'],
              toppingIds: [],
            },
            toppingIds: [],
            tags: [],
            isAvailable: true,
          },
        ],
        toppings: [],
      });
    throw new Error(`Unexpected read ${url}`);
  });
  mock.post.mockImplementation(async (url: string) => {
    if (mock.fail)
      throw { isAxiosError: true, message: 'Mất kết nối', response: { status: mock.fail } };
    if (url === '/orders/quote')
      return result({
        quoteToken: 'signed-quote-token',
        quoteId: 'quote',
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        total: 35000,
        items: [
          {
            productId,
            variantId: null,
            name: 'Trà đào',
            variantName: '',
            toppingNames: [],
            quantity: 1,
            unitPrice: 35000,
            lineTotal: 35000,
          },
        ],
      });
    return result({});
  });
});
afterEach(() => {
  cleanup();
  qc.clear();
  vi.clearAllMocks();
});
async function choose() {
  fireEvent.click(await screen.findByRole('button', { name: /Bàn nhận Có thể nhận quà/ }));
  fireEvent.click(await screen.findByRole('button', { name: /Trà đào 30/ }));
  fireEvent.click(await screen.findByRole('button', { name: /Thêm vào giỏ/ }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}
describe('anonymous gift UI', () => {
  it('requires an active QR session even if a member could be signed in', async () => {
    mock.active = false;
    mount();
    await screen.findByText('Quét QR tại bàn để gửi và nhận quà.');
    expect(mock.get.mock.calls.map(([url]) => url)).toEqual(['/table-sessions/current']);
    expect(mock.post).not.toHaveBeenCalled();
  });
  it('selects configured gift items in a separate draft, and sends only after explicit invitation', async () => {
    const before = useCart.getState().items;
    mount();
    await choose();
    expect((screen.getByRole('radio', { name: 'Ẩn danh' }) as HTMLInputElement).checked).toBe(true);
    expect(mock.post).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Bàn trống/ }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: '3. Lời nhắn' }), {
      target: { value: 'Một ngày vui' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi lời mời tặng quà' }));
    await waitFor(() => expect(mock.post).toHaveBeenCalledTimes(1));
    const [url, payload] = mock.post.mock.calls[0]!;
    expect(url).toBe('/gifts');
    expect(payload).toMatchObject({
      recipientTableId: tableId,
      recipientSessionId: mock.tableSession,
      message: 'Một ngày vui',
      showSenderTable: false,
      items: [{ productId, quantity: 1 }],
    });
    expect(payload.requestId).toMatch(
      /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-a[a-f\d]{3}-[a-f\d]{12}$/,
    );
    expect(useCart.getState().items).toEqual(before);
  });
  it('shows anonymous incoming gifts with explicit accept/decline and cannot create a recipient order', async () => {
    mock.rows = [row()];
    mount();
    await screen.findByText('Một món quà ẩn danh dành cho bàn bạn');
    expect(screen.queryByText('Xem giá & đặt quà')).toBeNull();
    expect(mock.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Nhận quà' }));
    await waitFor(() => expect(mock.post).toHaveBeenCalledTimes(1));
    expect(mock.post.mock.calls[0]!.slice(0, 2)).toEqual([
      `/gifts/${row().id}/decision`,
      { expectedVersion: 0, decision: 'ACCEPT' },
    ]);
  });
  it('lets the sender choose to show their table for this gift and resets the next draft to anonymous', async () => {
    mount();
    await choose();
    fireEvent.click(screen.getByRole('radio', { name: 'Hiện bàn gửi' }));
    fireEvent.click(screen.getByRole('button', { name: 'Gửi lời mời tặng quà' }));
    await waitFor(() => expect(mock.post).toHaveBeenCalledTimes(1));
    expect(mock.post.mock.calls[0]![1]).toMatchObject({ showSenderTable: true });
    await waitFor(() =>
      expect((screen.getByRole('radio', { name: 'Ẩn danh' }) as HTMLInputElement).checked).toBe(
        true,
      ),
    );
  });
  it('shows sender table details only for invitations that opted in', async () => {
    mock.rows = [row({ showSenderTable: true, senderTable: { name: 'Bàn cửa sổ', code: 'B01' } })];
    mount();
    await screen.findByText('Quà từ B01 · Bàn cửa sổ');
    expect(screen.queryByText('Một món quà ẩn danh dành cho bàn bạn')).toBeNull();
    mock.rows = [
      row({ showSenderTable: false, senderTable: { name: 'Không được hiện', code: 'PRIVATE' } }),
    ];
    await qc.invalidateQueries({ queryKey: ['gifts'] });
    await screen.findByText('Một món quà ẩn danh dành cho bàn bạn');
    expect(screen.queryByText(/PRIVATE/)).toBeNull();
  });
  it('quotes an accepted gift, displays the fresh price, and creates a sender order only after confirming it', async () => {
    mock.rows = [row({ direction: 'SENT', status: 'ACCEPTED', version: 1 })];
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Xem giá & đặt quà' }));
    const dialog = await screen.findByRole('dialog');
    expect(mock.post).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByText(/Tổng 35/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: /Xác nhận đặt/ }));
    await waitFor(() => expect(mock.post).toHaveBeenCalledTimes(2));
    expect(mock.post.mock.calls[1]![0]).toBe('/orders');
    expect(mock.post.mock.calls[1]![1]).toMatchObject({
      giftId: row().id,
      quoteToken: 'signed-quote-token',
    });
  });
  it('recovers an uncertain send through reload and reuses the exact payload/key', async () => {
    mock.fail = 503;
    const view = mount();
    await choose();
    fireEvent.click(screen.getByRole('radio', { name: 'Hiện bàn gửi' }));
    fireEvent.click(screen.getByRole('button', { name: 'Gửi lời mời tặng quà' }));
    await screen.findByText('Chưa rõ kết quả. Thử lại cùng yêu cầu để tránh gửi trùng.');
    const first = mock.post.mock.calls[0]!;
    view.unmount();
    qc.clear();
    mock.fail = 0;
    mount();
    const retry = await screen.findByRole('button', { name: 'Thử lại yêu cầu' });
    expect((screen.getByRole('radio', { name: 'Hiện bàn gửi' }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect(
      (screen.getByRole('radio', { name: 'Hiện bàn gửi' }) as HTMLInputElement).disabled ||
        screen.getByRole('radio', { name: 'Hiện bàn gửi' }).closest('fieldset[disabled]'),
    ).toBeTruthy();
    fireEvent.click(retry);
    await waitFor(() => expect(mock.post).toHaveBeenCalledTimes(2));
    expect(mock.post.mock.calls[1]).toEqual(first);
    await waitFor(() => expect(sessionStorage.length).toBe(0));
  });
  it('isolates pending actions by participant and never posts them under another identity', async () => {
    sessionStorage.setItem(
      `mc-gift-pending:${sid}:payer-a`,
      JSON.stringify({ url: '/gifts', payload: { secret: 'a' }, key: 'key-a' }),
    );
    mock.participant = 'payer-b';
    mount();
    await screen.findByRole('heading', { name: 'Gửi quà' });
    expect(screen.queryByRole('button', { name: 'Thử lại yêu cầu' })).toBeNull();
    expect(mock.post).not.toHaveBeenCalled();
  });
  it('requires reselecting a table when that table now has another session', async () => {
    mount();
    await choose();
    mock.tableSession = '507f1f77bcf86cd799439099';
    await qc.invalidateQueries({ queryKey: ['gift-tables'] });
    await screen.findByText('Bàn nhận vừa thay đổi. Hãy chọn lại bàn.');
    expect(
      screen.getByRole('button', { name: 'Gửi lời mời tặng quà' }).hasAttribute('disabled'),
    ).toBe(true);
    expect(mock.post).not.toHaveBeenCalled();
  });
  it('hides decisions for expired gifts and does not silently refresh a rejected quote into an order', async () => {
    mock.rows = [
      row({
        direction: 'SENT',
        status: 'ACCEPTED',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }),
    ];
    mount();
    await screen.findByText('Đã hết hạn');
    expect(screen.queryByRole('button', { name: 'Xem giá & đặt quà' })).toBeNull();
    expect(mock.post).not.toHaveBeenCalled();
  });
});
