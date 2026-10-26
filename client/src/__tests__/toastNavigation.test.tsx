// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { ToastProvider } from '../components/ui/Toast';
import { useToast } from '../components/ui/useToast';
import { notifyBrowser } from '../features/staff/notifications';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function Trigger() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return (
    <>
      <output>{pathname}</output>
      <button
        onClick={() =>
          toast({
            title: 'Đơn mang đi mới',
            description: 'Kiểm tra và thu tiền.',
            onClick: () => navigate('/staff/pickups'),
          })
        }
      >
        Tạo thông báo
      </button>
    </>
  );
}
describe('clickable notifications', () => {
  it('opens the destination when clicking the notification and dismisses it', async () => {
    render(
      <MemoryRouter initialEntries={['/staff/kds']}>
        <ToastProvider>
          <Trigger />
        </ToastProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Tạo thông báo' }));
    const notice = await screen.findByRole('button', { name: 'Mở: Đơn mang đi mới' });
    expect(notice.tagName).toBe('BUTTON');
    fireEvent.click(notice);
    expect(screen.getByText('/staff/pickups')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mở: Đơn mang đi mới' })).toBeNull();
  });
  it('allows dismissing without opening the destination', async () => {
    render(
      <MemoryRouter initialEntries={['/staff/kds']}>
        <ToastProvider>
          <Trigger />
        </ToastProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Tạo thông báo' }));
    await screen.findByRole('button', { name: 'Mở: Đơn mang đi mới' });
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(screen.getByText('/staff/kds')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mở: Đơn mang đi mới' })).toBeNull();
  });
  it('focuses the app and opens the destination on a browser notification click', () => {
    const close = vi.fn(),
      navigate = vi.fn();
    let notice!: { onclick: () => void; close: () => void };
    class BrowserNotice {
      static permission = 'granted';
      onclick = () => {};
      close = close;
      constructor() {
        notice = this;
      }
    }
    vi.stubGlobal('Notification', BrowserNotice);
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => {});
    notifyBrowser('Có yêu cầu mới', 'Mở danh sách yêu cầu', navigate);
    notice.onclick();
    expect(focus).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
});
