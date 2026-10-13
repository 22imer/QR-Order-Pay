import type { DashboardOverview } from '@may-cafe/contracts';

export function overviewToCsv(
  data: DashboardOverview,
  from: string | null,
  to: string | null,
): string {
  const rows: Array<Array<string | number>> = [
    ['Báo cáo Fantastic cafe', `${displayDate(from)} - ${displayDate(to)}`],
    ['Thực thu ròng', data.totalRevenue],
    ['Tiền đã thu', data.grossCollected ?? 0],
    ['Tiền đã hoàn', data.totalRefunded ?? 0],
    ['Điều chỉnh', data.adjustmentAmount ?? 0],
    ['Số đơn có thu tiền', data.orderCount],
    ['Tiền thu trung bình/đơn', data.averageOrderValue],
    [],
    ['Doanh thu theo ngày'],
    ['Ngày', 'Doanh thu', 'Số đơn'],
    ...data.revenueByDay.map((item) => [item.date, item.revenue, item.orders]),
    [],
    ['Top sản phẩm'],
    ['Sản phẩm', 'Số lượng', 'Doanh thu'],
    ...data.topProducts.map((item) => [item.name, item.quantity, item.revenue]),
  ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
}

function displayDate(value: string | null): string {
  return value?.slice(0, 10) ?? '';
}

function csvCell(value: string | number): string {
  const raw = String(value);
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}
