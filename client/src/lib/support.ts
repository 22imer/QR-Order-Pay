export const DEFAULT_SUPPORT_TELEGRAM_URL = 'https://t.me/cafe_sky_cskh_bot';

/**
 * URL bot CSKH trên Telegram. Biến chưa đặt → dùng mặc định; chuỗi rỗng hoặc URL không phải
 * `https://` hợp lệ → `null` (ẩn link, không render link hỏng).
 */
export function getSupportTelegramUrl(
  value: string | undefined = import.meta.env.VITE_SUPPORT_TELEGRAM_URL as string | undefined,
): string | null {
  const raw = (value ?? DEFAULT_SUPPORT_TELEGRAM_URL).trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
