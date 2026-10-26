import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { InsightsQuery, InsightsReport } from '@may-cafe/contracts';
import { insightsQuerySchema } from '@may-cafe/contracts';
import { api, unwrap, getErrorMessage, vnd } from '../../lib/api';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';
function initial(): InsightsQuery {
  const end = new Date(Date.now() + 7 * 3600000 - 86400000),
    begin = new Date(end.getTime() - 29 * 86400000);
  return {
    from: begin.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
    channel: 'ALL',
  };
}
const number = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
export function SmartInsights(): JSX.Element {
  useDocumentTitle('Smart Insights');
  const [range, setRange] = useState<InsightsQuery>(initial),
    [draft, setDraft] = useState<InsightsQuery>(initial),
    [error, setError] = useState('');
  const query = useQuery({
    queryKey: ['smart-insights', range],
    queryFn: async ({ signal }) =>
      unwrap<InsightsReport>(await api.get('/admin/insights', { params: range, signal })),
    refetchInterval: 60000,
  });
  const data = query.data;
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-3xl font-semibold">Smart Insights</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Đơn đã phục vụ, trả đủ tiền, không hoàn/hủy hoặc vắng mặt. Tính theo ngày tạo đơn, giờ
          Việt Nam; đây là phân tích bán hàng, tiền thu/hoàn xem tại Dashboard.
        </p>
      </header>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = insightsQuerySchema.safeParse(draft);
          if (!parsed.success) setError('Chọn ngày hợp lệ, từ 1 đến 93 ngày.');
          else {
            setError('');
            setRange(parsed.data);
            if (JSON.stringify(parsed.data) === JSON.stringify(range)) void query.refetch();
          }
        }}
      >
        <label>
          Từ ngày
          <input
            aria-label="Insights từ ngày"
            className="block rounded-xl border bg-background p-2"
            type="date"
            required
            value={draft.from}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
        </label>
        <label>
          Đến ngày
          <input
            aria-label="Insights đến ngày"
            className="block rounded-xl border bg-background p-2"
            type="date"
            required
            value={draft.to}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          />
        </label>
        <label>
          Kênh
          <select
            aria-label="Kênh Insights"
            className="block rounded-xl border bg-background p-2"
            value={draft.channel}
            onChange={(e) =>
              setDraft({ ...draft, channel: e.target.value as InsightsQuery['channel'] })
            }
          >
            <option value="ALL">Tất cả</option>
            <option value="DINE_IN">Tại bàn</option>
            <option value="TAKEAWAY">Mang đi ngay</option>
            <option value="PICKUP">Đặt trước</option>
          </select>
        </label>
        <Button type="submit" disabled={query.isFetching}>
          Xem phân tích
        </Button>
      </form>
      {error && <p role="alert">{error}</p>}
      {query.isPending && <p role="status">Đang tổng hợp…</p>}
      {query.isError && (
        <div role="alert">
          {getErrorMessage(query.error)}{' '}
          <Button variant="outline" onClick={() => void query.refetch()}>
            Thử lại
          </Button>
        </div>
      )}
      {data && (
        <>
          <p className="text-sm text-muted-foreground">
            Kỳ {data.from} – {data.to} · {data.channel} · cập nhật{' '}
            {new Date(data.generatedAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}.{' '}
            {data.sample.capped
              ? `Mẫu ${data.sample.limit} đơn mới nhất, chưa bao phủ cả kỳ.`
              : 'Bao phủ các đơn đủ điều kiện trong kỳ.'}
          </p>
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              ['Đơn trong mẫu', number(data.sample.orders)],
              ['Số phần', number(data.summary.cups)],
              ['Giá trị đơn sau ưu đãi', vnd(data.summary.orderValue)],
              ['Trung bình / đơn', vnd(data.summary.averageOrderValue)],
            ].map(([name, value]) => (
              <Card key={name} className="p-4">
                <p className="text-sm text-muted-foreground">{name}</p>
                <strong className="mt-2 block text-2xl">{value}</strong>
              </Card>
            ))}
          </div>
          <Card className="space-y-3 p-5">
            <h2 className="text-xl font-semibold">Gợi ý cho quán</h2>
            {!data.sample.orders && <p>Chưa có đơn hoàn tất phù hợp trong kỳ này.</p>}
            <ul className="list-disc space-y-2 pl-5">
              {data.advice.map((a) => (
                <li key={a.code}>{a.text}</li>
              ))}
            </ul>
            <p className="text-sm text-muted-foreground">
              Kỳ trước: {data.comparison.from} – {data.comparison.to}, {data.comparison.orders} đơn.{' '}
              {data.comparison.orderChangePct === null
                ? 'Chưa so sánh: cần hai kỳ đã kết thúc, mỗi kỳ ít nhất 20 đơn và không bị giới hạn mẫu.'
                : `Chênh lệch ${data.comparison.orderChangePct}%.`}
            </p>
          </Card>
          <Card className="space-y-4 p-5">
            <h2 className="text-xl font-semibold">Phân bố đơn theo giờ</h2>
            <p className="text-sm text-muted-foreground">
              Mỗi đơn tính một lần theo giờ tạo. Biểu đồ là tổng trong kỳ, không phải dự báo mỗi
              ngày.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {data.hours.map((h) => (
                <div key={h.hour} className="flex items-center gap-2 text-sm">
                  <span className="w-14 shrink-0">{h.hour}:00</span>
                  <meter
                    aria-label={`Đơn lúc ${h.hour} giờ`}
                    className="h-5 flex-1"
                    min={0}
                    max={Math.max(1, ...data.hours.map((v) => v.orders))}
                    value={h.orders}
                  />
                  <span className="w-16 text-right">{h.orders} đơn</span>
                </div>
              ))}
            </div>
          </Card>
          <Card className="space-y-3 p-5">
            <h2 className="text-xl font-semibold">Món bán nhiều</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    <th>Món</th>
                    <th>Số phần</th>
                    <th>Số đơn</th>
                    <th>Giá trị dòng</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topProducts.map((p) => (
                    <tr key={p.productId} className="border-t">
                      <td className="py-3 pr-3">
                        {p.name}
                        {p.freestyle ? ' · Freestyle' : ''}
                      </td>
                      <td>{p.quantity}</td>
                      <td>{p.orders}</td>
                      <td>{vnd(p.grossValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              Giá trị dòng trước voucher/đổi điểm cấp đơn; không cộng với giá trị đơn sau ưu đãi.
              Tên theo snapshot bán gần nhất trong mẫu.
            </p>
          </Card>
          <Card className="space-y-3 p-5">
            <h2 className="text-xl font-semibold">Cặp món thường đi cùng</h2>
            <p className="text-sm">
              Mẫu {data.sample.patternOrders} đơn có món thường; tối thiểu 20 đơn, mỗi món xuất hiện
              trong 10 đơn, cặp trong 5 đơn và lift ≥ 1,05. Đếm một lần/đơn dù có nhiều size hoặc số
              lượng.
            </p>
            {data.sample.skippedLargeBaskets > 0 && (
              <p>Bỏ {data.sample.skippedLargeBaskets} giỏ hơn 12 món khác nhau khi tính cặp.</p>
            )}
            {!data.pairs.length && (
              <p>Chưa có cặp đạt ngưỡng. Không tự tạo gợi ý khi thiếu dữ liệu.</p>
            )}
            {data.pairs.map((p) => (
              <div key={`${p.a}:${p.b}`} className="rounded-xl border p-3">
                <strong>
                  {p.nameA} + {p.nameB}
                </strong>
                <p className="text-sm">
                  {p.orders} đơn · {p.confidenceAB}% đơn có {p.nameA} cũng có {p.nameB} · chiều
                  ngược {p.confidenceBA}% · lift {p.lift}
                </p>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Lift so với tần suất riêng của từng món; tương quan không chứng minh bán kèm sẽ tăng
              doanh thu. Freestyle không đưa vào cặp.
            </p>
          </Card>
          <Card className="space-y-3 p-5">
            <h2 className="text-xl font-semibold">Lãi gộp nguyên liệu dự kiến / cốc</h2>
            <p className="text-sm">
              Theo giá, công thức và giá vốn nguyên liệu <strong>hiện tại</strong>, độc lập kỳ lịch
              sử ở trên. Chưa gồm topping, ưu đãi, bao bì ngoài công thức, hao hụt, nhân công và chi
              phí khác; không phải lợi nhuận đơn cũ.
            </p>
            <p>
              {data.margins.completeVariants}/{data.margins.totalVariants} cấu hình đủ dữ liệu · tối
              đa 50 dòng, xếp chênh lệch cao trước.{' '}
              <Link className="underline" to="/admin/inventory">
                Nhập giá vốn tại Kho & công thức
              </Link>
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    <th>Món / size</th>
                    <th>Giá hiện tại</th>
                    <th>Nguyên liệu</th>
                    <th>Chênh lệch</th>
                    <th>% giá bán</th>
                  </tr>
                </thead>
                <tbody>
                  {data.margins.items.map((m) => (
                    <tr key={`${m.productId}:${m.variantId}`} className="border-t">
                      <td className="py-3 pr-3">
                        {m.name} {m.size}
                        <p className="text-xs text-muted-foreground">{m.missing.join(', ')}</p>
                      </td>
                      <td>{vnd(m.price)}</td>
                      <td>
                        {m.ingredientCost === null ? 'Chưa đủ giá vốn' : vnd(m.ingredientCost)}
                      </td>
                      <td>{m.grossMargin === null ? '—' : vnd(m.grossMargin)}</td>
                      <td>{m.marginPct === null ? '—' : `${number(m.marginPct)}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
