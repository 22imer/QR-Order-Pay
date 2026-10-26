// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { CupPhotoPicker } from '../features/cupPhotos/CupPhotoPicker';
import { CupPrintPage } from '../features/cupPhotos/CupPrintPage';
import type { CupPrintOrder } from '@may-cafe/contracts';
const mock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  events: new Map<string, () => void>(),
}));
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  api: mock,
}));
vi.mock('../lib/socket', () => ({
  useSocketEvent: (event: string, cb: () => void) => mock.events.set(event, cb),
}));
const id = '507f1f77bcf86cd799439011',
  pid = '507f1f77bcf86cd799439012';
const response = (data: unknown) => ({ data: { success: true, data } });
const photo = {
  id: pid,
  width: 200,
  height: 120,
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
};
const order: CupPrintOrder = {
  id,
  code: 'MC-PHOTO',
  status: 'PENDING',
  destination: 'Bàn 1',
  createdAt: new Date().toISOString(),
  items: [{ index: 0, name: 'Cà phê', size: 'M', quantity: 3, available: true, attempts: 0 }],
};
let qc: QueryClient, print: ReturnType<typeof vi.spyOn>;
const png = () => new File(['PNG fixture'], 'private-name.png', { type: 'image/png' });
function wrapper(element: JSX.Element) {
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{element}</MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  mock.get.mockReset();
  mock.post.mockReset();
  mock.events.clear();
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  vi.stubGlobal(
    'URL',
    class extends URL {
      static override createObjectURL = vi.fn(() => 'blob:private-photo');
      static override revokeObjectURL = vi.fn();
    },
  );
  print = vi.spyOn(window, 'print').mockImplementation(() => {});
  mock.get.mockImplementation(async (url: string) =>
    url.includes('/image') || /cup-photos\//.test(url)
      ? { data: new Blob(['jpeg'], { type: 'image/jpeg' }) }
      : response({ items: [order], total: 1, pages: 1 }),
  );
  mock.post.mockResolvedValue(response(photo));
});
afterEach(() => {
  cleanup();
  qc.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('private photo picker', () => {
  it('accepts images only, checks size/type client-side and sends no request for invalid files', async () => {
    wrapper(<CupPhotoPicker label="Ảnh cho cà phê" onChange={vi.fn()} onBusyChange={vi.fn()} />);
    const input = screen.getByLabelText('Ảnh cho cà phê');
    fireEvent.change(input, {
      target: { files: [new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' })] },
    });
    await screen.findByRole('alert');
    fireEvent.change(input, {
      target: {
        files: [
          new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }),
        ],
      },
    });
    expect(mock.post).not.toHaveBeenCalled();
    expect(input.getAttribute('accept')).not.toContain('svg');
  });
  it('uploads bytes with MIME and UUID, exposes only normalized photo ID and busy lifecycle', async () => {
    const change = vi.fn(),
      busy = vi.fn(),
      file = png();
    wrapper(<CupPhotoPicker label="Ảnh" onChange={change} onBusyChange={busy} />);
    fireEvent.change(screen.getByLabelText('Ảnh'), { target: { files: [file] } });
    await waitFor(() => expect(change).toHaveBeenCalledWith(pid));
    expect(mock.post).toHaveBeenCalledWith('/cup-photos', file, {
      headers: {
        'Content-Type': 'image/png',
        'Idempotency-Key': expect.stringMatching(/^[a-f\d-]{36}$/),
      },
    });
    expect(busy.mock.calls.map((c) => c[0])).toEqual([true, false]);
    expect(print).not.toHaveBeenCalled();
  });
  it('retries uncertain upload with exact bytes/key and does not replace the current photo on failure', async () => {
    mock.post.mockRejectedValueOnce(new Error('offline'));
    const change = vi.fn();
    wrapper(<CupPhotoPicker label="Ảnh" photoId={pid} onChange={change} onBusyChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Ảnh'), { target: { files: [png()] } });
    await screen.findByText('offline');
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại tải ảnh' }));
    await waitFor(() => expect(change).toHaveBeenCalledWith(pid));
    expect(mock.post.mock.calls[1]).toEqual(mock.post.mock.calls[0]);
  });
  it('fetches private image as blob, removes attachment and revokes preview URL on unmount', async () => {
    const change = vi.fn(),
      view = wrapper(
        <CupPhotoPicker
          label="Ảnh"
          photoId={pid}
          endpoint="/pickup/cup-photos"
          onChange={change}
          onBusyChange={vi.fn()}
        />,
      );
    expect((await screen.findAllByAltText('Ảnh xem trước để in tem'))[0]!.getAttribute('src')).toBe(
      'blob:private-photo',
    );
    expect(mock.get).toHaveBeenCalledWith(`/pickup/cup-photos/${pid}`, { responseType: 'blob' });
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ ảnh' }));
    expect(change).toHaveBeenCalledWith(undefined);
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private-photo');
  });
  it('cleans up an in-flight upload and ignores late response after the cart identity unmounts', async () => {
    let resolve!: (data: unknown) => void;
    mock.post.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const change = vi.fn(),
      busy = vi.fn();
    const view = wrapper(<CupPhotoPicker label="Ảnh" onChange={change} onBusyChange={busy} />);
    fireEvent.change(screen.getByLabelText('Ảnh'), { target: { files: [png()] } });
    view.unmount();
    await act(async () => {
      resolve(response(photo));
    });
    expect(change).not.toHaveBeenCalled();
    expect(busy.mock.calls.at(-1)![0]).toBe(false);
  });
  it('shows an expired-image error and allows dropping the attachment', async () => {
    mock.get.mockRejectedValue(new Error('expired'));
    wrapper(<CupPhotoPicker label="Ảnh" photoId={pid} onChange={vi.fn()} onBusyChange={vi.fn()} />);
    await screen.findByText('Ảnh không còn truy cập được. Hãy bỏ ảnh hoặc tải lại.');
    expect(screen.getByRole('button', { name: 'Bỏ ảnh' }).hasAttribute('disabled')).toBe(false);
  });
});
describe('staff cup label preview and intent', () => {
  async function preview(admin = false) {
    const view = wrapper(<CupPrintPage admin={admin} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Xem & in tem' }));
    const image = (await screen.findAllByAltText('Ảnh tem MC-PHOTO cốc 1'))[0]!;
    fireEvent.load(image);
    return view;
  }
  it('does not request printing or fetch image bytes just by entering the list', async () => {
    wrapper(<CupPrintPage />);
    await screen.findByText('MC-PHOTO');
    expect(mock.post).not.toHaveBeenCalled();
    expect(print).not.toHaveBeenCalled();
    expect(mock.get.mock.calls.every((c) => !c[0].includes('/image'))).toBe(true);
  });
  it('loads protected photo, previews exact order/line/cup labels and creates A4 print portal', async () => {
    await preview();
    expect(mock.get).toHaveBeenCalledWith(`/staff/cup-prints/${id}/0/image`, {
      responseType: 'blob',
    });
    expect(document.body.dataset.cupPrint).toBe('true');
    const sheet = document.getElementById('cup-photo-print-sheet')!;
    expect(sheet.querySelectorAll('article')).toHaveLength(3);
    expect(sheet.textContent).toContain('Cốc 3/3');
    expect(sheet.textContent).toContain('Dòng 1');
    expect(sheet.textContent).toContain('Bàn 1');
    expect(sheet.className).toBe('cup-sheet-a4');
    fireEvent.click(screen.getByRole('button', { name: 'In tem' }));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(mock.post).toHaveBeenCalledWith(
      '/staff/cup-prints',
      expect.objectContaining({ orderId: id, itemIndex: 0, copies: 3, paper: 'A4' }),
    );
  });
  it('supports label paper, validates copies and never prints before the image decodes', async () => {
    wrapper(<CupPrintPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Xem & in tem' }));
    (await screen.findAllByAltText('Ảnh tem MC-PHOTO cốc 1'))[0]!;
    expect(screen.getByRole('button', { name: 'In tem' }).hasAttribute('disabled')).toBe(true);
    fireEvent.load(screen.getAllByAltText('Ảnh tem MC-PHOTO cốc 1')[0]!);
    fireEvent.change(screen.getByLabelText('Khổ giấy'), { target: { value: 'LABEL_60_80' } });
    fireEvent.change(screen.getByLabelText('Số tem'), { target: { value: '4' } });
    expect(screen.getByRole('button', { name: 'In tem' }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Số tem'), { target: { value: '2' } });
    expect(
      document.getElementById('cup-photo-print-sheet')!.querySelectorAll('article'),
    ).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'In tem' }));
    await waitFor(() => expect(print).toHaveBeenCalled());
    expect(mock.post.mock.calls[0]![1]).toMatchObject({ copies: 2, paper: 'LABEL_60_80' });
  });
  it('keeps uncertain request immutable and retries the exact print intent', async () => {
    await preview();
    mock.post.mockRejectedValueOnce(new Error('lost response'));
    fireEvent.click(screen.getByRole('button', { name: 'In tem' }));
    await screen.findByText('lost response');
    expect(print).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Khổ giấy').hasAttribute('disabled')).toBe(true);
    const body = mock.post.mock.calls[0]![1];
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại yêu cầu in' }));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(mock.post.mock.calls[1]![1]).toEqual(body);
  });
  it('blocks expired/unauthorized bytes, cleans print styles and blob URLs on close', async () => {
    const view = await preview(true);
    fireEvent.click(screen.getByRole('button', { name: 'Đóng xem trước' }));
    expect(document.getElementById('cup-photo-print-sheet')).toBeNull();
    expect(document.body.hasAttribute('data-cup-print')).toBe(false);
    expect(URL.revokeObjectURL).toHaveBeenCalled();
    view.unmount();
    qc.clear();
    mock.get.mockImplementation(async (url: string) => {
      if (url.includes('/image')) throw new Error('photo expired');
      return response({ items: [order], total: 1, pages: 1 });
    });
    wrapper(<CupPrintPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Xem & in tem' }));
    await screen.findByText('photo expired');
    expect(print).not.toHaveBeenCalled();
  });
  it('refreshes on order/payment events and shows empty and expired rows', async () => {
    mock.get.mockResolvedValue(
      response({
        items: [{ ...order, items: [{ ...order.items[0]!, available: false }] }],
        total: 1,
        pages: 1,
      }),
    );
    wrapper(<CupPrintPage />);
    expect(
      (await screen.findByRole('button', { name: 'Xem & in tem' })).hasAttribute('disabled'),
    ).toBe(true);
    mock.get.mockResolvedValue(response({ items: [], total: 0, pages: 0 }));
    act(() => mock.events.get('payment.confirmed')?.());
    await screen.findByText('Chưa có đơn đã thanh toán kèm ảnh.');
  });
});
