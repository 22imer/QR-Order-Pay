import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap, vnd, getErrorMessage } from '../../lib/api';
import { useAuth } from '../auth/useAuth';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { ErrorState } from '../../components/ui/EmptyState';
import { useToast } from '../../components/ui/useToast';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';
import { paymentCorrectionRequestSchema, type PaymentMethod } from '@may-cafe/contracts';

interface Receipt {
  id: string;
  amount: number;
  method: PaymentMethod;
  status: string;
  paidAt: string;
  refundedAt: string | null;
  refundReason: string;
  reversalKind: string | null;
  replacesPaymentId: string | null;
  orders: Array<{ code: string; tableName: string } | null>;
}
interface Correction {
  _id: string;
  paymentId: string;
  receipt?: Receipt | null;
  targetOrder?: { code: string; tableName: string } | null;
  kind: 'VOID' | 'METHOD' | 'TRANSFER';
  reason: string;
  method: PaymentMethod | null;
  targetOrderId: string | null;
  status: string;
  requestedBy: string;
  requestedByName: string;
  decidedByName: string;
  decisionNote: string;
  version: number;
}
interface Accounting {
  items: Receipt[];
  total: number;
  corrections: Correction[];
  targets: Array<{ _id: string; code: string; total: number; paidAmount?: number }>;
}
const METHODS: Record<PaymentMethod, string> = {
  CASH: 'Tiền mặt',
  BANK_TRANSFER: 'Chuyển khoản',
  OTHER: 'Khác',
};
const KINDS = {
  VOID: 'Hủy ghi nhận thu',
  METHOD: 'Sửa phương thức',
  TRANSFER: 'Chuyển sang đúng đơn',
};

