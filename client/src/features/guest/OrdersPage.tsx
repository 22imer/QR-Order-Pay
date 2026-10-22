import { useQuery } from '@tanstack/react-query';
import { BenefitBreakdown } from '../../components/BenefitBreakdown';
import { useEffect, useState } from 'react';
import { ListChecks, ReceiptText, Star, X } from 'lucide-react';
import type { GuestOrder } from '@may-cafe/contracts';
import { Badge } from '../../components/ui/Badge';
import { api, getErrorMessage, unwrap, vnd } from '../../lib/api';
import { cn } from '../../lib/cn';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/useToast';
import { EmptyState, ErrorState } from '../../components/ui/EmptyState';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';
import { Skeleton } from '../../components/ui/Skeleton';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getSocket } from '../../lib/socket';
import { OrderReview } from './OrderReview';
import { GiftLabel } from '../../components/GiftLabel';

type Order = GuestOrder;

const MIN_REASON_LENGTH = 3;

export function OrdersPage(): JSX.Element {
  useDocumentTitle('Đơn của tôi');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [cancelTarget, setCancelTarget] = useState<Order | null>(null);
  const [reason, setReason] = useState('');
  const [reviewTargetId, setReviewTargetId] = useState<string | null>(null);

  const ordersQuery = useQuery({
    queryKey: ['my-orders'],
    queryFn: async () => unwrap(await api.get<{ orders: Order[] }>('/orders/mine')),
    refetchInterval: 15_000,
  });

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const handler = () => {
      queryClient.invalidateQueries({ queryKey: ['my-orders'] });
      toast({ title: 'Đơn của bạn vừa cập nhật', tone: 'info' });
    };
    socket.on('order.statusChanged', handler);
    socket.on('payment.confirmed', handler);
    return () => {
      socket.off('order.statusChanged', handler);
      socket.off('payment.confirmed', handler);
    };
  }, [queryClient, toast]);

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => unwrap(await api.post(`/orders/${id}/cancel`)),
    onSuccess: () => {
      toast({ title: 'Đã huỷ đơn', tone: 'success' });
      queryClient.invalidateQueries({ queryKey: ['my-orders'] });
    },
    onError: (err) =>
      toast({ title: 'Không thể huỷ', description: getErrorMessage(err), tone: 'danger' }),
  });
  const cancelRequestMutation = useMutation({
    mutationFn: async ({ id, text }: { id: string; text: string }) =>
      unwrap(await api.post(`/orders/${id}/cancel-requests`, { reason: text })),
    onSuccess: () => {
      closeCancelDialog();
      toast({
        title: 'Đã gửi yêu cầu hủy',
        description: 'Nhân viên sẽ xem xét trước khi pha chế.',
        tone: 'success',
      });
    },
    onError: (error) =>
      toast({
        title: 'Không gửi được yêu cầu hủy',
        description: getErrorMessage(error),
        tone: 'danger',
      }),
  });

  function closeCancelDialog(): void {
    setCancelTarget(null);
    setReason('');
  }

  const requestBill = useMutation({
    mutationFn: async () => {
      // No dedicated endpoint yet; trigger service request to ask for bill.
      await api.post('/service-requests', { type: 'REQUEST_BILL' });
    },
    onSuccess: () =>
      toast({
        title: 'Đã gửi yêu cầu thanh toán',
        description: 'Nhân viên sẽ đến hỗ trợ.',
        tone: 'success',
      }),
    onError: (err) =>
      toast({ title: 'Không gửi được yêu cầu', description: getErrorMessage(err), tone: 'danger' }),
  });

  if (ordersQuery.isLoading) {
    return (
      <div className="space-y-4 pt-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-48 rounded-3xl" />
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

  const orders = ordersQuery.data?.orders ?? [];
  const reviewTarget = orders.find(
    (order) =>
      order._id === reviewTargetId && order.status === 'SERVED' && order.paymentStatus === 'PAID',
  );
  if (orders.length === 0) {
    return (
      <EmptyState
        title="Bạn chưa có đơn nào"
        description="Khi gửi đơn, tiến độ sẽ hiển thị tại đây."
        icon={<ListChecks className="h-6 w-6" />}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 pt-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="g-display text-[2.25rem]">Đơn của bạn</h1>
        <Button
          variant="outline"
          onClick={() => requestBill.mutate()}
          disabled={requestBill.isPending}
        >
          <ReceiptText className="h-4 w-4" /> Nhờ nhân viên hỗ trợ thanh toán
        </Button>
      </div>

      <div className="space-y-8">
        {orders.map((order) => (
          <div key={order._id} className="slip-wrap">
            <article className="slip px-5 pt-5">
              <header className="flex items-start justify-between gap-3">
                <div>
                  {formatTime(order.createdAt) ? (
                    <p className="text-sm text-muted-foreground">
                      Đặt lúc {formatTime(order.createdAt)}
                    </p>
                  ) : null}
                  <h2 className="g-display text-2xl">{order.code}</h2>
                  <GiftLabel gift={order.gift} />
                </div>
                <Badge
                  tone={
                    order.status === 'CANCELLED'
                      ? 'danger'
                      : order.status === 'SERVED'
                        ? 'success'
                        : 'info'
                  }
                >
                  {statusLabel(order.status)}
                </Badge>
              </header>

              <div className="slip-rule mt-4" />
              <ul className="space-y-3 py-4">
                {order.items.map((it, idx) => (
                  <li key={`${order._id}-${idx}`}>
                    <div className="flex items-end gap-2">
                      <span className="leading-snug">
                        {it.quantity} × {it.nameSnapshot}
                        {it.sizeName ? ` (${it.sizeName})` : ''}
                      </span>
                      <span className="leader" aria-hidden="true" />
                      <span className="tabular-nums">{vnd(it.lineTotal)}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Đường {it.sugarLevel}, {iceLabel(it.iceLevel)}
                    </p>
                  </li>
                ))}
              </ul>

              <BenefitBreakdown order={order} />
              <div className="slip-rule" />
              <div className="flex items-end justify-between gap-3 pt-4">
                <span className="g-title text-lg">Tổng</span>
                <span className="g-display text-3xl tabular-nums">{vnd(order.total)}</span>
              </div>

              <Progress status={order.status} paymentStatus={order.paymentStatus} />
              {(order.paidAmount ?? 0) > 0 && order.paymentStatus === 'UNPAID' ? (
                <p className="mt-3 text-sm">
                  Đã thanh toán {vnd(order.paidAmount ?? 0)} · Còn thiếu{' '}
                  {vnd(order.balanceDue ?? order.total)}. Đơn được pha chế sau khi thanh toán đủ.
                </p>
              ) : null}

              {order.status === 'SERVED' && order.paymentStatus === 'PAID' ? (
                <div className="mt-4">
                  {order.review ? (
                    <OrderReview order={order} />
                  ) : (
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => setReviewTargetId(order._id)}
                    >
                      <Star className="h-4 w-4" /> Đánh giá đơn
                    </Button>
                  )}
                </div>
              ) : null}

              {['AWAITING_PAYMENT', 'PENDING'].includes(order.status) &&
              order.paymentStatus === 'UNPAID' &&
              (order.paidAmount ?? 0) === 0 ? (
                <Button
                  variant="outline"
                  className="mt-4 w-full"
                  onClick={() => cancelMutation.mutate(order._id)}
                  disabled={cancelMutation.isPending}
                >
                  <X className="h-4 w-4" /> Huỷ đơn
                </Button>
              ) : null}
              {order.status === 'CONFIRMED' ||
              (order.status === 'AWAITING_PAYMENT' && (order.paidAmount ?? 0) > 0) ||
              (order.status === 'PENDING' && order.paymentStatus === 'PAID') ? (
                <Button
                  variant="outline"
                  className="mt-4 w-full"
                  onClick={() => setCancelTarget(order)}
                >
                  <X className="h-4 w-4" /> Yêu cầu nhân viên hủy
                </Button>
              ) : null}
            </article>
          </div>
        ))}
      </div>

      <Modal
        open={!!reviewTarget}
        onOpenChange={(open) => {
          if (!open) setReviewTargetId(null);
        }}
        title="Đánh giá đơn"
        description="Chia sẻ cảm nhận về đơn đã phục vụ. Bạn vẫn có thể tiếp tục gọi thêm món."
        className="g-sheet"
      >
        {reviewTarget ? (
          <OrderReview
            key={reviewTarget._id}
            order={reviewTarget}
            onSubmitted={() => setReviewTargetId(null)}
          />
        ) : null}
      </Modal>

      <Modal
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeCancelDialog();
        }}
        title="Yêu cầu hủy đơn"
        description={
          cancelTarget
            ? `Đơn ${cancelTarget.code}. Nhân viên sẽ xem xét trước khi pha chế.`
            : undefined
        }
        className="g-sheet"
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!cancelTarget || reason.trim().length < MIN_REASON_LENGTH) return;
            cancelRequestMutation.mutate({ id: cancelTarget._id, text: reason.trim() });
          }}
        >
          <label className="block text-sm font-semibold">
            Lý do muốn hủy
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={280}
              rows={3}
              placeholder="Ví dụ: mình gọi nhầm món"
              className="mt-2 w-full rounded-2xl border border-foreground/15 bg-card p-3 text-sm font-normal focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <span className="mt-1 block text-xs font-normal text-muted-foreground">
              Nhập ít nhất {MIN_REASON_LENGTH} ký tự.
            </span>
          </label>
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={cancelRequestMutation.isPending || reason.trim().length < MIN_REASON_LENGTH}
          >
            {cancelRequestMutation.isPending ? 'Đang gửi...' : 'Gửi yêu cầu hủy'}
          </Button>
        </form>
      </Modal>
    </div>
  );
}

