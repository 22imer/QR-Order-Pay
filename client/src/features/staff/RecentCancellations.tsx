import { getErrorMessage } from '../../lib/api';
import { Card } from '../../components/ui/Card';
import { ErrorState } from '../../components/ui/EmptyState';
import { useRecentCancellations } from './useRecentCancellations';

export function RecentCancellations(): JSX.Element {
  const query = useRecentCancellations();
  return (
    <section aria-label="Đơn đã hủy gần đây" className="space-y-3">
      <div>
        <h2 className="font-display text-xl font-semibold">Đơn đã hủy gần đây</h2>
        <p className="text-sm text-muted-foreground">
          Tối đa 50 đơn trong 24 giờ, gồm cả đơn khách hủy trước khi thanh toán.
        </p>
      </div>
      {query.isError ? (
        <ErrorState message={getErrorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : query.isLoading ? (
        <p>Đang tải đơn đã hủy…</p>
      ) : !query.data?.items.length ? (
        <p className="text-sm text-muted-foreground">Chưa có đơn bị hủy trong 24 giờ qua.</p>
      ) : (
        <div className="grid max-h-80 gap-3 overflow-y-auto md:grid-cols-2 xl:grid-cols-3">
          {query.data.items.map((order) => {
            const cancellation = [...order.statusHistory]
              .reverse()
              .find((entry) => entry.to === 'CANCELLED');
            return (
              <Card key={order._id} className="space-y-2 border-danger/30 p-4">
                <p className="font-semibold">
                  {order.code} · {order.tableName}
                </p>
                <p className="text-sm">{order.cancelReason || 'Đơn đã hủy'}</p>
                <p className="text-sm text-muted-foreground">
                  {order.items.map((item) => `${item.quantity} × ${item.nameSnapshot}`).join(', ')}
                </p>
                {cancellation ? (
                  <time className="block text-xs text-muted-foreground" dateTime={cancellation.at}>
                    {new Date(cancellation.at).toLocaleString('vi-VN', {
                      timeZone: 'Asia/Ho_Chi_Minh',
                    })}
                  </time>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {order.paymentStatus === 'REFUNDED'
                    ? 'Đã ghi nhận hoàn tiền'
                    : order.paymentStatus === 'PAID'
                      ? 'Đã thu tiền'
                      : 'Chưa thu tiền'}
                </p>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
