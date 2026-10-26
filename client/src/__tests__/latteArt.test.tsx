// @vitest-environment jsdom
import { useState } from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { CupPhotoPicker } from '../features/cupPhotos/CupPhotoPicker';
import { CupPrintPage } from '../features/cupPhotos/CupPrintPage';
import { useCupPhotoBusy } from '../features/cupPhotos/useCupPhotoBusy';
import { CartPage } from '../features/guest/CartPage';
import { useCart } from '../store/cart';
import { ToastProvider } from '../components/ui/Toast';

const mock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), change: vi.fn(), busy: vi.fn() }));
vi.mock('../lib/api', async (original) => ({ ...(await original<typeof import('../lib/api')>()), api: mock }));
vi.mock('../lib/socket', () => ({ useSocketEvent: vi.fn() }));
vi.mock('../features/insights/CompanionSuggestions', () => ({ CompanionSuggestions: () => null }));
const sourceId = '507f1f77bcf86cd799439010', orderId = '507f1f77bcf86cd799439020';
const variants = ['SOFT', 'BOLD', 'DOTS'].map((style, index) => ({ id: `507f1f77bcf86cd79943901${index + 1}`, kind: 'LATTE_ART', latteStyle: style, width: 1024, height: 1024, expiresAt: new Date(Date.now() + 86400000).toISOString() }));
const response = (data: unknown) => ({ data: { success: true, data } });
let qc: QueryClient, print: ReturnType<typeof vi.spyOn>;
function Picker({ initial }: { initial?: string }) {
  const [id, setId] = useState(initial);
  return <CupPhotoPicker label="Ảnh cho cà phê" photoId={id} onBusyChange={mock.busy} onChange={(value) => { mock.change(value); setId(value); }} />;
}
function mount(element = <Picker />) {
  return render(<QueryClientProvider client={qc}><MemoryRouter>{element}</MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  mock.get.mockReset(); mock.post.mockReset(); mock.change.mockReset(); mock.busy.mockReset();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  let urls = 0;
  vi.stubGlobal('URL', class extends URL {
    static override createObjectURL = vi.fn(() => `blob:latte-${++urls}`);
    static override revokeObjectURL = vi.fn();
  });
  print = vi.spyOn(window, 'print').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  mock.get.mockImplementation(async (url: string) => {
    if (url === '/table-sessions/current') return response({ active: true, tableSessionId: orderId, participantId: 'latte-guest', status: 'OPEN', table: { name: 'Bàn 1' } });
    if (url === '/members/me') return response({ member: null });
    if (url.endsWith('/details')) return response(variants.find((v) => url.includes(v.id)));
    if (url.includes('/image') || url.includes('/cup-photos/')) return { data: new Blob(['jpeg'], { type: 'image/jpeg' }) };
    return response({ items: [{ id: orderId, code: 'MC-LATTE', destination: 'Bàn 1', status: 'PENDING', createdAt: new Date().toISOString(), items: [{ index: 0, name: 'Cappuccino', size: 'M', quantity: 2, available: true, attempts: 0, kind: 'LATTE_ART', latteStyle: 'BOLD' }] }], total: 1, pages: 1 });
  });
  mock.post.mockImplementation(async (url: string) => {
    if (url.endsWith('/latte-art')) return response({ sourceId, variants });
    if (url.endsWith('/latte-art/exports')) return { data: new Blob(['png'], { type: 'image/png' }) };
    return response({ id: sourceId, width: 200, height: 120, expiresAt: new Date().toISOString() });
  });
});
afterEach(() => { cleanup(); qc.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function generate() {
  fireEvent.click(screen.getByLabelText('Latte art trên bọt', { exact: true }));
  fireEvent.change(screen.getByLabelText('Ảnh cho cà phê · latte art'), { target: { files: [new File(['jpeg'], 'portrait.jpg', { type: 'image/jpeg' })] } });
  await screen.findByRole('button', { name: 'Chọn Chấm nghệ thuật' });
  for (const image of screen.getAllByAltText(/^Xem trước /)) fireEvent.load(image);
}
describe('customer latte art selection and private export', () => {
  it('keeps real cart choices enabled while checkout waits for a latte selection', async () => {
    useCart.getState().setSession(orderId, 'latte-guest');
    useCart.getState().add({ productId: sourceId, variantId: null, sizeName: null, sugarLevel: '50%', iceLevel: 'normal-ice', toppingIds: [], note: '', quantity: 1, unitPrice: 30000, name: 'Cà phê', variantName: '', image: '' });
    const view = mount(<ToastProvider><CartPage /></ToastProvider>);
    await screen.findByRole('button', { name: 'Đặt món' });
    fireEvent.click(screen.getByLabelText('Latte art trên bọt', { exact: true }));
    fireEvent.change(screen.getByLabelText('Ảnh cho Cà phê · latte art'), { target: { files: [new File(['jpeg'], 'portrait.jpg', { type: 'image/jpeg' })] } });
    const choice = await screen.findByRole('button', { name: 'Chọn Cacao đậm' });
    fireEvent.load(screen.getByAltText('Xem trước Cacao đậm'));
    await waitFor(() => expect(choice.matches(':disabled')).toBe(false));
    expect(screen.getByRole('button', { name: 'Đặt món' }).matches(':disabled')).toBe(true);
    fireEvent.click(choice);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Đặt món' }).matches(':disabled')).toBe(false));
    expect(useCart.getState().items[0]!.cupPhotoId).toBe(variants[1]!.id);
    view.unmount(); useCart.getState().resetSession();
  });
  it('shows exactly three options without attaching the source and blocks checkout until explicit choice', async () => {
    mount(); await generate();
    expect(screen.getAllByRole('button', { name: /^Chọn / })).toHaveLength(3);
    expect(mock.change.mock.calls.every((call) => call[0] === undefined)).toBe(true);
    expect(mock.busy.mock.calls.at(-1)![0]).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Chọn Cacao đậm' }));
    await waitFor(() => expect(mock.change).toHaveBeenLastCalledWith(variants[1]!.id));
    expect(mock.busy.mock.calls.at(-1)![0]).toBe(false);
    await screen.findByAltText('Latte art đã chọn trên bọt mô phỏng');
    expect(print).not.toHaveBeenCalled();
  });
  it('retries generation from the uploaded source without uploading twice and cancels unselected designs', async () => {
    let failed = false;
    const implementation = mock.post.getMockImplementation()!;
    mock.post.mockImplementation(async (url: string, ...args: unknown[]) => {
      if (url.endsWith('/latte-art') && !failed) { failed = true; throw new Error('offline'); }
      return implementation(url, ...args);
    });
    mount();
    fireEvent.click(screen.getByLabelText('Latte art trên bọt', { exact: true }));
    fireEvent.change(screen.getByLabelText('Ảnh cho cà phê · latte art'), { target: { files: [new File(['jpeg'], 'portrait.jpg', { type: 'image/jpeg' })] } });
    await screen.findByText('offline'); fireEvent.click(screen.getByRole('button', { name: 'Thử lại tạo latte art' }));
    await screen.findByRole('button', { name: 'Chọn Latte mềm' });
    expect(mock.post.mock.calls.filter((call) => call[0] === '/cup-photos')).toHaveLength(1);
    expect(mock.post.mock.calls.filter((call) => call[0].endsWith('/latte-art')).map((call) => call.slice(0, 2))).toEqual([[`/cup-photos/${sourceId}/latte-art`, {}], [`/cup-photos/${sourceId}/latte-art`, {}]]);
    fireEvent.click(screen.getByRole('button', { name: 'Hủy tạo latte art' }));
    expect(mock.busy.mock.calls.at(-1)![0]).toBe(false);
    expect(mock.change.mock.calls.every((call) => call[0] === undefined)).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);
  });
  it('restores a selected latte design after reload and removes it explicitly', async () => {
    mount(<Picker initial={variants[2]!.id} />);
    await screen.findByAltText('Latte art đã chọn trên bọt mô phỏng');
    expect((screen.getByLabelText('Latte art trên bọt') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ ảnh latte art' }));
    expect(mock.change).toHaveBeenLastCalledWith(undefined);
  });
  it('does not attach a late upload after the owner unmounts', async () => {
    let resolve!: (value: unknown) => void;
    mock.post.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const view = mount();
    fireEvent.click(screen.getByLabelText('Latte art trên bọt'));
    fireEvent.change(screen.getByLabelText('Ảnh cho cà phê · latte art'), { target: { files: [new File(['jpeg'], 'portrait.jpg', { type: 'image/jpeg' })] } });
    view.unmount();
    await act(async () => { resolve(response({ id: sourceId })); });
    expect(mock.change.mock.calls.every((call) => call[0] === undefined)).toBe(true);
    expect(mock.busy.mock.calls.at(-1)![0]).toBe(false);
    expect(mock.post).toHaveBeenCalledTimes(1);
  });
  it('exports the chosen PNG with an exact retry and never opens label printing or claims a physical print', async () => {
    mount(<CupPrintPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Xem & xuất latte art' }));
    fireEvent.load(await screen.findByAltText('Latte art MC-LATTE dòng 1'));
    mock.post.mockRejectedValueOnce(new Error('lost response'));
    fireEvent.click(screen.getByRole('button', { name: 'Tải PNG cho máy in đồ uống' }));
    await screen.findByText('lost response');
    const first = mock.post.mock.calls[0];
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại xuất PNG' }));
    await screen.findByText('Đã chuẩn bị file PNG để tải. Đây chưa phải xác nhận in lên bọt.');
    expect(mock.post.mock.calls[1]).toEqual(first);
    expect(first![0]).toBe('/staff/cup-prints/latte-art/exports');
    expect(print).not.toHaveBeenCalled();
    expect(document.getElementById('cup-photo-print-sheet')).toBeNull();
    expect(document.body.dataset.cupPrint).toBeUndefined();
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
  });
  it('keeps checkout locked until every row finishes choosing', () => {
    function Rows() {
      const { photoBusy, setPhotoBusy } = useCupPhotoBusy();
      return <><button onClick={() => { setPhotoBusy('one', true); setPhotoBusy('two', true); }}>Start</button><button onClick={() => setPhotoBusy('one', false)}>First done</button><button onClick={() => setPhotoBusy('two', false)}>Second done</button><button disabled={photoBusy}>Place</button></>;
    }
    mount(<Rows />); fireEvent.click(screen.getByText('Start')); fireEvent.click(screen.getByText('First done'));
    expect(screen.getByText('Place').hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByText('Second done')); expect(screen.getByText('Place').hasAttribute('disabled')).toBe(false);
  });
});
