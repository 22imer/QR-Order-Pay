import { useQuery } from '@tanstack/react-query';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { api, getErrorMessage, unwrap } from '../../lib/api';
import { ErrorState } from '../../components/ui/EmptyState';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';
import { TableDisplaySetup } from '../staff/TableDisplaySetup';
import { QrCode, Table2 } from 'lucide-react';

interface Table {
  _id: string;
  name: string;
  code: string;
  capacity: number;
  isActive: boolean;
}
export function AdminTables(): JSX.Element {
  useDocumentTitle('Bàn & QR động');
  const query = useQuery({
    queryKey: ['admin-tables-full'],
    queryFn: async () => unwrap<{ tables: Table[] }>(await api.get('/admin/tables')),
  });
  if (query.isLoading) return <p>Đang tải bàn…</p>;
  if (query.isError)
    return <ErrorState message={getErrorMessage(query.error)} onRetry={() => query.refetch()} />;
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
          <QrCode className="h-7 w-7" />
        </span>
        <div>
          <h1 className="font-display text-2xl font-semibold">Bàn & QR động</h1>
          <p className="text-sm text-muted-foreground">
            Cấp liên kết riêng cho màn hình tại bàn. Màn hình tự đổi QR mỗi 60 giây; khách quét mã
            đang hiển thị để vào bàn.
          </p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {query.data?.tables.map((table) => (
          <Card key={table._id} className="space-y-5 p-5">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-muted text-primary">
                <Table2 className="h-5 w-5" />
              </span>
              <div className="flex-1">
                <p className="font-display text-xl font-semibold">{table.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {table.code} · {table.capacity} chỗ
                </p>
              </div>
              <Badge tone={table.isActive ? 'success' : 'danger'}>
                {table.isActive ? 'Hoạt động' : 'Tạm khóa'}
              </Badge>
            </div>
            {table.isActive ? (
              <div className="border-t border-foreground/10 pt-4 [&>button]:w-full">
                <TableDisplaySetup admin tableId={table._id} tableName={table.name} />
              </div>
            ) : null}
          </Card>
        ))}
      </div>
    </div>
  );
}
