import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getErrorMessage, unwrap } from '../../lib/api';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { EmptyState, ErrorState } from '../../components/ui/EmptyState';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';
import { useToast } from '../../components/ui/useToast';
import { getSocket } from '../../lib/socket';
import { Check } from 'lucide-react';

interface ServiceRequest {
  _id: string;
  tableSessionId: string;
  tableName: string;
  participantId: string;
  type: 'CALL_STAFF' | 'REQUEST_BILL' | 'OTHER';
  status: 'OPEN' | 'RESOLVED';
  note: string;
  createdAt: string;
}

export function StaffServiceRequests(): JSX.Element {
  const navigate = useNavigate();
  useDocumentTitle('Yêu cầu từ bàn');
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const listQuery = useQuery({
    queryKey: ['staff-service-requests'],
    queryFn: async () => unwrap(await api.get<{ items: ServiceRequest[] }>('/staff/service-requests')),
    refetchInterval: 8_000,
  });

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const handler = () => {
      queryClient.invalidateQueries({ queryKey: ['staff-service-requests'] });
      toast({ title: 'Có yêu cầu mới từ bàn', tone: 'info', onClick: () => navigate('/staff/service-requests') });
    };
    socket.on('serviceRequest.created', handler);
    return () => {
      socket.off('serviceRequest.created', handler);
    };
  }, [queryClient, toast, navigate]);

  const resolve = useMutation({
    mutationFn: async (id: string) => unwrap(await api.post(`/staff/service-requests/${id}/resolve`)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff-service-requests'] });
    },
    onError: (err) => toast({ title: 'Không thể xử lý', description: getErrorMessage(err), tone: 'danger' }),
  });

  if (listQuery.isLoading) return <p className="text-sm text-muted-foreground">Đang tải...</p>;
  if (listQuery.isError) return <ErrorState message={getErrorMessage(listQuery.error)} onRetry={() => listQuery.refetch()} />;

  const items = listQuery.data?.items ?? [];
  if (items.length === 0) {
    return <EmptyState title="Chưa có yêu cầu nào" description="Khi khách gọi nhân viên hoặc yêu cầu thanh toán, sẽ hiển thị tại đây." />;
  }

  return (
    <div className="space-y-3">
      <h1 className="font-display text-2xl font-semibold">Yêu cầu đang mở ({items.length})</h1>
      {items.map((r) => (
        <Card key={r._id} className="p-3 flex items-start justify-between gap-3">
          <div>
            <Badge tone={r.type === 'REQUEST_BILL' ? 'warning' : 'info'}>{labelType(r.type)}</Badge>
            <p className="mt-2 font-semibold">{r.tableName}</p>
            <p className="mt-2 text-sm">{r.note || 'Không có ghi chú.'}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {new Date(r.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} · Phiên {r.tableSessionId.slice(-6)}
            </p>
          </div>
          <Button size="sm" onClick={() => resolve.mutate(r._id)} disabled={resolve.isPending}>
            <Check className="h-4 w-4" /> Xử lý
          </Button>
        </Card>
      ))}
    </div>
  );
}

function labelType(t: ServiceRequest['type']): string {
  switch (t) {
    case 'CALL_STAFF': return 'Gọi nhân viên';
    case 'REQUEST_BILL': return 'Yêu cầu thanh toán';
    case 'OTHER': return 'Khác';
  }
}