function statusLabel(s: Order['status']): string {
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
  }
}

function statusHint(s: Order['status']): string {
  switch (s) {
    case 'AWAITING_PAYMENT':
      return 'Vui lòng thanh toán với nhân viên. Đơn chỉ được pha chế sau khi đã nhận đủ tiền.';
    case 'PENDING':
      return 'Đang chờ nhân viên xác nhận đơn.';
    case 'CONFIRMED':
      return 'Nhân viên đã nhận đơn, sắp chuyển cho quầy pha chế.';
    case 'PREPARING':
      return 'Quầy pha chế đang làm đồ uống của bạn.';
    case 'READY':
      return 'Đồ uống đã xong, nhân viên sẽ mang ra bàn.';
    case 'SERVED':
      return 'Đồ uống đã được phục vụ tại bàn.';
    case 'CANCELLED':
      return 'Đơn này đã được hủy.';
  }
}

function iceLabel(v: string): string {
  return v === 'no-ice' ? 'không đá' : v === 'less-ice' ? 'ít đá' : 'đá thường';
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

const STEPS = ['AWAITING_PAYMENT', 'PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED'] as const;

function Progress({
  status,
  paymentStatus,
}: {
  status: Order['status'];
  paymentStatus: Order['paymentStatus'];
}): JSX.Element {
  const reached = status === 'CANCELLED' ? 0 : STEPS.indexOf(status as (typeof STEPS)[number]) + 1;
  return (
    <div className="mt-5">
      <div
        role="progressbar"
        aria-label="Tiến độ đơn"
        aria-valuemin={0}
        aria-valuemax={STEPS.length}
        aria-valuenow={reached}
        aria-valuetext={statusLabel(status)}
        className="flex gap-1.5"
      >
        {STEPS.map((step, index) => (
          <span
            key={step}
            className={cn(
              'h-2 flex-1 rounded-full',
              index >= reached
                ? 'bg-foreground/10'
                : index === reached - 1 && status !== 'SERVED'
                  ? 'bg-accent'
                  : 'bg-primary',
            )}
          />
        ))}
      </div>
      <p className="mt-3 text-sm">
        <span className="font-semibold">{statusLabel(status)}.</span>{' '}
        <span className="text-muted-foreground">{statusHint(status)}</span>
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        Thanh toán:{' '}
        {paymentStatus === 'PAID'
          ? 'Đã thanh toán'
          : paymentStatus === 'REFUNDED'
            ? 'Đã hoàn tiền'
            : 'Chưa thanh toán'}
      </p>
    </div>
  );
}
