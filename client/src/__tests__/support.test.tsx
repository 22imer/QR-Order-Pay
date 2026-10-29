// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui/Toast';
import { DEFAULT_SUPPORT_TELEGRAM_URL, getSupportTelegramUrl } from '../lib/support';
import type * as apiModule from '../lib/api';
import { GuestLayout } from '../layouts/GuestLayout';

const mock = vi.hoisted(() => ({
  get: vi.fn(),
  session: { active: false, receiptAvailable: false } as Record<string, unknown>,
}));
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof apiModule>()),
  api: { get: mock.get, post: vi.fn() },
}));
vi.mock('../lib/socket', () => ({
  connectGuestSocket: () => ({ connected: false }),
  disconnectSocket: vi.fn(),
  useSocketEvent: vi.fn(),
}));

const response = (data: unknown) => ({ data: { success: true, data } });

function mount(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/orders']}>
          <GuestLayout />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return qc;
}

beforeEach(() => {
  mock.session = { active: false, receiptAvailable: false };
  mock.get.mockImplementation(async (url: string) => {
    if (url === '/table-sessions/current') return response(mock.session);
    if (url === '/gifts') return response({ items: [], total: 0, page: 1, incomingCount: 0 });
    throw new Error(`Unexpected read ${url}`);
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('support URL resolution', () => {
  it('uses the default bot when unset and hides the link when empty or not https', () => {
    expect(getSupportTelegramUrl(undefined)).toBe(DEFAULT_SUPPORT_TELEGRAM_URL);
    expect(getSupportTelegramUrl('https://t.me/other_bot')).toBe('https://t.me/other_bot');
    expect(getSupportTelegramUrl('')).toBeNull();
    expect(getSupportTelegramUrl('   ')).toBeNull();
    expect(getSupportTelegramUrl('http://t.me/cafe_sky_cskh_bot')).toBeNull();
    expect(getSupportTelegramUrl('javascript:alert(1)')).toBeNull();
    expect(getSupportTelegramUrl('t.me/cafe_sky_cskh_bot')).toBeNull();
  });
});

describe('GuestLayout CSKH link', () => {
  it('is hidden before joining a table', async () => {
    const qc = mount();
    await waitFor(() => expect(qc.getQueryState(['guest-session'])?.status).toBe('success'));
    expect(qc.getQueryData(['guest-session'])).toEqual({ active: false, receiptAvailable: false });
    expect(screen.queryAllByText('Hỗ trợ CSKH')).toHaveLength(0);
  });

  it('opens the Telegram bot in a new tab while a table session is active', async () => {
    mock.session = {
      active: true,
      tableSessionId: '507f1f77bcf86cd799439011',
      participantId: 'p-1',
      status: 'OPEN',
      table: { id: 't', name: 'Bàn 01', code: 'B01' },
    };
    mount();
    const links = await screen.findAllByRole('link', { name: /Hỗ trợ CSKH/ });
    expect(links).toHaveLength(2); // header nav (desktop) + dock (mobile)
    for (const link of links) {
      expect(link.getAttribute('href')).toBe('https://t.me/cafe_sky_cskh_bot');
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });

  it('stays available after the session ended while a receipt exists', async () => {
    mock.session = { active: false, receiptAvailable: true };
    mount();
    expect(await screen.findAllByRole('link', { name: /Hỗ trợ CSKH/ })).toHaveLength(2);
  });
});
