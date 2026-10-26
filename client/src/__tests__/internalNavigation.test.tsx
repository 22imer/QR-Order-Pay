// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { InternalShell } from '../components/layout/InternalShell';

afterEach(cleanup);

function mount(portal: string) {
  const labels = ['Ảnh cốc & latte art', 'Jukebox', 'Đặt bàn', 'Mang đi & đặt trước', 'Lịch & chấm công', 'KDS', 'Bàn & phiên', 'Yêu cầu', 'Hết món', 'Ca thu ngân', 'Khoản thu'];
  const nav = labels.map((label, index) => ({ to: `/${portal}/page-${index}`, label, icon: null, badge: index === 10 ? 3 : null }));
  render(
    <MemoryRouter initialEntries={[nav[0]!.to]}>
      <Routes>
        <Route element={<InternalShell title="Vận hành" home={`/${portal}`} name="Lan" role={portal} nav={nav} onLogout={vi.fn()} />}>
          {nav.map((item) => <Route key={item.to} path={item.to} element={<h1>Trang {item.label}</h1>} />)}
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  return nav;
}

describe('internal function chooser', () => {
  it.each(['staff', 'admin'])('opens every function and navigates to the last item without a horizontal swipe (%s)', (portal) => {
    const nav = mount(portal);
    const toggle = screen.getByRole('button', { name: 'Chọn chức năng' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('navigation', { name: 'Tất cả chức năng' })).toBeNull();
    fireEvent.click(toggle);
    const menu = screen.getByRole('navigation', { name: 'Tất cả chức năng' });
    expect(toggle.getAttribute('aria-controls')).toBe(menu.id);
    expect(within(menu).getAllByRole('link')).toHaveLength(nav.length);
    expect(within(menu).getByRole('link', { name: 'Ảnh cốc & latte art' }).getAttribute('aria-current')).toBe('page');
    const last = within(menu).getByRole('link', { name: /Khoản thu/ });
    expect(within(last).getByLabelText('3 chờ xử lý')).toBeTruthy();
    fireEvent.click(last);
    expect(screen.getByRole('heading', { name: 'Trang Khoản thu' })).toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('navigation', { name: 'Tất cả chức năng' })).toBeNull();
    fireEvent.click(toggle);
    expect(within(screen.getByRole('navigation', { name: 'Tất cả chức năng' })).getByRole('link', { name: /Khoản thu/ }).getAttribute('aria-current')).toBe('page');
  });

  it('closes with Escape and returns keyboard focus to the chooser', () => {
    mount('staff');
    const toggle = screen.getByRole('button', { name: 'Chọn chức năng' });
    fireEvent.click(toggle);
    const menu = screen.getByRole('navigation', { name: 'Tất cả chức năng' });
    const link = within(menu).getByRole('link', { name: 'KDS' });
    link.focus();
    fireEvent.keyDown(link, { key: 'Escape' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
    expect(screen.getByRole('heading', { name: 'Trang Ảnh cốc & latte art' })).toBeTruthy();
  });
});
