import { useState } from 'react';
import { useAuth } from '../auth/useAuth';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Power, KeyRound, Pencil, Trash2 } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { Skeleton } from '../../components/ui/Skeleton';
import { api, getErrorMessage, unwrap } from '../../lib/api';
import { useToast } from '../../components/ui/useToast';
import { ErrorState } from '../../components/ui/EmptyState';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';

interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'STAFF';
  isActive: boolean;
  createdAt: string;
}

export function AdminUsers(): JSX.Element {
  useDocumentTitle('Nhân viên');
  const qc = useQueryClient();
  const { toast } = useToast();
  const currentUser = useAuth((state) => state.user);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [locking, setLocking] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState<AdminUser | null>(null);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [pwdFor, setPwdFor] = useState<AdminUser | null>(null);
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'STAFF' as 'STAFF' | 'ADMIN',
  });

  const query = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => unwrap(await api.get<{ users: AdminUser[] }>('/admin/users')),
  });

  const create = useMutation({
    mutationFn: async () => unwrap(await api.post('/admin/users', form)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      toast({ title: 'Đã tạo tài khoản', tone: 'success' });
      setCreating(false);
      setForm({ name: '', email: '', password: '', role: 'STAFF' });
    },
    onError: (err) => toast({ title: 'Lỗi', description: getErrorMessage(err), tone: 'danger' }),
  });

  const toggle = useMutation({
    mutationFn: async (input: { id: string; isActive: boolean }) =>
      unwrap(await api.patch(`/admin/users/${input.id}`, { isActive: input.isActive })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      toast({ title: 'Đã cập nhật', tone: 'success' });
      setLocking(null);
    },
    onError: (err) => toast({ title: 'Lỗi', description: getErrorMessage(err), tone: 'danger' }),
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!deleting) throw new Error('Chưa chọn nhân viên.');
      return api.delete(`/admin/users/${deleting.id}`);
    },
    onSuccess: () => {
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ['admin-users'] });
      toast({ title: 'Đã xóa nhân viên', tone: 'success' });
    },
    onError: (error) =>
      toast({ title: 'Chưa xóa được', description: getErrorMessage(error), tone: 'danger' }),
  });

  const resetPwd = useMutation({
    mutationFn: async (input: { id: string; password: string }) =>
      unwrap(await api.patch(`/admin/users/${input.id}`, { password: input.password })),
    onSuccess: () => {
      toast({ title: 'Đã đặt lại mật khẩu', tone: 'success' });
      setPwdFor(null);
    },
    onError: (err) => toast({ title: 'Lỗi', description: getErrorMessage(err), tone: 'danger' }),
  });

  const edit = useMutation({
    mutationFn: async () => {
      if (!editing) throw new Error('Chưa chọn tài khoản.');
      return unwrap(
        await api.patch<{ user: AdminUser }>(`/admin/users/${editing.id}`, {
          name: editing.name,
          email: editing.email,
          role: editing.role,
        }),
      );
    },
    onSuccess: ({ user }) => {
      if (user.id === currentUser?.id) useAuth.setState({ user });
      void qc.invalidateQueries({ queryKey: ['admin-users'] });
      void qc.invalidateQueries({ queryKey: ['my-account'] });
      setEditing(null);
      toast({ title: 'Đã lưu tài khoản', tone: 'success' });
    },
    onError: (err) =>
      toast({ title: 'Chưa lưu được', description: getErrorMessage(err), tone: 'danger' }),
  });

  if (query.isLoading) return <Skeleton className="h-64" />;
  if (query.isError)
    return <ErrorState message={getErrorMessage(query.error)} onRetry={() => query.refetch()} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold">Nhân viên</h1>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> Thêm nhân viên
        </Button>
      </div>

      <Input
        aria-label="Tìm nhân viên"
        placeholder="Tìm theo tên hoặc email"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {query.data?.users
          .filter((u) =>
            `${u.name} ${u.email}`
              .toLocaleLowerCase('vi-VN')
              .includes(search.toLocaleLowerCase('vi-VN')),
          )
          .map((u) => (
            <Card key={u.id} className="p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 break-words">
                  <p className="font-display font-semibold">
                    {u.name}
                    {u.id === currentUser?.id ? ' (Bạn)' : ''}
                  </p>
                  <p className="break-all text-xs text-muted-foreground">{u.email}</p>
                </div>
                <Badge tone={u.role === 'ADMIN' ? 'info' : 'neutral'}>
                  {u.role === 'ADMIN' ? 'Quản trị' : 'Nhân viên'}
                </Badge>
              </div>
              <p className="text-xs">
                <span className={u.isActive ? 'text-success' : 'text-danger'}>
                  {u.isActive ? 'Đang hoạt động' : 'Đã khoá'}
                </span>
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={edit.isPending}
                  onClick={() => setEditing({ ...u })}
                >
                  <Pencil className="h-3 w-3" />
                  Sửa
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={toggle.isPending || u.id === currentUser?.id}
                  onClick={() =>
                    u.isActive ? setLocking(u) : toggle.mutate({ id: u.id, isActive: true })
                  }
                >
                  <Power className="h-3 w-3" /> {u.isActive ? 'Khoá' : 'Mở khoá'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={u.id === currentUser?.id || resetPwd.isPending}
                  onClick={() => setPwdFor(u)}
                >
                  <KeyRound className="h-3 w-3" /> Đặt lại mật khẩu
                </Button>
                {u.role === 'STAFF' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={remove.isPending}
                    onClick={() => setDeleting(u)}
                  >
                    <Trash2 className="h-3 w-3" />
                    Xóa
                  </Button>
                ) : null}
              </div>
            </Card>
          ))}
      </div>

      <Modal
        open={!!editing}
        onOpenChange={(open) => {
          if (!open && !edit.isPending) setEditing(null);
        }}
        title="Sửa nhân viên"
      >
        {editing ? (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              edit.mutate();
            }}
          >
            <label className="block text-sm">
              Họ tên
              <Input
                className="mt-1"
                required
                maxLength={80}
                value={editing.name}
                onChange={(event) => setEditing({ ...editing, name: event.target.value })}
              />
            </label>
            <label className="block text-sm">
              Email
              <Input
                className="mt-1"
                required
                type="email"
                maxLength={254}
                value={editing.email}
                onChange={(event) => setEditing({ ...editing, email: event.target.value })}
              />
            </label>
            <label className="block text-sm">
              Vai trò
              <select
                className="mt-1 w-full rounded-md border border-foreground/15 bg-background px-3 py-2"
                disabled={editing.id === currentUser?.id}
                value={editing.role}
                onChange={(event) =>
                  setEditing({ ...editing, role: event.target.value as AdminUser['role'] })
                }
              >
                <option value="STAFF">Nhân viên</option>
                <option value="ADMIN">Quản trị viên</option>
              </select>
            </label>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={edit.isPending}
                onClick={() => setEditing(null)}
              >
                Hủy
              </Button>
              <Button type="submit" disabled={edit.isPending}>
                {edit.isPending ? 'Đang lưu…' : 'Lưu'}
              </Button>
            </div>
          </form>
        ) : null}
      </Modal>
      <Modal
        open={!!locking}
        onOpenChange={(open) => {
          if (!open && !toggle.isPending) setLocking(null);
        }}
        title="Khóa tài khoản?"
      >
        <p className="mb-4">
          <strong>{locking?.name}</strong> sẽ bị đăng xuất và không thể đăng nhập.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={toggle.isPending} onClick={() => setLocking(null)}>
            Hủy
          </Button>
          <Button
            variant="danger"
            disabled={toggle.isPending}
            onClick={() => locking && toggle.mutate({ id: locking.id, isActive: false })}
          >
            Khóa tài khoản
          </Button>
        </div>
      </Modal>
      <Modal
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleting(null);
        }}
        title="Xóa nhân viên?"
      >
        <p className="mb-4">
          Xóa <strong>{deleting?.name}</strong>? Nhân viên sẽ bị đăng xuất. Lịch sử làm việc được
          giữ nguyên.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={remove.isPending} onClick={() => setDeleting(null)}>
            Hủy
          </Button>
          <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
            {remove.isPending ? 'Đang xóa…' : 'Xóa nhân viên'}
          </Button>
        </div>
      </Modal>
      <Modal open={creating} onOpenChange={(o) => !o && setCreating(false)} title="Thêm nhân viên">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <label className="block text-sm">
            Họ tên
            <Input
              required
              className="mt-1"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label className="block text-sm">
            Email
            <Input
              required
              type="email"
              className="mt-1"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </label>
          <label className="block text-sm">
            Mật khẩu (≥ 8 ký tự)
            <Input
              required
              minLength={8}
              maxLength={72}
              type="password"
              className="mt-1"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>
          <label className="block text-sm">
            Vai trò
            <select
              className="mt-1 w-full rounded-md border border-foreground/15 bg-background px-3 py-2 text-sm"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as 'STAFF' | 'ADMIN' })}
            >
              <option value="STAFF">Nhân viên</option>
              <option value="ADMIN">Quản trị viên</option>
            </select>
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={() => setCreating(false)}>
              Huỷ
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Đang tạo...' : 'Tạo'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!pwdFor}
        onOpenChange={(o) => !o && setPwdFor(null)}
        title={`Đặt lại mật khẩu: ${pwdFor?.name ?? ''}`}
      >
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!pwdFor) return;
            const data = new FormData(e.currentTarget);
            const password = String(data.get('password') ?? '');
            if (password.length < 8) {
              toast({ title: 'Mật khẩu tối thiểu 8 ký tự', tone: 'danger' });
              return;
            }
            resetPwd.mutate({ id: pwdFor.id, password });
          }}
        >
          <Input
            name="password"
            type="password"
            required
            minLength={8}
            maxLength={72}
            placeholder="Mật khẩu mới (≥ 8 ký tự)"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={() => setPwdFor(null)}>
              Huỷ
            </Button>
            <Button type="submit" disabled={resetPwd.isPending}>
              Lưu
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
