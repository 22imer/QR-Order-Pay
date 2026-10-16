import { useQuery } from '@tanstack/react-query';
import { Card } from '../../components/ui/Card';
import { getErrorMessage, vnd } from '../../lib/api';
import { Badge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Skeleton';
import { ErrorState } from '../../components/ui/EmptyState';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  LineChart,
  Line,
  CartesianGrid,
} from 'recharts';
import { useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import {
  ArrowUpRight,
  Download,
  Printer,
  QrCode,
  ReceiptText,
  UtensilsCrossed,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { createOverviewReport } from '../../lib/reportJobs';
import { useToast } from '../../components/ui/useToast';

export function AdminDashboard(): JSX.Element {
  useDocumentTitle('Dashboard');
  const [range, setRange] = useState(defaultDateRange);
  const [exporting, setExporting] = useState(false);
  const { toast } = useToast();
  const overviewQuery = useQuery({
    queryKey: ['admin-overview', range.from, range.to],
    queryFn: ({ signal }) => createOverviewReport(range, 'json', signal),
    refetchInterval: 60_000,
  });

  const totalTop = useMemo(() => overviewQuery.data?.topProducts ?? [], [overviewQuery.data]);

  if (overviewQuery.isLoading) {
    return (
      <div className="space-y-6">
        <AdminQuickLinks />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }
  if (overviewQuery.isError) {
    return (
      <div className="space-y-6">
        <AdminQuickLinks />
        <ErrorState
          message={getErrorMessage(overviewQuery.error)}
          onRetry={() => overviewQuery.refetch()}
        />
      </div>
    );
  }
  const data = overviewQuery.data!;
  return (
    <div className="space-y-6">
      <AdminQuickLinks />
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <h1 className="font-display text-2xl font-semibold">Tổng quan kinh doanh</h1>
          <p className="text-sm text-muted-foreground">
            Tiền thu, hoàn và điều chỉnh tính theo thời điểm giao dịch, múi giờ Việt Nam.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-medium">
            Từ ngày
            <Input
              type="date"
              required
              value={range.from}
              max={range.to}
              onChange={(event) => {
                if (event.target.value)
                  setRange((current) => ({ ...current, from: event.target.value }));
              }}
              className="mt-1 w-40"
            />
          </label>
          <label className="text-xs font-medium">
            Đến ngày
            <Input
              type="date"
              required
              value={range.to}
              min={range.from}
              onChange={(event) => {
                if (event.target.value)
                  setRange((current) => ({ ...current, to: event.target.value }));
              }}
              className="mt-1 w-40"
            />
          </label>
          <Button
            variant="outline"
            disabled={exporting}
            onClick={async () => {
              setExporting(true);
              try {
                const csv = await createOverviewReport(range, 'csv');
                downloadOverviewCsv(csv, range);
                toast({ title: 'Đã tạo báo cáo CSV bằng worker', tone: 'success' });
              } catch (error) {
                toast({
                  title: 'Không thể xuất báo cáo',
                  description: getErrorMessage(error),
                  tone: 'danger',
                });
              } finally {
                setExporting(false);
              }
            }}
          >
            <Download className="h-4 w-4" /> {exporting ? 'Đang tạo...' : 'CSV'}
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> In / PDF
          </Button>
        </div>
      </div>

      <h2 className="font-display text-lg font-semibold">
        Từ {formatDisplayDate(range.from)} đến {formatDisplayDate(range.to)}
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard title="Thực thu ròng" value={vnd(data.totalRevenue)} tone="success" />
        <KpiCard title="Tiền đã thu" value={vnd(data.grossCollected ?? 0)} tone="info" />
        <KpiCard title="Tiền đã hoàn" value={vnd(data.totalRefunded ?? 0)} tone="warning" />
        <KpiCard
          title="Điều chỉnh khoản thu"
          value={vnd(data.adjustmentAmount ?? 0)}
          tone="warning"
        />
      </div>

      <p className="text-sm text-muted-foreground">
        Thực thu ròng = tiền đã thu − tiền đã hoàn + điều chỉnh. {data.orderCount} đơn có thu tiền;
        thu trung bình {vnd(data.averageOrderValue)}/đơn.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card className="p-5 sm:p-6">
          <h3 className="font-display font-semibold">Thực thu ròng theo ngày</h3>
          <div className="h-72 mt-3">
            <ResponsiveContainer>
              <LineChart data={data.revenueByDay}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#EFEAE2" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip formatter={(v: number) => vnd(v)} />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  stroke="#285943"
                  strokeWidth={2.5}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-5 sm:p-6">
          <h3 className="font-display font-semibold">Thực thu ròng theo giờ</h3>
          <div className="h-72 mt-3">
            <ResponsiveContainer>
              <BarChart data={data.revenueByHour}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#EFEAE2" />
                <XAxis dataKey="hour" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip formatter={(v: number) => vnd(v)} />
                <Bar
                  dataKey="revenue"
                  fill="#C88A4D"
                  radius={[8, 8, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card className="overflow-x-auto p-5 sm:p-6">
        <h3 className="font-display font-semibold mb-2">Top 5 sản phẩm</h3>
        <p className="mb-3 text-sm text-muted-foreground">
          Theo ngày tạo đơn đã thanh toán; giá trị món trước điều chỉnh tài chính.
        </p>
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="text-left">
              <th className="py-2">Sản phẩm</th>
              <th className="py-2">Số lượng</th>
              <th className="py-2">Doanh thu</th>
            </tr>
          </thead>
          <tbody>
            {totalTop.map((p) => (
              <tr key={p.productId} className="border-t border-foreground/5">
                <td className="py-2 font-medium">{p.name}</td>
                <td className="py-2">{p.quantity}</td>
                <td className="py-2">{vnd(p.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function AdminQuickLinks(): JSX.Element {
  return (
    <nav
      aria-label="Quản trị"
      className="grid gap-3 print:hidden sm:grid-cols-2 xl:grid-cols-[1.5fr_1fr_1fr]"
    >
      <Link
        to="/admin/tables"
        className="group flex items-start gap-4 rounded-2xl bg-primary p-5 text-primary-foreground transition hover:bg-primary/95 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:col-span-2 xl:col-span-1"
      >
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary-foreground/10">
          <QrCode className="h-6 w-6" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-2xl font-semibold">Bàn & QR động</span>
          <span className="mt-2 block text-xs leading-relaxed text-primary-foreground/70">
            Cấp liên kết riêng cho màn hình tại bàn. Màn hình tự đổi QR mỗi 60 giây.
          </span>
        </span>
        <ArrowUpRight className="h-4 w-4 shrink-0" />
      </Link>
      <Link
        to="/admin/products"
        className="flex items-start gap-3 rounded-2xl border border-foreground/10 bg-card p-5 transition hover:border-primary/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-muted text-primary">
          <UtensilsCrossed className="h-5 w-5" />
        </span>
        <span className="flex-1">
          <span className="block font-display text-xl font-semibold">Món</span>
          <span className="mt-2 block text-xs text-muted-foreground">Danh mục · Topping</span>
        </span>
        <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
      </Link>
      <Link
        to="/admin/bills"
        className="flex items-start gap-3 rounded-2xl border border-foreground/10 bg-card p-5 transition hover:border-primary/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-muted text-primary">
          <ReceiptText className="h-5 w-5" />
        </span>
        <span className="flex-1">
          <span className="block font-display text-xl font-semibold">Hóa đơn</span>
          <span className="mt-2 block text-xs text-muted-foreground">Lịch sử · In / PDF</span>
        </span>
        <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
      </Link>
    </nav>
  );
}

function defaultDateRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 29);
  return { from: formatInputDate(from), to: formatInputDate(to) };
}

function formatInputDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDisplayDate(value: string): string {
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

function downloadOverviewCsv(csv: string, range: { from: string; to: string }): void {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `may-cafe-${range.from}-${range.to}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function KpiCard({
  title,
  value,
  tone,
}: {
  title: string;
  value: string;
  tone: 'info' | 'success' | 'warning';
}): JSX.Element {
  return (
    <Card className="p-4 space-y-1">
      <Badge tone={tone}>{title}</Badge>
      <p className="font-display text-2xl font-semibold">{value}</p>
    </Card>
  );
}