export function PaymentAccounting({ admin = false }: { admin?: boolean }): JSX.Element {
  useDocumentTitle('Khoản thu & điều chỉnh');
  const [page, setPage] = useState(1);
  const prefix = admin ? '/admin' : '/staff';
  const query = useQuery({
    queryKey: ['payment-accounting', prefix, page],
    queryFn: async () => unwrap<Accounting>(await api.get(`${prefix}/payments?page=${page}`)),
    refetchInterval: 5_000,
  });
  const [selected, setSelected] = useState<Receipt | null>(null);
  const [kind, setKind] = useState<Correction['kind']>('METHOD');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [targetOrderId, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const [decision, setDecision] = useState<{ request: Correction; approve: boolean } | null>(null);
  const [note, setNote] = useState('');
  const user = useAuth((state) => state.user);
  const qc = useQueryClient();
  const { toast } = useToast();
  const refresh = () => {
    for (const key of [
      'payment-accounting',
      'staff-awaiting-payments',
      'staff-orders',
      'staff-table-sessions',
      'staff-bill',
      'cash-shift',
      'admin-overview',
    ])
      void qc.invalidateQueries({ queryKey: [key] });
  };
  const fail = (error: unknown) => {
    refresh();
    toast({
      title: 'Chưa xử lý được khoản thu',
      description: getErrorMessage(error),
      tone: 'danger',
    });
  };
  const request = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error('Chưa chọn khoản thu.');
      const payload = paymentCorrectionRequestSchema.parse({
        kind,
        reason,
        ...(kind === 'METHOD' ? { method } : {}),
        ...(kind === 'TRANSFER' ? { targetOrderId } : {}),
      });
      return api.post(`${prefix}/payments/${selected.id}/corrections`, payload);
    },
    onSuccess: () => {
      setSelected(null);
      refresh();
      toast({ title: 'Đã gửi yêu cầu; chờ quản lý khác duyệt', tone: 'success' });
    },
    onError: fail,
  });
  const review = useMutation({
    mutationFn: async () => {
      if (!decision) throw new Error('Chưa chọn yêu cầu.');
      return api.post(`/admin/payment-corrections/${decision.request._id}/decision`, {
        approve: decision.approve,
        expectedVersion: decision.request.version,
        note,
      });
    },
    onSuccess: () => {
      setDecision(null);
      refresh();
      toast({ title: 'Đã xử lý yêu cầu điều chỉnh', tone: 'success' });
    },
    onError: fail,
  });
  if (query.isError)
    return <ErrorState message={getErrorMessage(query.error)} onRetry={() => query.refetch()} />;
  const pending = query.data?.corrections.filter((item) => item.status === 'REQUESTED') ?? [];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Khoản thu & điều chỉnh</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Giữ nguyên khoản thu gốc. Mọi điều chỉnh có lý do và cần quản lý khác duyệt. Hủy ghi nhận
          thu dùng khi ghi nhầm; tiền đã thực nhận cần dùng luồng hoàn tiền tại đơn.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Hủy thu hoặc chuyển sang đúng đơn chỉ áp dụng trước pha chế. Sửa phương thức được thực
          hiện sau đóng phiên; hóa đơn đã chốt giữ nguyên và đối soát qua lịch sử dưới đây.
        </p>
      </div>
      <section className="space-y-3">
        <h2 className="font-semibold">Chờ duyệt ({pending.length})</h2>
        {!pending.length ? (
          <p className="text-sm text-muted-foreground">Không có yêu cầu chờ duyệt.</p>
        ) : (
          pending.map((item) => (
            <Card key={item._id} className="space-y-2 p-4">
              <p className="font-semibold">
                {KINDS[item.kind]} · {item.requestedByName}
              </p>
              {item.receipt ? (
                <p className="text-sm">
                  {item.receipt.orders
                    .map((order) => (order ? `${order.tableName} · ${order.code}` : ''))
                    .join(', ')}{' '}
                  · {vnd(item.receipt.amount)} · {METHODS[item.receipt.method]}
                </p>
              ) : null}
              <p className="break-all text-xs text-muted-foreground">Khoản thu: {item.paymentId}</p>
              <p className="text-sm">{item.reason}</p>
              {item.method ? (
                <p className="text-sm">Phương thức đúng: {METHODS[item.method]}</p>
              ) : null}
              {item.targetOrderId ? (
                <p className="break-all text-sm">
                  Đơn nhận:{' '}
                  {item.targetOrder
                    ? `${item.targetOrder.tableName} · ${item.targetOrder.code}`
                    : item.targetOrderId}
                </p>
              ) : null}
              {admin && item.requestedBy !== user?.id ? (
                <div className="flex gap-2">
                  {[true, false].map((approve) => (
                    <Button
                      key={String(approve)}
                      size="sm"
                      variant={approve ? 'primary' : 'outline'}
                      onClick={() => {
                        setNote('');
                        setDecision({ request: item, approve });
                      }}
                    >
                      {approve ? 'Kiểm tra & duyệt' : 'Từ chối'}
                    </Button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Cần quản lý khác duyệt trong cổng quản trị.
                </p>
              )}
            </Card>
          ))
        )}
      </section>
      <section className="space-y-3">
        <h2 className="font-semibold">Lịch sử khoản thu ({query.data?.total ?? 0})</h2>
        {query.isLoading ? (
          <p>Đang tải khoản thu…</p>
        ) : !query.data?.items.length ? (
          <p>Chưa có khoản thu.</p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {query.data.items.map((item) => (
              <Card key={item.id} className="space-y-2 p-4">
                <p className="font-semibold">
                  {item.orders
                    .map((order) =>
                      order ? `${order.tableName} · ${order.code}` : 'Đơn đã lưu trữ',
                    )
                    .join(', ')}
                </p>
                <p>
                  {vnd(item.amount)} · {METHODS[item.method]}
                </p>
                <p className="text-xs text-muted-foreground">
                  Thu lúc{' '}
                  {new Date(item.paidAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}
                </p>
                <p className="break-all text-xs text-muted-foreground">Mã khoản thu: {item.id}</p>
                {item.replacesPaymentId ? (
                  <p className="break-all text-xs">Thay thế khoản thu: {item.replacesPaymentId}</p>
                ) : null}
                <p className="text-sm">
                  {item.status === 'SUCCESS'
                    ? 'Đã ghi nhận'
                    : item.reversalKind
                      ? 'Đã đảo ghi nhận'
                      : 'Đã hoàn tiền'}
                </p>
                {item.refundedAt ? (
                  <p className="text-sm">
                    {new Date(item.refundedAt).toLocaleString('vi-VN')} · {item.refundReason}
                  </p>
                ) : null}
                {item.status === 'SUCCESS' &&
                !pending.some((correction) => correction.paymentId === item.id) ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setSelected(item);
                      setReason('');
                      setKind('METHOD');
                      setMethod(item.method === 'CASH' ? 'BANK_TRANSFER' : 'CASH');
                      setTarget('');
                    }}
                  >
                    Yêu cầu điều chỉnh
                  </Button>
                ) : null}
              </Card>
            ))}
          </div>
        )}
        <div className="flex items-center gap-3">
          <Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>
            Trước
          </Button>
          <span>Trang {page}</span>
          <Button
            variant="outline"
            disabled={page * 30 >= (query.data?.total ?? 0)}
            onClick={() => setPage(page + 1)}
          >
            Sau
          </Button>
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="font-semibold">Điều chỉnh đã xử lý</h2>
        {query.data?.corrections
          .filter((item) => item.status !== 'REQUESTED')
          .map((item) => (
            <Card key={item._id} className="p-4 text-sm">
              <p className="font-semibold">
                {KINDS[item.kind]} · {item.status === 'APPROVED' ? 'Đã duyệt' : 'Từ chối'}
              </p>
              <p>{item.reason}</p>
              <p>
                {item.decidedByName}: {item.decisionNote}
              </p>
              <p className="break-all text-xs text-muted-foreground">Khoản thu: {item.paymentId}</p>
            </Card>
          ))}
      </section>
      <Modal
        open={!!selected}
        onOpenChange={(open) => {
          if (!open && !request.isPending) setSelected(null);
        }}
        title="Yêu cầu điều chỉnh khoản thu"
      >
        <div className="space-y-4">
          <p>
            {selected ? vnd(selected.amount) : ''} ·{' '}
            {selected?.orders.map((order) => order?.code).join(', ')}
          </p>
          <label className="block">
            Loại điều chỉnh
            <select
              className="mt-1 w-full rounded border p-2"
              value={kind}
              onChange={(event) => setKind(event.target.value as Correction['kind'])}
            >
              {Object.entries(KINDS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {kind === 'METHOD' ? (
            <label className="block">
              Phương thức đúng
              <select
                className="mt-1 w-full rounded border p-2"
                value={method}
                onChange={(event) => setMethod(event.target.value as PaymentMethod)}
              >
                {Object.entries(METHODS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {kind === 'TRANSFER' ? (
            <label className="block">
              Đơn nhận khoản thu
              <select
                className="mt-1 w-full rounded border p-2"
                value={targetOrderId}
                onChange={(event) => setTarget(event.target.value)}
              >
                <option value="">Chọn đơn đang chờ thanh toán</option>
                {query.data?.targets.map((order) => (
                  <option key={order._id} value={order._id}>
                    {order.code} · Còn thiếu {vnd(order.total - (order.paidAmount ?? 0))}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {kind === 'VOID' ? (
            <p className="text-sm">
              Đảo khoản thu đã ghi nhầm và mở lại dư nợ. Thao tác này không chuyển tiền hay ghi nhận
              hoàn tiền cho khách.
            </p>
          ) : null}
          <label className="block">
            Lý do
            <Input
              value={reason}
              maxLength={280}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <Button
            disabled={
              request.isPending ||
              reason.trim().length < 3 ||
              (kind === 'TRANSFER' && !targetOrderId)
            }
            onClick={() => request.mutate()}
          >
            Gửi quản lý duyệt
          </Button>
        </div>
      </Modal>
      <Modal
        open={!!decision}
        onOpenChange={(open) => {
          if (!open && !review.isPending) setDecision(null);
        }}
        title={decision?.approve ? 'Duyệt điều chỉnh khoản thu' : 'Từ chối điều chỉnh'}
      >
        <div className="space-y-4">
          <p>
            {decision ? KINDS[decision.request.kind] : ''} · {decision?.request.reason}
          </p>
          {decision?.request.receipt ? (
            <p>
              {decision.request.receipt.orders
                .map((order) => (order ? `${order.tableName} · ${order.code}` : ''))
                .join(', ')}{' '}
              · {vnd(decision.request.receipt.amount)} · {METHODS[decision.request.receipt.method]}
            </p>
          ) : null}
          {decision?.request.method ? (
            <p>Phương thức đúng: {METHODS[decision.request.method]}</p>
          ) : null}
          {decision?.request.targetOrder ? (
            <p>
              Chuyển sang {decision.request.targetOrder.tableName} ·{' '}
              {decision.request.targetOrder.code}
            </p>
          ) : null}
          <label className="block">
            Ghi chú kiểm tra
            <Input value={note} maxLength={280} onChange={(event) => setNote(event.target.value)} />
          </label>
          <Button
            disabled={review.isPending || note.trim().length < 3}
            onClick={() => review.mutate()}
          >
            {decision?.approve ? 'Xác nhận duyệt' : 'Xác nhận từ chối'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
