import { expect, test, type Page, type APIRequestContext } from '@playwright/test';

async function freshGuestLink(request: APIRequestContext): Promise<string> {
  const displayToken = process.env.E2E_DISPLAY_TOKEN;
  test.skip(!displayToken, 'Set E2E_DISPLAY_TOKEN to obtain a fresh 60-second QR.');
  const response = await request.get('/api/v1/table-displays/qr', {
    headers: { 'X-Table-Display-Token': displayToken! },
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { data: { url: string } };
  return new URL(body.data.url).pathname;
}

const viewports = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

for (const viewport of viewports) {
  test.describe(viewport.name, () => {
    test.use({ viewport });

    test('join page keeps its primary controls visible', async ({ page }) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));

      await page.goto('/t');
      await expect(page.getByRole('heading', { name: 'Quét QR hoặc nhập mã bàn' })).toBeVisible();
      await expect(page.getByLabel('Mã QR')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Vào bàn' })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      expect(pageErrors).toEqual([]);
    });

    test('login page keeps its form visible', async ({ page, baseURL }) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));

      const staffBaseUrl =
        process.env.E2E_STAFF_BASE_URL ??
        (process.env.E2E_BASE_URL ? baseURL : 'http://localhost:8081') ??
        'http://localhost:8081';
      await page.goto(new URL('/auth/login', staffBaseUrl).toString());
      await expect(page.getByRole('heading', { name: 'Đăng nhập nội bộ' })).toBeVisible();
      await expect(page.getByLabel('Email')).toBeVisible();
      await expect(page.getByLabel('Mật khẩu')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Đăng nhập' })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      expect(pageErrors).toEqual([]);
    });

    test('guest menu stays usable after a simulated QR link', async ({ page }) => {
      const guestLink = await freshGuestLink(page.request);

      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      await page.goto(guestLink);
      await expect(page).toHaveURL(/\/menu$/, { timeout: 15_000 });
      await expect(page.getByRole('main')).toBeVisible();
      await expectNoHorizontalOverflow(page);
      expect(pageErrors).toEqual([]);
    });
  });
}

test.describe('network and multi-device resilience', () => {
  test('shows offline state and confirms reconnection', async ({ context, page }) => {
    await page.goto('/t');
    await expect(page.getByRole('heading', { name: 'Quét QR hoặc nhập mã bàn' })).toBeVisible();

    await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) throw new Error('Service Worker is not supported');
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise<void>((resolve) =>
          navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
            once: true,
          }),
        );
      }
    });
    const cachedUrls = await page.evaluate(async () => {
      const keys = await caches.keys();
      return (await Promise.all(keys.map(async (key) => (await caches.open(key)).keys())))
        .flat()
        .map((request) => request.url);
    });
    expect(cachedUrls.some((url) => /\/assets\/index-[^/]+\.js$/.test(url))).toBe(true);
    expect(cachedUrls.some((url) => /\/assets\/JoinPage-[^/]+\.js$/.test(url))).toBe(true);

    await context.setOffline(true);
    await expect(page.getByRole('status').filter({ hasText: 'Mất kết nối mạng' })).toBeVisible();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Quét QR hoặc nhập mã bàn' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Mất kết nối mạng' })).toBeVisible();

    await context.setOffline(false);
    await expect(page.getByRole('status').filter({ hasText: 'Đã kết nối lại' })).toBeVisible();
  });

  test('two isolated devices share a table session but keep separate participants', async ({
    browser,
    baseURL,
    request,
  }) => {
    const guestLink = await freshGuestLink(request);

    const firstContext = await browser.newContext({ baseURL });
    const secondContext = await browser.newContext({ baseURL });
    try {
      const firstPage = await firstContext.newPage();
      const secondPage = await secondContext.newPage();
      await Promise.all([firstPage.goto(guestLink), secondPage.goto(guestLink)]);
      await Promise.all([
        expect(firstPage).toHaveURL(/\/menu$/, { timeout: 15_000 }),
        expect(secondPage).toHaveURL(/\/menu$/, { timeout: 15_000 }),
      ]);

      const [first, second] = await Promise.all([
        readCurrentGuest(firstPage),
        readCurrentGuest(secondPage),
      ]);
      expect(first.active).toBe(true);
      expect(second.active).toBe(true);
      expect(first.tableSessionId).toBe(second.tableSessionId);
      expect(first.participantId).not.toBe(second.participantId);
    } finally {
      await Promise.all([firstContext.close(), secondContext.close()]);
    }
  });
});

interface CurrentGuest {
  active: boolean;
  tableSessionId?: string;
  participantId?: string;
}

async function readCurrentGuest(page: Page): Promise<CurrentGuest> {
  return page.evaluate(async () => {
    const response = await fetch('/api/v1/table-sessions/current');
    if (!response.ok) throw new Error(`Current guest request failed with ${response.status}`);
    const body = (await response.json()) as { data: CurrentGuest };
    return body.data;
  });
}
