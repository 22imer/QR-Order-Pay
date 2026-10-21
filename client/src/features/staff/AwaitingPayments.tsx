import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  generateIdempotencyKey,
  getErrorCode,
  getErrorMessage,
  unwrap,
  vnd,
} from '../../lib/api';
import { paymentMethodSchema, type PaymentMethod, type StaffOrder } from '@may-cafe/contracts';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Modal } from '../../components/ui/Modal';
import { ErrorState } from '../../components/ui/EmptyState';
import { useToast } from '../../components/ui/useToast';
import { WalletCards } from 'lucide-react';
import { Input } from '../../components/ui/Input';
import { usePaymentClaim } from './usePaymentClaim';
import { BenefitBreakdown } from '../../components/BenefitBreakdown';

export function AwaitingPayments(): JSX.Element {
  const query = useQuery({
    queryKey: ['staff-awaiting-payments'],
    queryFn: async () => unwrap<{ items: StaffOrder[] }>(await api.get('/staff/awaiting-payments')),
    refetchInterval: 5_000,
  });
  return (
    <section className="space-y-4 rounded-3xl border border-accent/30 bg-accent/5 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent/15 text-primary">
          <WalletCards className="h-5 w-5" />
        </span>
        <h2 className="font-display text-xl font-semibold">
          Chờ thanh toán ({query.data?.items?.length ?? 0})
        </h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Ghi đúng số tiền thực nhận. Chỉ đơn đã thu đủ mới xuất hiện ở KDS.
      </p>
      {query.isError ? (
        <ErrorState message={getErrorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : query.isLoading ? (
        <p>Đang tải đơn chờ…</p>
      ) : !query.data?.items?.length ? (
        <p className="text-sm text-muted-foreground">Không có đơn chờ thanh toán.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {query.data.items.map((order) => (
            <PaymentCard key={order._id} order={order} />
          ))}
        </div>
      )}
    </section>
  );
}
function PaymentCard({ order }: { order: StaffOrder }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const remaining = order.balanceDue ?? order.total;
  const [amount, setAmount] = useState(String(remaining));
  const [claiming, setClaiming] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const claim = usePaymentClaim(order.tableSessionId ?? '', open);
  const attempt = useRef<{
    signature: string;
    key: string;
    payload: { amount: number; method: PaymentMethod; expectedVersion: number };
  } | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();
  const refresh = () => {
    for (const key of [
      'staff-awaiting-payments',
      'staff-orders',
      'staff-table-sessions',
      'staff-bill',
      'cash-shift',
      'payment-accounting',
    ])
      void qc.invalidateQueries({ queryKey: [key] });
  };
  const payment = useMutation({
    mutationFn: async () => {
      const signature = JSON.stringify({ amount: Number(amount), method });
      if (attempt.current?.signature !== signature)
        attempt.current = {
          signature,
          key: generateIdempotencyKey(),
          payload: { amount: Number(amount), method, expectedVersion: order.version },
        };
      return api.post(`/staff/orders/${order._id}/payments`, attempt.current.payload, {
        headers: { 'Idempotency-Key': attempt.current.key, 'X-Payment-Claim': claim.token },
      });
    },
    onSuccess: () => {
      setOpen(false);
      attempt.current = null;
      setUncertain(false);
      refresh();
      toast({
        title:
          Number(amount) === remaining
            ? 'Đã nhận đủ tiền — đơn đã chuyển sang KDS'
            : 'Đã ghi nhận khoản thu; đơn vẫn chờ thanh toán đủ',
        tone: 'success',
      });
    },
    onError: (error) => {
      const code = getErrorCode(error);
      if (code && !['INTERNAL', 'INTERNAL_ERROR'].includes(code)) {
        attempt.current = null;
        setUncertain(false);
        refresh();
      } else setUncertain(true);
      toast({
        title: 'Chưa xác nhận được tiền',
        description: getErrorMessage(error),
        tone: 'danger',
      });
    },
  });
  const cancel = useMutation({
    mutationFn: () =>
      api.patch(`/staff/orders/${order._id}/status`, {
        status: 'CANCELLED',
        reason: 'Hủy đơn chưa thanh toán',
      }),
    onSuccess: refresh,
    onError: (error) =>
      toast({ title: 'Không thể hủy đơn', description: getErrorMessage(error), tone: 'danger' }),
  });
  return (
    <Card className="space-y-3 p-4">
      <p className="font-semibold">
        {order.tableName} · {order.code}
      </p>
      <ul className="text-sm">
        {order.items.map((item, index) => (
          <li key={index}>
            {item.quantity} × {item.nameSnapshot}
            {item.sizeName ? ` (${item.sizeName})` : ''} · {vnd(item.lineTotal)}
          </li>
        ))}
      </ul>
      <BenefitBreakdown order={order} />
      <p className="text-sm">
        Tổng: {vnd(order.total)} · Đã thu: {vnd(order.paidAmount ?? 0)}
      </p>
      <p className="font-semibold">Còn phải thu: {vnd(remaining)}</p>
      {order.collectionClaim ? (
        <p className="text-sm text-muted-foreground">
          {order.collectionClaim.ownerName} đang nhận thu tiền cho bàn này.
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={claiming || payment.isPending || cancel.isPending}
          onClick={async () => {
            setClaiming(true);
            try {
              await claim.acquire();
              setAmount(String(remaining));
              setOpen(true);
            } catch (error) {
              refresh();
              toast({
                title: 'Chưa nhận được quyền thu tiền',
                description: getErrorMessage(error),
                tone: 'danger',
              });
            } finally {
              setClaiming(false);
            }
          }}
        >
          Kiểm tra & nhận tiền
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={payment.isPending || cancel.isPending || (order.paidAmount ?? 0) > 0}
          onClick={() => {
            if (window.confirm(`Hủy đơn chưa thanh toán ${order.code}?`)) cancel.mutate();
          }}
        >
          Hủy đơn
        </Button>
      </div>
      <Modal
        open={open}
        onOpenChange={(value) => {
          if (!payment.isPending && !uncertain) setOpen(value);
        }}
        title={`Nhận tiền · ${order.code}`}
      >
        <div className="space-y-4">
          <p>
            {order.tableName} · Còn phải thu: <strong>{vnd(remaining)}</strong>
          </p>
          <label className="block">
            Số tiền thực nhận (VND)
            <Input
              aria-label="Số tiền thực nhận (VND)"
              type="number"
              min={remaining === 0 ? 0 : 1}
              max={remaining}
              step="1"
              value={amount}
              disabled={payment.isPending || uncertain}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          <label className="block">
            Phương thức thanh toán
            <select
              aria-label="Phương thức thanh toán"
              className="mt-1 w-full rounded border p-2"
              value={method}
              disabled={payment.isPending || uncertain}
              onChange={(event) => {
                const parsed = paymentMethodSchema.safeParse(event.target.value);
                if (parsed.success) setMethod(parsed.data);
              }}
            >
              <option value="CASH">Tiền mặt</option>
              <option value="BANK_TRANSFER">Chuyển khoản — đã kiểm tra tiền thực nhận</option>
              <option value="OTHER">Khác</option>
            </select>
          </label>
          <p className="text-sm text-muted-foreground">
            Chỉ ghi số tiền thực tế đã kiểm tra. Thu thiếu thì đơn tiếp tục chờ; bàn vẫn mở để khách
            gọi thêm món.
          </p>
          {!claim.valid ? (
            <p role="alert">
              Quyền thu tiền đã hết hạn. Đóng và mở lại để kiểm tra trước khi nhận tiền.
            </p>
          ) : null}
          {uncertain ? (
            <p role="alert">
              Chưa rõ kết quả do mất kết nối. Bấm thử lại cùng khoản thu; không nhận thêm tiền.
            </p>
          ) : null}
          <Button
            disabled={
              payment.isPending ||
              (!uncertain &&
                (!claim.valid ||
                  !Number.isInteger(Number(amount)) ||
                  !amount ||
                  Number(amount) > remaining ||
                  Number(amount) < (remaining === 0 ? 0 : 1)))
            }
            onClick={() => payment.mutate()}
          >
            {payment.isPending
              ? 'Đang xác nhận…'
              : uncertain
                ? 'Thử lại cùng khoản thu'
                : Number(amount) === remaining
                  ? 'Đã nhận đủ tiền — chuyển KDS'
                  : 'Ghi nhận khoản thu một phần'}
          </Button>
          {(order.paidAmount ?? 0) > 0 ? (
            <Button
              variant="outline"
              disabled={payment.isPending || uncertain || !claim.valid}
              onClick={() => {
                if (
                  !window.confirm(`Đã hoàn lại ${vnd(order.paidAmount ?? 0)} cho khách và hủy đơn?`)
                )
                  return;
                void api
                  .post(`/staff/orders/${order._id}/refund`, {
                    amount: order.paidAmount,
                    method,
                    expectedVersion: order.version,
                    reason: 'Khách hủy đơn đã thu một phần',
                    refundConfirmed: true,
                  })
                  .then(() => {
                    setOpen(false);
                    refresh();
                  })
                  .catch((error) =>
                    toast({
                      title: 'Chưa hoàn được tiền',
                      description: getErrorMessage(error),
                      tone: 'danger',
                    }),
                  );
              }}
            >
              Đã hoàn tiền — hủy đơn
            </Button>
          ) : null}
        </div>
      </Modal>
    </Card>
  );
}
