import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api, getErrorMessage, unwrap, vnd } from '../../lib/api';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Skeleton';
import { ErrorState } from '../../components/ui/EmptyState';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';
import { useToast } from '../../components/ui/useToast';
import { getSocket } from '../../lib/socket';
import { ChevronRight, Eye } from 'lucide-react';
import { OrderDetailModal } from './OrderDetailModal';
import { Link } from 'react-router-dom';
import { WalletCards } from 'lucide-react';

interface OrderItem {
  productId: string;
  variantId: string | null;
  sizeName: string | null;
  sugarLevel: string;
  iceLevel: string;
  toppingIds: string[];
  toppingNamesSnapshot?: string[];
  note?: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  nameSnapshot: string;
}

interface Order {
  fulfillmentType?: 'DINE_IN' | 'TAKEAWAY' | 'PICKUP';
  scheduledAt?: string | null;
  _id: string;
  code: string;
  tableSessionId: string;
  tableName: string;
  items: OrderItem[];
  total: number;
  status: 'PENDING' | 'CONFIRMED' | 'PREPARING' | 'READY' | 'SERVED' | 'CANCELLED';
  paymentStatus: 'UNPAID' | 'PAID' | 'REFUNDED';
  createdAt: string;
  version: number;
  statusHistory: Array<{ to: Order['status']; at: string }>;
}
interface CancelRequest {
  _id: string;
  reason: string;
  version: number;
  createdAt: string;
  orderId: {
    _id: string;
    code: string;
    status: string;
    paymentStatus: string;
    total: number;
    paidAmount?: number | null;
  };
}

const COLUMNS: Array<{ status: Order['status']; label: string; next?: Order['status'] }> = [
  { status: 'PENDING', label: 'Chờ xác nhận', next: 'CONFIRMED' },
  { status: 'CONFIRMED', label: 'Đã nhận', next: 'PREPARING' },
  { status: 'PREPARING', label: 'Đang pha', next: 'READY' },
  { status: 'READY', label: 'Sẵn sàng', next: 'SERVED' },
];
const LATE_AFTER_MINUTES: Partial<Record<Order['status'], number>> = {
  PENDING: 5,
  CONFIRMED: 5,
  PREPARING: 10,
  READY: 5,
};

