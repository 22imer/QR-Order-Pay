import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { api, getErrorMessage, unwrap, vnd } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { ErrorState } from '../../components/ui/EmptyState';
import { Modal } from '../../components/ui/Modal';
import './paid-bill-print.css';

interface PaidBill {
  tableCode: string;
  status: string;
  closedAt: string | null;
  total: number;
  paidAmount: number;
  orders: Array<{
    _id: string;
    code: string;
    items: Array<{
      nameSnapshot: string;
      sizeName?: string | null;
      toppingNamesSnapshot?: string[];
      quantity: number;
      lineTotal: number;
    }>;
  }>;
}

export function PaidBillModal({
  sessionId,
  tableName,
  open,
  onOpenChange,
}: {
  sessionId: string;
  tableName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  // A separate query prevents the unpaid preview from being used as the final bill.
  const query = useQuery({
    queryKey: ['staff-paid-bill', sessionId],
    enabled: open,
    queryFn: async () => {
      const bill = unwrap(await api.get<PaidBill>(`/staff/table-sessions/${sessionId}/bill`));
      if (bill.status !== 'CLOSED' || !bill.closedAt || bill.paidAmount !== bill.total)
        throw new Error('Hóa đơn chưa được chốt. Vui lòng tải lại hóa đơn.');
      return bill;
    },
  });
  const bill = query.data;
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Hóa đơn đã thanh toán"
      className="staff-bill-dialog"
    >
      {query.isLoading ? (
        <p>Đã thu tiền. Đang tải hóa đơn để in...</p>
      ) : query.isError ? (
        <div className="space-y-3">
          <p>Thanh toán đã thành công. Hãy tải lại hóa đơn để in.</p>
          <ErrorState message={getErrorMessage(query.error)} onRetry={() => query.refetch()} />
        </div>
      ) : bill ? (
        <div className="space-y-4">
          <header className="text-center">
            <h2 className="font-display text-2xl font-semibold">Fantastic cafe</h2>
            <p>
              {bill.tableCode} · {tableName}
            </p>
            <p className="text-sm">{new Date(bill.closedAt!).toLocaleString('vi-VN')}</p>
          </header>
          {bill.orders.map((order) => (
            <section key={order._id} className="space-y-2 border-t pt-3">
              <h3 className="text-sm font-semibold">Đơn {order.code}</h3>
              {order.items.map((item, index) => (
                <div key={index} className="flex justify-between gap-3 text-sm break-inside-avoid">
                  <div>
                    {item.quantity} × {item.nameSnapshot}
                    {item.sizeName ? ` (${item.sizeName})` : ''}
                    {item.toppingNamesSnapshot?.length ? (
                      <p>{item.toppingNamesSnapshot.join(', ')}</p>
                    ) : null}
                  </div>
                  <span className="whitespace-nowrap">{vnd(item.lineTotal)}</span>
                </div>
              ))}
            </section>
          ))}
          <p className="flex justify-between border-t pt-3 text-lg font-semibold">
            <span>Tổng đã thanh toán</span>
            <span>{vnd(bill.paidAmount)}</span>
          </p>
          <p className="text-center text-sm">Cảm ơn quý khách đã ghé Fantastic cafe!</p>
          <Button className="w-full print:hidden" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> In hóa đơn
          </Button>
        </div>
      ) : null}
    </Modal>
  );
}
