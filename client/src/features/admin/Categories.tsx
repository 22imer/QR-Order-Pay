import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Power, Trash2 } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { api, getErrorMessage, unwrap } from '../../lib/api';
import { useToast } from '../../components/ui/useToast';
import { ErrorState } from '../../components/ui/EmptyState';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';

interface Category {
  _id: string;
  name: string;
  slug: string;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function AdminCategories(): JSX.Element {
  useDocumentTitle('Danh mục');
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<Category | null>(null);
  const [editName, setEditName] = useState('');
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [reassignTo, setReassignTo] = useState('');

  const listQuery = useQuery({
    queryKey: ['admin-categories'],
    queryFn: async () => unwrap(await api.get<{ categories: Category[] }>('/admin/categories')),
  });

  const create = useMutation({
    mutationFn: async () =>
      unwrap(await api.post('/admin/categories', { name, slug: slugify(name) })),
    onSuccess: () => {
      toast({ title: 'Đã tạo danh mục', tone: 'success' });
      setName('');
      qc.invalidateQueries({ queryKey: ['admin-categories'] });
    },
    onError: (err) => toast({ title: 'Lỗi', description: getErrorMessage(err), tone: 'danger' }),
  });

  const update = useMutation({
    mutationFn: async (input: { id: string; data: Partial<Category> }) =>
      unwrap(await api.patch(`/admin/categories/${input.id}`, input.data)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-categories'] });
      toast({ title: 'Đã cập nhật', tone: 'success' });
      setEditing(null);
    },
    onError: (err) => toast({ title: 'Lỗi', description: getErrorMessage(err), tone: 'danger' }),
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!deleting) return;
      return unwrap(
        await api.delete(`/admin/categories/${deleting._id}`, {
          data: reassignTo ? { reassignTo } : {},
        }),
      );
    },
    onSuccess: () => {
      setDeleting(null);
      setReassignTo('');
      for (const key of ['admin-categories', 'admin-products', 'menu', 'menu-search'])
        void qc.invalidateQueries({ queryKey: [key] });
      toast({ title: 'Đã xóa danh mục', tone: 'success' });
    },
    onError: (error) => {
      void qc.invalidateQueries({ queryKey: ['admin-categories'] });
      toast({
        title: 'Chưa xóa được danh mục',
        description: getErrorMessage(error),
        tone: 'danger',
      });
    },
  });

  if (listQuery.isError)
    return (
      <ErrorState message={getErrorMessage(listQuery.error)} onRetry={() => listQuery.refetch()} />
    );

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-semibold">Danh mục</h1>
      <Card className="p-4">
        <h3 className="font-semibold mb-3">Thêm danh mục</h3>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Input
            placeholder="Tên danh mục (vd: Trà sữa)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <Button type="submit" disabled={create.isPending}>
            <Plus className="h-4 w-4" /> Tạo
          </Button>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">
          Slug tự sinh từ tên (vd: "Trà sữa" → "tra-sua").
        </p>
      </Card>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {listQuery.data?.categories.map((c) => (
          <Card key={c._id} data-category-id={c._id} className="p-3 space-y-2">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-display font-semibold">{c.name}</p>
                <p className="text-xs text-muted-foreground">{c.slug}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {c.productCount ?? 0} món (gồm món đã xóa mềm)
                </p>
              </div>
              <span className={`text-xs ${c.isActive ? 'text-success' : 'text-muted-foreground'}`}>
                {c.isActive ? 'Đang hiển thị' : 'Đã ẩn'}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditing(c);
                  setEditName(c.name);
                }}
              >
                <Pencil className="h-3 w-3" /> Sửa tên
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => update.mutate({ id: c._id, data: { isActive: !c.isActive } })}
              >
                <Power className="h-3 w-3" /> {c.isActive ? 'Ẩn' : 'Hiện'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-danger"
                onClick={() => {
                  setDeleting(c);
                  setReassignTo('');
                }}
              >
                <Trash2 className="h-3 w-3" /> Xóa
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <Modal
        open={!!deleting}
        onOpenChange={(open) => !open && !remove.isPending && setDeleting(null)}
        title={`Xóa danh mục: ${deleting?.name ?? ''}`}
        description="Món được giữ lại trong danh mục nhận. Lịch sử đơn và doanh thu không thay đổi."
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            remove.mutate();
          }}
        >
          <p className="text-sm text-muted-foreground">
            {(deleting?.productCount ?? 0) > 0
              ? `Danh mục có ${deleting?.productCount} món, bao gồm món đã xóa mềm. Chọn nơi chuyển toàn bộ món trước khi xóa.`
              : 'Danh mục đang trống. Thao tác này sẽ xóa danh mục khỏi hệ thống.'}
          </p>
          <label className="block text-sm font-semibold">
            Chuyển món sang danh mục
            <select
              aria-label="Chuyển món sang danh mục"
              value={reassignTo}
              onChange={(event) => setReassignTo(event.target.value)}
              required={(deleting?.productCount ?? 0) > 0}
              disabled={remove.isPending}
              className="mt-2 h-11 w-full rounded-xl border border-foreground/15 bg-card px-3 font-normal"
            >
              <option value="">Chọn danh mục nhận</option>
              {listQuery.data?.categories
                .filter((category) => category._id !== deleting?._id)
                .map((category) => (
                  <option key={category._id} value={category._id}>
                    {category.name}
                    {!category.isActive ? ' (đã ẩn)' : ''}
                  </option>
                ))}
            </select>
          </label>
          {(deleting?.productCount ?? 0) > 0 && (listQuery.data?.categories.length ?? 0) < 2 ? (
            <p role="status" className="text-sm text-danger">
              Cần tạo danh mục khác để nhận các món trước khi xóa.
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              type="button"
              disabled={remove.isPending}
              onClick={() => setDeleting(null)}
            >
              Giữ danh mục
            </Button>
            <Button
              variant="danger"
              type="submit"
              disabled={remove.isPending || ((deleting?.productCount ?? 0) > 0 && !reassignTo)}
            >
              {remove.isPending ? 'Đang xóa…' : reassignTo ? 'Chuyển món và xóa' : 'Xóa danh mục'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        title={`Sửa danh mục: ${editing?.slug ?? ''}`}
      >
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!editing) return;
            update.mutate({ id: editing._id, data: { name: editName } });
          }}
        >
          <Input value={editName} onChange={(e) => setEditName(e.target.value)} required />
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={() => setEditing(null)}>
              Huỷ
            </Button>
            <Button type="submit" disabled={update.isPending}>
              Lưu
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