export function StaffKDS(): JSX.Element {
  useDocumentTitle('KDS');
  const queryClient = useQueryClient();
  const awaiting = useQuery({
    queryKey: ['staff-awaiting-payments'],
    queryFn: async () =>
      unwrap<{ items: Array<{ _id: string }> }>(await api.get('/staff/awaiting-payments')),
    refetchInterval: 5_000,
  });
  const { toast } = useToast();
  const [detailId, setDetailId] = useState<string | null>(null);
  const [, setClock] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setClock((value) => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const ordersQuery = useQuery({
    queryKey: ['staff-orders'],
    queryFn: async () => unwrap(await api.get<{ items: Order[] }>('/staff/orders')),
    refetchInterval: 10_000,
  });
  const cancelRequests = useQuery({
    queryKey: ['staff-cancel-requests'],
    queryFn: async () =>
      unwrap<{ items: CancelRequest[] }>(await api.get('/staff/cancel-requests')),
    refetchInterval: 8_000,
  });

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const handler = () => {
      queryClient.invalidateQueries({ queryKey: ['staff-orders'] });
    };
    socket.on('order.created', handler);
    socket.on('order.statusChanged', handler);
    return () => {
      socket.off('order.created', handler);
      socket.off('order.statusChanged', handler);
    };
  }, [queryClient]);

  const transition = useMutation({
    mutationFn: async (input: { id: string; status: Order['status'] }) =>
      unwrap(await api.patch(`/staff/orders/${input.id}/status`, { status: input.status })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff-orders'] });
    },
    onError: (err) =>
      toast({
        title: 'Không thể chuyển trạng thái',
        description: getErrorMessage(err),
        tone: 'danger',
      }),
  });
  const refund = useMutation({
    mutationFn: (order: Order) =>
      api.post(`/staff/orders/${order._id}/refund`, {
        expectedVersion: order.version,
        amount: order.total,
        method: 'CASH',
        reason: 'Nhân viên đã hoàn đủ tiền mặt và hủy đơn trước pha chế',
        refundConfirmed: true,
      }),
    onSuccess: () => {
      for (const key of ['staff-orders', 'staff-cancel-requests', 'staff-bill', 'cash-shift'])
        void queryClient.invalidateQueries({ queryKey: [key] });
      toast({ title: 'Đã ghi nhận hoàn tiền và hủy đơn', tone: 'success' });
    },
    onError: (error) =>
      toast({
        title: 'Chưa ghi nhận được hoàn tiền',
        description: getErrorMessage(error),
        tone: 'danger',
      }),
  });
  const decideCancel = useMutation({
    mutationFn: ({
      request,
      decision,
    }: {
      request: CancelRequest;
      decision: 'APPROVED' | 'REJECTED';
    }) =>
      api.patch(`/staff/cancel-requests/${request._id}`, {
        decision,
        expectedVersion: request.version,
        ...(decision === 'APPROVED' &&
        (request.orderId.paymentStatus === 'PAID' || (request.orderId.paidAmount ?? 0) > 0)
          ? { refundConfirmed: true, refundMethod: 'CASH' }
          : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['staff-cancel-requests'] });
      void queryClient.invalidateQueries({ queryKey: ['staff-orders'] });
    },
    onError: (error) =>
      toast({
        title: 'Không thể xử lý yêu cầu hủy',
        description: getErrorMessage(error),
        tone: 'danger',
      }),
  });

  const grouped = useMemo(() => {
    const map = new Map<Order['status'], Order[]>();
    for (const c of COLUMNS) map.set(c.status, []);
    if (ordersQuery.data?.items) {
      for (const o of ordersQuery.data.items) {
        const col = map.get(o.status);
        if (col) col.push(o);
      }
      for (const orders of map.values())
        orders.sort((left, right) => stageStartedAt(left) - stageStartedAt(right));
    }
    return map;
  }, [ordersQuery.data]);

  if (ordersQuery.isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-64" />
        ))}
      </div>
    );
  }

  if (ordersQuery.isError) {
    return (
      <ErrorState
        message={getErrorMessage(ordersQuery.error)}
        onRetry={() => ordersQuery.refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold">Kitchen Display</h1>
          <p className="text-sm text-muted-foreground">
            Đơn mới tự cập nhật. Kiểm tra số bàn và tùy chọn trước khi pha chế.
          </p>
        </div>
        <Link
          to="/staff/tables"
          className="inline-flex min-h-12 items-center gap-3 rounded-2xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm font-semibold text-foreground transition hover:bg-accent/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <WalletCards className="h-5 w-5 text-primary" />
          Chờ thanh toán
          {awaiting.data ? <Badge tone="warning">{awaiting.data.items.length}</Badge> : null}
        </Link>
      </div>
      {(cancelRequests.data?.items.length ?? 0) > 0 ? (
        <Card className="border-warning/50 p-3">
          <h2 className="font-display font-semibold">Yêu cầu hủy đang chờ</h2>
          <div className="mt-2 space-y-2">
            {cancelRequests.data!.items.map((request) => (
              <div
                key={request._id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-warning/10 p-2 text-sm"
              >
                <span>
                  <strong>{request.orderId.code}</strong> · {request.reason}
                </span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={decideCancel.isPending}
                    onClick={() => decideCancel.mutate({ request, decision: 'REJECTED' })}
                  >
                    Từ chối
                  </Button>
                  <Button
                    size="sm"
                    disabled={decideCancel.isPending}
                    onClick={() => {
                      if (
                        (request.orderId.paymentStatus !== 'PAID' &&
                          (request.orderId.paidAmount ?? 0) === 0) ||
                        window.confirm(
                          `Chỉ tiếp tục sau khi đã hoàn ${vnd(request.orderId.paidAmount ?? request.orderId.total)} bằng TIỀN MẶT cho khách. Xác nhận đã hoàn đủ tiền?`,
                        )
                      )
                        decideCancel.mutate({ request, decision: 'APPROVED' });
                    }}
                  >
                    {request.orderId.paymentStatus === 'PAID' ||
                    (request.orderId.paidAmount ?? 0) > 0
                      ? 'Đã hoàn tiền mặt & duyệt hủy'
                      : 'Duyệt hủy'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((c, index) => {
          const items = grouped.get(c.status) ?? [];
          return (
            <section
              key={c.status}
              aria-label={c.label}
              className="min-w-0 rounded-2xl border border-foreground/10 bg-muted/35 p-3"
            >
              <div className="mb-4 flex items-center justify-between border-b border-foreground/10 pb-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 rounded-full ${index === 0 ? 'bg-accent' : 'bg-primary'}`}
                  />
                  {c.label}
                </h2>
                <Badge className="tabular-nums" tone={items.length ? 'info' : 'neutral'}>
                  {items.length}
                </Badge>
              </div>
              {items.length === 0 ? (
                <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-foreground/15 p-6 text-sm text-muted-foreground lg:min-h-64">
                  Trống
                </div>
              ) : (
                <div className="space-y-3">
                  {items.map((order) => (
                    <OrderCard
                      key={order._id}
                      order={order}
                      busy={transition.isPending || refund.isPending || decideCancel.isPending}
                      nextStatus={c.next}
                      onCancel={() => {
                        if (order.paymentStatus === 'PAID') {
                          if (
                            window.confirm(
                              `Chỉ xác nhận sau khi đã hoàn ${vnd(order.total)} bằng TIỀN MẶT. Hủy đơn ${order.code} và ghi nhận đã hoàn đủ tiền?`,
                            )
                          )
                            refund.mutate(order);
                        } else transition.mutate({ id: order._id, status: 'CANCELLED' });
                      }}
                      onAdvance={() => transition.mutate({ id: order._id, status: c.next! })}
                      onView={() => setDetailId(order._id)}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
      <OrderDetailModal orderId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}

function OrderCard({
  order,
  nextStatus,
  onAdvance,
  onCancel,
  busy,
  onView,
}: {
  order: Order;
  nextStatus?: Order['status'];
  onAdvance: () => void;
  onCancel: () => void;
  busy: boolean;
  onView: () => void;
}): JSX.Element {
  const ageMin = Math.max(0, Math.floor((Date.now() - stageStartedAt(order)) / 60000));
  const threshold = LATE_AFTER_MINUTES[order.status] ?? 10;
  const isLate = ageMin >= threshold;
  return (
    <Card className={`p-3 space-y-2 ${isLate ? 'border-danger/60' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-display font-semibold">{order.code}</p>
          <p className="font-semibold text-primary">{order.tableName}</p>
          {order.scheduledAt ? <p className="text-xs">Hẹn {new Date(order.scheduledAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</p> : null}
          <p className="text-xs text-muted-foreground">
            {new Date(order.createdAt).toLocaleTimeString('vi-VN', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        </div>
        <Badge tone={isLate ? 'danger' : 'info'}>
          {isLate ? `Quá hạn · ${ageMin} phút` : `${ageMin} phút`}
        </Badge>
      </div>
      <ul className="space-y-1 text-sm">
        {order.items.map((it, idx) => (
          <li key={idx} className="flex flex-col">
            <span className="font-medium">
              {it.quantity} x {it.nameSnapshot}
              {it.sizeName ? ` (${it.sizeName})` : ''}
            </span>
            <span className="text-xs text-muted-foreground">
              Đường {it.sugarLevel} · {labelIce(it.iceLevel)} · {vnd(it.lineTotal)}
            </span>
            {it.note ? (
              <span className="text-xs italic text-accent">Ghi chú: {it.note}</span>
            ) : null}
            {it.toppingNamesSnapshot?.length ? (
              <span className="text-xs">Topping: {it.toppingNamesSnapshot.join(', ')}</span>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        {nextStatus ? (
          <Button
            onClick={onAdvance}
            disabled={busy}
            size="sm"
            className="flex-1"
            aria-label={`Chuyển sang ${nextStatus === 'SERVED' && order.fulfillmentType && order.fulfillmentType !== 'DINE_IN' ? 'Khách đã nhận' : statusLabel(nextStatus)}`}
          >
            {nextStatus === 'SERVED' && order.fulfillmentType && order.fulfillmentType !== 'DINE_IN' ? 'Khách đã nhận' : statusLabel(nextStatus)} <ChevronRight className="h-4 w-4 shrink-0" />
          </Button>
        ) : null}
        <Button variant="outline" size="sm" onClick={onView} title="Xem chi tiết">
          <Eye className="h-4 w-4" />
        </Button>
      </div>
      {['PENDING', 'CONFIRMED'].includes(order.status) ? (
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          className="w-full"
          onClick={() => {
            if (window.confirm(`Hủy đơn ${order.code}?`)) onCancel();
          }}
        >
          {order.paymentStatus === 'PAID' ? 'Hủy & xác nhận đã hoàn tiền' : 'Hủy đơn'}
        </Button>
      ) : null}
    </Card>
  );
}

function stageStartedAt(order: Order): number {
  const entry = [...(order.statusHistory ?? [])]
    .reverse()
    .find((value) => value.to === order.status);
  const stageAt = new Date(entry?.at ?? order.createdAt).getTime();
  return order.scheduledAt && ['PENDING', 'CONFIRMED'].includes(order.status)
    ? Math.max(stageAt, new Date(order.scheduledAt).getTime() - 15 * 60000)
    : stageAt;
}

function statusLabel(s: Order['status']): string {
  switch (s) {
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
  }
}

function labelIce(v: string): string {
  return v === 'no-ice' ? 'không đá' : v === 'less-ice' ? 'ít đá' : 'đá thường';
}
