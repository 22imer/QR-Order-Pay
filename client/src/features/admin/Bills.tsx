import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ReceiptText, Search } from 'lucide-react';
import { api, getErrorMessage, unwrap, vnd } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ErrorState } from '../../components/ui/EmptyState';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Skeleton } from '../../components/ui/Skeleton';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';
import {
  billHistoryDetailSchema,
  billHistoryListResponseSchema,
  type BillHistoryDetail,
} from '@may-cafe/contracts';

type BillDetail = BillHistoryDetail;

export function AdminBills(): JSX.Element {
  useDocumentTitle('Lịch sử hóa đơn');
  const [filters, setFilters] = useState({ q: '', table: '', cashier: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['admin-bills', filters, page],
    queryFn: async () =>
      billHistoryListResponseSchema.parse(
        unwrap(await api.get<unknown>('/admin/bills', { params: { ...filters, page, limit: 20 } })),
      ),
  });
  const detail = useQuery({
    queryKey: ['admin-bill', selected],
    enabled: !!selected,
    queryFn: async () =>
      billHistoryDetailSchema.parse(unwrap(await api.get<unknown>(`/admin/bills/${selected}`))),
  });
  if (query.isLoading) return <Skeleton className="h-96" />;
  if (query.isError)
    return <ErrorState message={getErrorMessage(query.error)} onRetry={() => query.refetch()} />;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-semibold">Lịch sử hóa đơn</h1>
        <p className="text-sm text-muted-foreground">
          Tra cứu theo snapshot đã chốt; đổi menu sau này không làm thay đổi hóa đơn.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Điều chỉnh sau khi đóng phiên được lưu tại{' '}
          <Link className="underline" to="/admin/payments">
            Khoản thu & điều chỉnh
          </Link>
          .
        </p>
      </div>
      <Card className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-5">
        {(['q', 'table', 'cashier', 'from', 'to'] as const).map((key) => (
          <Input
            key={key}
            type={key === 'from' || key === 'to' ? 'date' : 'text'}
            value={filters[key]}
            placeholder={
              {
                q: 'Mã hóa đơn',
                table: 'Bàn',
                cashier: 'Thu ngân',
                from: 'Từ ngày',
                to: 'Đến ngày',
              }[key]
            }
            onChange={(event) => {
              setPage(1);
              setFilters((current) => ({ ...current, [key]: event.target.value }));
            }}
          />
        ))}
      </Card>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="p-3">Mã</th>
              <th className="p-3">Bàn</th>
              <th className="p-3">Thu ngân</th>
              <th className="p-3">Thanh toán</th>
              <th className="p-3 text-right">Tổng</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {query.data!.items.map((bill) => (
              <tr key={bill.id} className="border-b border-foreground/5">
                <td className="p-3 font-medium">{bill.invoiceCode}</td>
                <td className="p-3">
                  {bill.tableCode} · {bill.tableName}
                </td>
                <td className="p-3">{bill.cashierName}</td>
                <td className="p-3">
                  {new Date(bill.closedAt).toLocaleString('vi-VN')} ·{' '}
                  {bill.paymentMethods.join(', ') || 'Không rõ'}
                </td>
                <td className="p-3 text-right font-semibold">{vnd(bill.total)}</td>
                <td className="p-3">
                  <Button size="sm" variant="outline" onClick={() => setSelected(bill.id)}>
                    <Search className="h-4 w-4" /> Xem
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {query.data!.items.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">Không có hóa đơn phù hợp.</p>
        ) : null}
      </Card>
      <div className="flex items-center justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={page <= 1}
          onClick={() => setPage((value) => value - 1)}
        >
          Trước
        </Button>
        <span className="text-sm">
          Trang {page} · {query.data!.total} hóa đơn
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={page * query.data!.limit >= query.data!.total}
          onClick={() => setPage((value) => value + 1)}
        >
          Sau
        </Button>
      </div>
      <Modal
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
        title={detail.data?.invoiceCode ?? 'Chi tiết hóa đơn'}
        className="max-w-2xl"
      >
        {detail.isLoading ? (
          <Skeleton className="h-72" />
        ) : detail.isError ? (
          <ErrorState message={getErrorMessage(detail.error)} />
        ) : detail.data ? (
          <BillPrint bill={detail.data} />
        ) : null}
      </Modal>
    </div>
  );
}

function BillPrint({ bill }: { bill: BillDetail }): JSX.Element {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 text-sm">
        <span>
          Bàn:{' '}
          <strong>
            {bill.tableCode} · {bill.tableName}
          </strong>
        </span>
        <span>
          Thu ngân: <strong>{bill.cashierName}</strong>
        </span>
        <span>Mở: {new Date(bill.openedAt).toLocaleString('vi-VN')}</span>
        <span>Chốt: {new Date(bill.closedAt).toLocaleString('vi-VN')}</span>
      </div>
      <div className="divide-y rounded-xl border">
        {bill.orders.flatMap((order) =>
          order.items.map((item, index) => (
            <div key={`${order._id}-${index}`} className="flex justify-between p-3 text-sm">
              <span>
                {item.quantity} × {item.nameSnapshot}
                {item.variantNameSnapshot ? ` (${item.variantNameSnapshot})` : ''}
              </span>
              <strong>{vnd(item.lineTotal)}</strong>
            </div>
          )),
        )}
      </div>
      <div className="flex justify-between text-lg font-semibold">
        <span>Tổng đã thu</span>
        <span>{vnd(bill.paidAmount)}</span>
      </div>
      <Button className="w-full" onClick={() => window.print()}>
        <ReceiptText className="h-4 w-4" /> In lại hóa đơn
      </Button>
    </div>
  );
}
