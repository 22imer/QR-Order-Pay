import { useQuery } from '@tanstack/react-query';
import { api, unwrap, vnd, getErrorMessage } from '../../lib/api';
import { EmptyState, ErrorState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';
import { receiptResponseSchema } from '@may-cafe/contracts';
import { OrderReview } from './OrderReview';

function iceLabel(value: string): string {
  return value === 'no-ice' ? 'không đá' : value === 'less-ice' ? 'ít đá' : 'đá thường';
}

function formatClosedAt(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ReceiptPage(): JSX.Element {
  useDocumentTitle('Hóa đơn & đánh giá');
  const query = useQuery({
    queryKey: ['receipt'],
    queryFn: async () =>
      receiptResponseSchema.parse(unwrap(await api.get<unknown>('/receipts/current'))),
    retry: false,
  });
  if (query.isLoading) return <Skeleton className="mt-2 h-96 rounded-3xl" />;
  if (query.isError)
    return <ErrorState message={getErrorMessage(query.error)} onRetry={() => query.refetch()} />;
  const data = query.data!;
  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 pt-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="g-display text-[2.25rem]">Hóa đơn của bạn</h1>
          <p className="mt-2 max-w-[40ch] text-sm text-muted-foreground">
            Các món do thiết bị này đặt. Nhân viên thu tiền và in hóa đơn chung theo bàn.
          </p>
        </div>
      </div>

      {data.orders.length === 0 ? (
        <EmptyState
          title="Không có món đã thanh toán"
          description="Phiên đã đóng; thiết bị này không có đơn đã thanh toán."
        />
      ) : (
        <div className="slip-wrap slip-print">
          <article className="slip px-5 pt-5">
            <header className="flex items-start justify-between gap-3">
              <div>
                <p className="g-title text-lg">Fantastic cafe</p>
                <p className="text-sm text-muted-foreground">{data.tableName}, đã kết thúc phiên</p>
              </div>
              <p className="text-right text-sm text-muted-foreground">
                {formatClosedAt(data.closedAt)}
              </p>
            </header>

            {data.orders.map((order) => (
              <section key={order._id} aria-label={`Đơn ${order.code}`}>
                <div className="slip-rule mt-4" />
                <p className="mt-4 text-sm font-semibold">Đơn {order.code}</p>
                <ul className="mt-3 space-y-3">
                  {order.items.map((item, i) => (
                    <li key={i}>
                      <div className="flex items-end gap-2">
                        <span className="leading-snug">
                          {item.quantity} × {item.nameSnapshot}
                          {item.sizeName ? ` (${item.sizeName})` : ''}
                        </span>
                        <span className="leader" aria-hidden="true" />
                        <span className="tabular-nums">{vnd(item.lineTotal)}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Đường {item.sugarLevel}, {iceLabel(item.iceLevel)}
                        {item.toppingNamesSnapshot?.length
                          ? `, ${item.toppingNamesSnapshot.join(', ')}`
                          : ''}
                      </p>
                      {item.note ? (
                        <p className="text-sm italic text-muted-foreground">“{item.note}”</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 flex justify-between text-sm text-muted-foreground">
                  <span>Tổng đơn, đã thanh toán</span>
                  <span className="tabular-nums">{vnd(order.total)}</span>
                </p>
              </section>
            ))}

            <div className="slip-rule mt-4" />
            <div className="flex items-end justify-between gap-3 pt-4">
              <span className="g-title text-lg">Tổng đã thanh toán</span>
              <span className="g-display text-3xl tabular-nums">{vnd(data.total)}</span>
            </div>
          </article>
        </div>
      )}

      {data.orders.length > 0 ? (
        <section className="space-y-4 print:hidden" aria-labelledby="review-title">
          <h2 id="review-title" className="g-title text-xl">
            Bạn thấy đồ uống thế nào?
          </h2>
          {data.orders.map((order) => (
            <OrderReview key={order._id} order={order} mode="receipt" />
          ))}
        </section>
      ) : null}

      <p className="text-sm text-muted-foreground print:mt-4">
        Cảm ơn bạn đã ghé Fantastic cafe! Quyền xem hóa đơn trên thiết bị này hết hạn sau 12 giờ kể từ lúc
        vào bàn hoặc khi bạn rời bàn.
      </p>
    </div>
  );
}
