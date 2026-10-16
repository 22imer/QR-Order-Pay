import { orderRepository } from '../repositories/orderRepository.js';
import { paymentAnalytics } from './paymentAnalyticsService.js';

const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;

function startOfDayVietnam(date: Date): Date {
  const vietnam = new Date(date.getTime() + VIETNAM_OFFSET_MS);
  return new Date(
    Date.UTC(vietnam.getUTCFullYear(), vietnam.getUTCMonth(), vietnam.getUTCDate()) -
      VIETNAM_OFFSET_MS,
  );
}

function endOfDayVietnam(date: Date): Date {
  return new Date(startOfDayVietnam(date).getTime() + 86_400_000 - 1);
}

export async function overview(from?: Date, to?: Date) {
  const today = new Date();
  const defaultFrom = new Date(today.getTime() - 29 * 86400000);
  const f = from ? startOfDayVietnam(from) : startOfDayVietnam(defaultFrom);
  const t = to ? endOfDayVietnam(to) : endOfDayVietnam(today);

  const [sales, financial] = await Promise.all([
    orderRepository.paidAnalytics(f, new Date(t.getTime() + 1)),
    paymentAnalytics(f, new Date(t.getTime() + 1)),
  ]);
  const analytics = { ...sales, ...financial };
  const revenueByHour = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    revenue: analytics.revenueByHour.find((item) => item.hour === hour)?.revenue ?? 0,
  }));
  return { ...analytics, revenueByHour };
}
