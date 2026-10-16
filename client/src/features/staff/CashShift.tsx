import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, getErrorMessage, unwrap, vnd } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Skeleton } from '../../components/ui/Skeleton';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';
import { useToast } from '../../components/ui/useToast';
import { ErrorState } from '../../components/ui/EmptyState';

interface Shift {
  id: string;
  code: string;
  version: number;
  openedByName: string;
  openedAt: string;
  openingCash: number;
  paymentsByMethod: Record<string, { total: number; count: number }>;
  refundsByMethod?: Record<string, { total: number; count: number }>;
  reversalsByMethod?: Record<string, { total: number; count: number }>;
  openSessions: number;
  unpaidSessions: Array<{
    id: string;
    tableCode: string;
    tableName: string;
    status: string;
    startedAt: string;
    unpaidTotal: number;
  }>;
}
export function StaffCashShift(): JSX.Element {
  useDocumentTitle('Đối soát ca');
  const [amount, setAmount] = useState('0');
  const [note, setNote] = useState('');
  const qc = useQueryClient();
  const { toast } = useToast();
  const query = useQuery({
    queryKey: ['cash-shift'],
    queryFn: async () =>
      unwrap<{ shift: Shift | null }>(await api.get('/staff/cash-shifts/current')),
    refetchInterval: 15_000,
  });
  const action = useMutation({
    mutationFn: async () =>
      query.data?.shift
        ? api.post(`/staff/cash-shifts/${query.data.shift.id}/close`, {
            expectedVersion: query.data.shift.version,
            countedCash: Number(amount),
            note,
          })
        : api.post('/staff/cash-shifts', { openingCash: Number(amount) }),
    onSuccess: () => {
      setAmount('0');
      setNote('');
      void qc.invalidateQueries({ queryKey: ['cash-shift'] });
      toast({
        title: query.data?.shift ? 'Đã chốt và lưu biên bản ca' : 'Đã mở ca',
        tone: 'success',
      });
    },
    onError: (error) => {
      void qc.invalidateQueries({ queryKey: ['cash-shift'] });
      toast({
        title: 'Không thể cập nhật ca',
        description: getErrorMessage(error),
        tone: 'danger',
      });
    },
  });
  if (query.isLoading) return <Skeleton className="h-72" />;
  if (query.isError)
    return <ErrorState message={getErrorMessage(query.error)} onRetry={() => query.refetch()} />;
  const shift = query.data?.shift;
  const cashReceived = shift?.paymentsByMethod.CASH?.total ?? 0;
  const cashRefunded = shift?.refundsByMethod?.CASH?.total ?? 0;
  const cashReversed = shift?.reversalsByMethod?.CASH?.total ?? 0;
  const expected = (shift?.openingCash ?? 0) + cashReceived - cashRefunded - cashReversed;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="font-display text-2xl font-semibold">Đối soát ca thu ngân</h1>
        <p className="text-sm text-muted-foreground">
          Tiền dự kiến = đầu ca + khoản vào − hoàn tiền − đảo ghi nhận. Khoản thay thế được tính vào
          ca điều chỉnh; chênh lệch phải có lý do.
        </p>
      </div>
      <Card className="space-y-4 p-4">
        {shift ? (
          <>
            <div>
              <p className="font-semibold">{shift.code}</p>
              <p className="text-sm text-muted-foreground">
                Mở bởi {shift.openedByName} lúc {new Date(shift.openedAt).toLocaleString('vi-VN')}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Stat label="Tiền đầu ca" value={vnd(shift.openingCash)} />
              <Stat label="Tiền mặt ghi nhận vào" value={vnd(cashReceived)} />
              <Stat label="Tiền mặt đã hoàn" value={vnd(cashRefunded)} />
              <Stat label="Tiền mặt đảo ghi nhận" value={vnd(cashReversed)} />
              <Stat label="Tiền mặt dự kiến" value={vnd(expected)} />
              <Stat
                label="Chuyển khoản"
                value={vnd(shift.paymentsByMethod.BANK_TRANSFER?.total ?? 0)}
              />
            </div>
            {shift.openSessions > 0 ? (
              <div className="rounded-xl bg-warning/10 p-3 text-sm text-warning">
                <p>
                  Còn {shift.openSessions} phiên bàn chưa đóng. Hãy bàn giao rõ trước khi chốt ca.
                </p>
                <ul className="mt-2 space-y-1">
                  {shift.unpaidSessions.map((session) => (
                    <li key={session.id}>
                      {session.tableName || session.tableCode} · {session.status} · chưa thu{' '}
                      {vnd(session.unpaidTotal)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <Input
              type="number"
              min="0"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="Tiền mặt kiểm đếm"
            />
            <Input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Lý do chênh lệch / ghi chú bàn giao"
            />
            <p className="text-sm">
              Chênh lệch dự kiến: <strong>{vnd(Number(amount || 0) - expected)}</strong>
            </p>
            <Button
              className="w-full"
              disabled={
                action.isPending ||
                Number(amount) < 0 ||
                (Number(amount) !== expected && note.trim().length < 3)
              }
              onClick={() => action.mutate()}
            >
              Chốt ca và lưu đối soát
            </Button>
          </>
        ) : (
          <>
            <p>Chưa có ca đang mở.</p>
            <Input
              type="number"
              min="0"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="Tiền mặt đầu ca"
            />
            <Button
              className="w-full"
              disabled={action.isPending || Number(amount) < 0}
              onClick={() => action.mutate()}
            >
              Mở ca thu ngân
            </Button>
          </>
        )}
      </Card>
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-xl bg-muted p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  );
}
