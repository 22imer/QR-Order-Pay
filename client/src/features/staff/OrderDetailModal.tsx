import { useQuery } from '@tanstack/react-query';
import { Modal } from '../../components/ui/Modal';
import { Skeleton } from '../../components/ui/Skeleton';
import { Badge } from '../../components/ui/Badge';
import { ErrorState } from '../../components/ui/EmptyState';
import { api, getErrorMessage, unwrap, vnd } from '../../lib/api';
import { GiftLabel } from '../../components/GiftLabel';
import type { GiftDelivery } from '@may-cafe/contracts';

interface OrderItem {
  productId: string;
  variantId: string | null;
  sizeName: string | null;
  sugarLevel: string;
  iceLevel: string;
  toppingIds: string[];
  note?: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  nameSnapshot: string;
  toppingNamesSnapshot?: string[];
}

interface StatusEntry {
  from: string | null;
  to: string;
  at: string;
  by: string | null;
  byParticipantId?: string | null;
  reason?: string;
}

interface OrderDetail {
  gift?: GiftDelivery | null;
  _id: string;
  code: string;
  tableSessionId: string;
  participantId: string;
  tableId: string;
  tableName: string;
  tableCode: string;
  items: OrderItem[];
  total: number;
  status:
    'AWAITING_PAYMENT' | 'PENDING' | 'CONFIRMED' | 'PREPARING' | 'READY' | 'SERVED' | 'CANCELLED';
  paymentStatus: 'UNPAID' | 'PAID' | 'REFUNDED';
  statusHistory: StatusEntry[];
  createdAt: string;
  updatedAt: string;
}

interface Props {
  orderId: string | null;
  onClose: () => void;
}

export function OrderDetailModal({ orderId, onClose }: Props): JSX.Element {
  const open = !!orderId;
  const query = useQuery({
    queryKey: ['staff-order-detail', orderId],
    queryFn: async () => {
      if (!orderId) throw new Error('no id');
      return unwrap(await api.get<{ order: OrderDetail }>(`/staff/orders/${orderId}`));
    },
    enabled: open,
  });

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={query.data ? `Đơn ${query.data.order.code}` : 'Chi tiết đơn'}
      className="max-w-2xl"
    >
      {query.isLoading && <Skeleton className="h-64" />}
      {query.isError && (
        <ErrorState message={getErrorMessage(query.error)} onRetry={() => query.refetch()} />
      )}
      {query.data && <Detail order={query.data.order} />}
    </Modal>
  );
}

function Detail({ order }: { order: OrderDetail }): JSX.Element {
  const created = new Date(order.createdAt);
  const ageMin = Math.max(0, Math.round((Date.now() - created.getTime()) / 60000));
  return (
    <div className="space-y-4">
      <GiftLabel gift={order.gift} />
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="info">
          {order.tableCode} · {order.tableName}
        </Badge>
        <Badge tone={statusTone(order.status)}>{statusLabel(order.status)}</Badge>
        <Badge tone={order.paymentStatus === 'PAID' ? 'success' : 'warning'}>
          {order.paymentStatus === 'PAID'
            ? 'Đã thanh toán'
            : order.paymentStatus === 'REFUNDED'
              ? 'Đã hoàn'
              : 'Chưa thanh toán'}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {created.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} · {ageMin}{' '}
          phút trước
        </span>
      </div>

      <div>
        <h3 className="font-semibold mb-1 text-sm">Món ({order.items.length})</h3>
        <ul className="divide-y divide-foreground/10 rounded-md border border-foreground/10">
          {order.items.map((it, idx) => (
            <li key={idx} className="p-2 text-sm">
              <div className="flex justify-between">
                <span className="font-medium">
                  {it.quantity} x {it.nameSnapshot}
                  {it.sizeName ? ` (${it.sizeName})` : ''}
                </span>
                <span className="font-semibold">{vnd(it.lineTotal)}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                Đường {it.sugarLevel} · {labelIce(it.iceLevel)} · {vnd(it.unitPrice)}/món
              </div>
              {it.toppingNamesSnapshot && it.toppingNamesSnapshot.length > 0 ? (
                <div className="text-xs">Topping: {it.toppingNamesSnapshot.join(', ')}</div>
              ) : null}
              {it.note ? (
                <div className="text-xs italic text-accent">Ghi chú: {it.note}</div>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="flex justify-between pt-2 font-semibold">
          <span>Tổng</span>
          <span>{vnd(order.total)}</span>
        </div>
      </div>

      <div>
        <h3 className="font-semibold mb-1 text-sm">Lịch sử trạng thái</h3>
        <ol className="space-y-1 text-xs">
          {order.statusHistory.map((s, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-muted-foreground w-24 shrink-0">
                {new Date(s.at).toLocaleTimeString('vi-VN', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </span>
              <span>
                {s.from ? `${statusLabel(s.from as OrderDetail['status'])} → ` : ''}
                <strong>{statusLabel(s.to as OrderDetail['status'])}</strong>
                {s.reason ? ` · ${s.reason}` : ''}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div className="text-xs text-muted-foreground">
        Mã phiên: {order.tableSessionId.slice(-6)} · Thiết bị: {order.participantId}
      </div>
    </div>
  );
}

function statusLabel(s: string): string {
  switch (s) {
    case 'AWAITING_PAYMENT':
      return 'Chờ thanh toán';
    case 'PENDING':
      return 'Chờ xác nhận';
    case 'CONFIRMED':
      return 'Đã nhận';
    case 'PREPARING':
      return 'Đang pha';
    case 'READY':
      return 'Sẵn sàng';
    case 'SERVED':
      return 'Đã phục vụ';
    case 'CANCELLED':
      return 'Đã huỷ';
    default:
      return s;
  }
}

function statusTone(s: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  switch (s) {
    case 'PENDING':
      return 'warning';
    case 'CONFIRMED':
      return 'info';
    case 'PREPARING':
      return 'info';
    case 'READY':
      return 'success';
    case 'SERVED':
      return 'success';
    case 'CANCELLED':
      return 'danger';
    default:
      return 'neutral';
  }
}

function labelIce(v: string): string {
  return v === 'no-ice' ? 'không đá' : v === 'less-ice' ? 'ít đá' : 'đá thường';
}
