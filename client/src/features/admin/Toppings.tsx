import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Skeleton } from '../../components/ui/Skeleton';
import { api, getErrorMessage, unwrap, vnd } from '../../lib/api';
import { useToast } from '../../components/ui/useToast';
import { ErrorState } from '../../components/ui/EmptyState';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';

interface Topping {
  _id: string;
  name: string;
  price: number;
  isAvailable: boolean;
  isArchived: boolean;
}

export function AdminToppings(): JSX.Element {
  useDocumentTitle('Topping');
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('8000');
  const [deleting, setDeleting] = useState<Topping | null>(null);

  const listQuery = useQuery({
    queryKey: ['admin-toppings'],
    queryFn: async () => unwrap(await api.get<{ toppings: Topping[] }>('/admin/toppings')),
  });

  const create = useMutation({
    mutationFn: async () =>
      unwrap(await api.post('/admin/toppings', { name, price: Number(price) })),
    onSuccess: () => {
      toast({ title: 'Đã tạo topping', tone: 'success' });
      setName('');
      setPrice('8000');
      queryClient.invalidateQueries({ queryKey: ['admin-toppings'] });
    },
    onError: (err) => toast({ title: 'Lỗi', description: getErrorMessage(err), tone: 'danger' }),
  });

  const toggle = useMutation({
    mutationFn: async (input: { id: string; isAvailable: boolean }) =>
      unwrap(await api.patch(`/admin/toppings/${input.id}`, { isAvailable: input.isAvailable })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-toppings'] }),
    onError: (err) =>
      toast({ title: 'Chưa cập nhật được', description: getErrorMessage(err), tone: 'danger' }),
  });

  const archive = useMutation({
    mutationFn: async (topping: Topping) =>
      topping.isArchived
        ? api.patch(`/admin/toppings/${topping._id}`, { isArchived: false })
        : api.delete(`/admin/toppings/${topping._id}`),
    onSuccess: (_data, topping) => {
      setDeleting(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-toppings'] });
      toast({
        title: topping.isArchived ? 'Đã khôi phục topping' : 'Đã xóa topping',
        tone: 'success',
      });
    },
    onError: (err) =>
      toast({ title: 'Chưa cập nhật được', description: getErrorMessage(err), tone: 'danger' }),
  });

  if (listQuery.isLoading) return <Skeleton className="h-64" />;
  if (listQuery.isError)
    return (
      <ErrorState message={getErrorMessage(listQuery.error)} onRetry={() => listQuery.refetch()} />
    );

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-semibold">Topping</h1>
      <Card className="p-4">
        <form
          className="grid grid-cols-1 sm:grid-cols-[1fr,120px,auto] gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Input
            placeholder="Tên topping"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <Input
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
            min={0}
          />
          <Button type="submit" disabled={create.isPending}>
            Tạo
          </Button>
        </form>
      </Card>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {listQuery.data?.toppings
          .filter((t) => !t.isArchived)
          .map((t) => (
            <Card key={t._id} className="p-3 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 break-words">
                <p className="font-display font-semibold">{t.name}</p>
                <p className="text-xs text-muted-foreground">{vnd(t.price)}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={t.isAvailable ? 'success' : 'warning'}>
                  {t.isAvailable ? 'Đang bán' : 'Tạm hết'}
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={toggle.isPending || archive.isPending}
                  onClick={() => toggle.mutate({ id: t._id, isAvailable: !t.isAvailable })}
                >
                  {t.isAvailable ? 'Báo hết' : 'Bán lại'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={archive.isPending}
                  onClick={() => setDeleting(t)}
                >
                  Xóa
                </Button>
              </div>
            </Card>
          ))}
      </div>
      {!listQuery.data?.toppings.some((t) => !t.isArchived) ? (
        <p className="text-sm text-muted-foreground">Chưa có topping.</p>
      ) : null}
      {listQuery.data?.toppings.some((t) => t.isArchived) ? (
        <details className="space-y-3">
          <summary className="cursor-pointer font-semibold">
            Topping đã xóa ({listQuery.data.toppings.filter((t) => t.isArchived).length})
          </summary>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {listQuery.data.toppings
              .filter((t) => t.isArchived)
              .map((t) => (
                <Card key={t._id} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0 break-words">
                    <p className="font-semibold">{t.name}</p>
                    <p className="text-xs text-muted-foreground">{vnd(t.price)}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={archive.isPending}
                    onClick={() => archive.mutate(t)}
                  >
                    Khôi phục
                  </Button>
                </Card>
              ))}
          </div>
        </details>
      ) : null}
      <Modal
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !archive.isPending) setDeleting(null);
        }}
        title="Xóa topping?"
      >
        <p className="mb-4">
          Xóa <strong>{deleting?.name}</strong> khỏi thực đơn? Đơn cũ được giữ nguyên.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={archive.isPending} onClick={() => setDeleting(null)}>
            Hủy
          </Button>
          <Button
            variant="danger"
            disabled={archive.isPending}
            onClick={() => deleting && archive.mutate(deleting)}
          >
            {archive.isPending ? 'Đang xóa…' : 'Xóa topping'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
