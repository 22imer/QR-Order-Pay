import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import {
  api,
  generateIdempotencyKey,
  getErrorCode,
  getErrorMessage,
  unwrap,
  vnd,
} from '../../lib/api';
import { paymentMethodSchema, paymentRequestSchema, type PaymentMethod } from '@may-cafe/contracts';
import { useToast } from '../../components/ui/useToast';
import { EmptyState, ErrorState } from '../../components/ui/EmptyState';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';
import { PaidBillModal } from './PaidBillModal';
import { AwaitingPayments } from './AwaitingPayments';
import { TableDisplaySetup } from './TableDisplaySetup';
import { Table2 } from 'lucide-react';
import { usePaymentClaim } from './usePaymentClaim';

interface Table {
  _id: string;
  code: string;
  name: string;
  capacity: number;
  isActive: boolean;
}
interface SessionItem {
  session: {
    _id: string;
    status: 'OPEN' | 'CHECKOUT' | 'CLOSED';
    version: number;
    source?: 'STAFF' | 'GUEST';
    closedReason?: 'PAID' | 'STAFF' | 'IDLE' | null;
  };
  table: Table;
  orderCount: number;
}
interface Bill {
  total: number;
  paidAmount: number;
  orders: Array<{
    _id: string;
    code: string;
    total: number;
    status: string;
    paymentStatus: string;
    items: Array<{ nameSnapshot: string; quantity: number; lineTotal: number }>;
  }>;
}
export function StaffTables(): JSX.Element {
  useDocumentTitle('Bàn & phiên');
  const [paidSession, setPaidSession] = useState<{ id: string; tableName: string } | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const sessions = useQuery({
    queryKey: ['staff-table-sessions'],
    queryFn: async () => unwrap(await api.get<{ items: SessionItem[] }>('/staff/table-sessions')),
    refetchInterval: 10_000,
  });
  const tables = useQuery({
    queryKey: ['staff-tables'],
    queryFn: async () => unwrap(await api.get<{ tables: Table[] }>('/staff/tables')),
  });
  if (sessions.isLoading || tables.isLoading) return <p>Đang tải bàn...</p>;
  if (sessions.isError || tables.isError)
    return (
      <ErrorState
        message={getErrorMessage(sessions.error ?? tables.error)}
        onRetry={() => {
          void sessions.refetch();
          void tables.refetch();
        }}
      />
    );
  const active = sessions.data?.items ?? [];
  const activeIds = new Set(active.map((s) => s.table._id));
  const empty = (tables.data?.tables ?? []).filter((t) => t.isActive && !activeIds.has(t._id));
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Bàn & phiên phục vụ</h1>
        <p className="text-sm text-muted-foreground">
          Khách quét QR tĩnh tại bàn. Xác nhận tiền từng đơn trước khi pha chế; đóng phiên khi khách
          rời bàn.
        </p>
        {paidSession ? (
          <Button className="mt-3" variant="outline" onClick={() => setPrintOpen(true)}>
            In hóa đơn vừa thanh toán · {paidSession.tableName}
          </Button>
        ) : null}
      </div>
      <AwaitingPayments />
      <section>
        <h2 className="font-semibold mb-3">Bàn đang phục vụ ({active.length})</h2>
        {active.length === 0 ? (
          <EmptyState
            title="Chưa có bàn đang phục vụ"
            description="Phiên sẽ tự xuất hiện khi khách quét QR tại bàn."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {active.map((item) => (
              <SessionCard
                key={item.session._id}
                item={item}
                emptyTables={empty}
                onPaid={() => {
                  setPaidSession({ id: item.session._id, tableName: item.table.name });
                  setPrintOpen(true);
                }}
              />
            ))}
          </div>
        )}
      </section>
      {paidSession ? (
        <PaidBillModal
          sessionId={paidSession.id}
          tableName={paidSession.tableName}
          open={printOpen}
          onOpenChange={setPrintOpen}
        />
      ) : null}
      <section>
        <h2 className="font-semibold mb-3">Bàn trống ({empty.length})</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {empty.map((t) => (
            <Card className="space-y-4 p-5" key={t._id}>
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-muted text-primary">
                  <Table2 className="h-5 w-5" />
                </span>
                <div>
                  <p className="font-display text-xl font-semibold">{t.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t.code} · {t.capacity} chỗ
                  </p>
                </div>
              </div>
              <p className="border-t border-foreground/10 pt-4 text-sm text-muted-foreground">
                Chờ khách quét QR
              </p>
              <div className="[&>button]:w-full">
                <TableDisplaySetup tableId={t._id} tableName={t.name} />
              </div>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
function SessionCard({
  item,
  emptyTables,
  onPaid,
}: {
  item: SessionItem;
  emptyTables: Table[];
  onPaid: () => void;
}): JSX.Element {
  const { session, table } = item;
  const qc = useQueryClient();
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const claim = usePaymentClaim(session._id, confirmOpen);
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [uncertain, setUncertain] = useState(false);
  const [targetTableId, setTargetTableId] = useState('');
  const attempt = useRef<{
    signature: string;
    key: string;
    payload: { amount: number; method: PaymentMethod; expectedVersion: number };
  } | null>(null);
  const bill = useQuery({
    queryKey: ['staff-bill', session._id],
    queryFn: async () => unwrap(await api.get<Bill>(`/staff/table-sessions/${session._id}/bill`)),
    refetchInterval: 10_000,
  });
  const refresh = () => {
    for (const key of [
      'staff-table-sessions',
      'staff-bill',
      'staff-orders',
      'staff-service-requests',
    ])
      void qc.invalidateQueries({ queryKey: [key] });
  };
  const transition = useMutation({
    mutationFn: (status: 'OPEN' | 'CHECKOUT' | 'CLOSED') =>
      api.patch(`/staff/table-sessions/${session._id}/status`, {
        status,
        expectedVersion: session.version,
      }),
    onSuccess: (_data, status) => {
      if (status === 'CLOSED') onPaid();
      refresh();
    },
    onError: (e) => {
      refresh();
      toast({ title: 'Chưa đổi được trạng thái', description: getErrorMessage(e), tone: 'danger' });
    },
  });
  const payment = useMutation({
    mutationFn: async () => {
      if (!bill.data) throw new Error('Chưa tải được hóa đơn.');
      const payload = paymentRequestSchema.parse({
        amount: bill.data.total,
        method,
        expectedVersion: claim.version,
      });
      const signature = JSON.stringify({ amount: payload.amount, method: payload.method });
      if (attempt.current?.signature !== signature)
        attempt.current = { signature, key: generateIdempotencyKey(), payload };
      return api.post(`/staff/table-sessions/${session._id}/payments`, attempt.current.payload, {
        headers: { 'Idempotency-Key': attempt.current.key, 'X-Payment-Claim': claim.token },
      });
    },
    onSuccess: () => {
      setConfirmOpen(false);
      setUncertain(false);
      attempt.current = null;
      onPaid();
      refresh();
      toast({ title: 'Đã thu tiền và đóng phiên', tone: 'success' });
    },
    onError: (e) => {
      const code = getErrorCode(e);
      if (code && !['INTERNAL', 'INTERNAL_ERROR'].includes(code)) {
        attempt.current = null;
        setUncertain(false);
      } else setUncertain(true);
      refresh();
      toast({
        title: 'Chưa xác nhận được thanh toán',
        description: getErrorMessage(e),
        tone: 'danger',
      });
    },
  });
  const transfer = useMutation({
    mutationFn: () =>
      api.post(`/staff/table-sessions/${session._id}/transfer`, {
        targetTableId,
        expectedVersion: session.version,
      }),
    onSuccess: () => {
      setTargetTableId('');
      refresh();
      toast({ title: 'Đã chuyển bàn', tone: 'success' });
    },
    onError: (error) => {
      refresh();
      toast({ title: 'Không thể chuyển bàn', description: getErrorMessage(error), tone: 'danger' });
    },
  });
  const pending =
    bill.data?.orders.some((o) => !['SERVED', 'CANCELLED'].includes(o.status)) ?? true;
  const unpaid =
    bill.data?.orders.filter((o) => o.status === 'SERVED' && o.paymentStatus === 'UNPAID') ?? [];
  const canCloseEmpty =
    bill.data &&
    bill.data.orders.every(
      (o) => o.status === 'CANCELLED' || (o.status === 'SERVED' && o.paymentStatus === 'PAID'),
    );
  return (
    <Card className="space-y-4 p-5">
      <div className="flex justify-between gap-2">
        <h3 className="font-semibold text-lg">{table.name}</h3>
        <div className="flex items-center gap-2 shrink-0">
          {session.source === 'GUEST' ? <Badge tone="neutral">Tự mở</Badge> : null}
          <Badge tone={session.status === 'CHECKOUT' ? 'warning' : 'info'}>
            {session.status === 'CHECKOUT' ? 'Đang thanh toán' : 'Đang phục vụ'}
          </Badge>
        </div>
      </div>
      <p className="text-sm">{item.orderCount} đơn trong phiên</p>
      {bill.isError ? (
        <ErrorState message={getErrorMessage(bill.error)} onRetry={() => bill.refetch()} />
      ) : bill.isLoading ? (
        <p>Đang tính tiền...</p>
      ) : (
        <>
          <p className="font-semibold">Còn phải thu: {vnd(bill.data!.total)}</p>
          <p className="text-sm">Đã thu: {vnd(bill.data!.paidAmount)}</p>
          {pending ? (
            <p className="text-sm text-amber-700">
              Còn đơn chưa phục vụ. Chỉ đóng phiên sau khi đã phục vụ hoặc hủy các đơn còn lại.
            </p>
          ) : null}
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <TableDisplaySetup tableId={table._id} tableName={table.name} />
        <Button
          size="sm"
          variant="outline"
          disabled={transition.isPending || payment.isPending}
          onClick={() => transition.mutate(session.status === 'OPEN' ? 'CHECKOUT' : 'OPEN')}
        >
          {session.status === 'OPEN' ? 'Tạm dừng gọi món' : 'Mở lại gọi món'}
        </Button>
        {unpaid.length > 0 ? (
          <Button
            size="sm"
            disabled={
              session.status !== 'CHECKOUT' ||
              pending ||
              unpaid.length === 0 ||
              bill.isError ||
              payment.isPending
            }
            onClick={async () => {
              try {
                await claim.acquire();
                setConfirmOpen(true);
              } catch (error) {
                refresh();
                toast({
                  title: 'Chưa nhận được quyền thu tiền',
                  description: getErrorMessage(error),
                  tone: 'danger',
                });
              }
            }}
          >
            Kiểm tra & thu tiền
          </Button>
        ) : null}
        {canCloseEmpty ? (
          <Button
            size="sm"
            variant="outline"
            disabled={transition.isPending}
            onClick={() => transition.mutate('CLOSED')}
          >
            Đóng phiên không còn nợ
          </Button>
        ) : null}
      </div>
      {session.status === 'OPEN' && emptyTables.length > 0 ? (
        <div className="flex gap-2">
          <select
            className="min-w-0 flex-1 rounded border p-2 text-sm"
            value={targetTableId}
            onChange={(event) => setTargetTableId(event.target.value)}
          >
            <option value="">Chọn bàn trống…</option>
            {emptyTables.map((value) => (
              <option key={value._id} value={value._id}>
                {value.code} · {value.name}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={!targetTableId || transfer.isPending}
            onClick={() => transfer.mutate()}
          >
            Chuyển bàn
          </Button>
        </div>
      ) : null}
      <Modal
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!payment.isPending && !uncertain) setConfirmOpen(open);
        }}
        title={`Thanh toán · ${table.name}`}
      >
        <div className="space-y-4">
          {unpaid.map((o) => (
            <div key={o._id} className="border-b pb-2">
              <p className="font-semibold">{o.code}</p>
              {o.items.map((it, i) => (
                <p key={i} className="flex justify-between gap-3 text-sm">
                  <span>
                    {it.quantity} × {it.nameSnapshot}
                  </span>
                  <span>{vnd(it.lineTotal)}</span>
                </p>
              ))}
            </div>
          ))}
          <p className="text-lg font-semibold">Tổng phải thu: {vnd(bill.data?.total ?? 0)}</p>
          <label className="block text-sm">
            Phương thức thanh toán
            <select
              value={method}
              disabled={payment.isPending || uncertain}
              onChange={(e) => {
                const parsed = paymentMethodSchema.safeParse(e.target.value);
                if (parsed.success) setMethod(parsed.data);
              }}
              className="mt-1 w-full border rounded p-2"
            >
              <option value="CASH">Tiền mặt</option>
              <option value="BANK_TRANSFER">Chuyển khoản — nhân viên kiểm tra</option>
              <option value="OTHER">Khác</option>
            </select>
          </label>
          <p className="text-sm text-muted-foreground">
            Chỉ xác nhận sau khi đã nhận đủ tiền. Phiên sẽ đóng và mở hóa đơn để nhân viên in. Khách
            có thể xem hóa đơn và gửi đánh giá trên thiết bị của mình.
          </p>
          <Button
            className="w-full"
            disabled={
              payment.isPending || (!uncertain && (pending || bill.isError || !claim.valid))
            }
            onClick={() => payment.mutate()}
          >
            {payment.isPending
              ? 'Đang xác nhận...'
              : uncertain
                ? 'Thử lại cùng khoản thu'
                : 'Đã nhận đủ tiền — đóng phiên'}
          </Button>
          {uncertain ? (
            <p role="alert">
              Chưa rõ kết quả do mất kết nối. Thử lại cùng khoản thu; không nhận thêm tiền.
            </p>
          ) : !claim.valid ? (
            <p role="alert">Quyền thu tiền đã hết hạn. Đóng và mở lại để kiểm tra.</p>
          ) : null}
        </div>
      </Modal>
    </Card>
  );
}
