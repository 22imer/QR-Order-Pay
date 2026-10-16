import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { type AuthUser, useAuth } from './useAuth';
import { api, unwrap, getErrorMessage } from '../../lib/api';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Skeleton } from '../../components/ui/Skeleton';
import { ErrorState } from '../../components/ui/EmptyState';
import { useToast } from '../../components/ui/useToast';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';

export function AccountPage(): JSX.Element {
  useDocumentTitle('Tài khoản của tôi');
  const navigate = useNavigate();
  const { toast } = useToast();
  const [name, setName] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const query = useQuery({
    queryKey: ['my-account'],
    queryFn: async () => unwrap(await api.get<AuthUser>('/auth/me')),
  });
  const fail = (error: unknown) =>
    toast({ title: 'Chưa cập nhật được', description: getErrorMessage(error), tone: 'danger' });
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.patch<{ user: AuthUser }>('/auth/me', {
          name: (name ?? query.data?.name ?? '').trim(),
        }),
      ),
    onSuccess: ({ user }) => {
      useAuth.setState({ user });
      void query.refetch();
      setName(null);
      toast({ title: 'Đã lưu thông tin', tone: 'success' });
    },
    onError: fail,
  });
  const change = useMutation({
    mutationFn: async () => {
      if (newPassword !== confirmPassword) throw new Error('Mật khẩu xác nhận chưa khớp.');
      return api.post('/auth/password', { currentPassword, newPassword });
    },
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      useAuth.getState().clearSession();
      toast({ title: 'Đã đổi mật khẩu. Vui lòng đăng nhập lại.', tone: 'success' });
      navigate('/auth/login', { replace: true });
    },
    onError: fail,
  });
  if (query.isLoading) return <Skeleton className="h-64" />;
  if (query.isError)
    return <ErrorState message={getErrorMessage(query.error)} onRetry={() => query.refetch()} />;
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="font-display text-2xl font-semibold">Tài khoản của tôi</h1>
      <Card className="p-4">
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <h2 className="font-semibold">Thông tin cá nhân</h2>
          <label className="block text-sm">
            Họ tên
            <Input
              className="mt-1"
              required
              maxLength={80}
              autoComplete="name"
              value={name ?? query.data?.name ?? ''}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <div className="break-all text-sm">
            <span className="text-muted-foreground">Email: </span>
            {query.data?.email}
          </div>
          <p className="text-sm text-muted-foreground">
            {query.data?.role === 'ADMIN' ? 'Quản trị viên' : 'Nhân viên'}
          </p>
          <Button
            type="submit"
            disabled={save.isPending || !(name ?? query.data?.name ?? '').trim()}
          >
            {save.isPending ? 'Đang lưu…' : 'Lưu thông tin'}
          </Button>
        </form>
      </Card>
      <Card className="p-4">
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            change.mutate();
          }}
        >
          <h2 className="font-semibold">Đổi mật khẩu</h2>
          <label className="block text-sm">
            Mật khẩu hiện tại
            <Input
              className="mt-1"
              type="password"
              autoComplete="current-password"
              required
              maxLength={72}
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            Mật khẩu mới
            <Input
              className="mt-1"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={72}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            Nhập lại mật khẩu mới
            <Input
              className="mt-1"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={72}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            8–72 ký tự. Bạn cần đăng nhập lại sau khi đổi.
          </p>
          <Button
            type="submit"
            disabled={
              change.isPending ||
              !currentPassword ||
              newPassword.length < 8 ||
              newPassword !== confirmPassword
            }
          >
            {change.isPending ? 'Đang đổi…' : 'Đổi mật khẩu'}
          </Button>
        </form>
      </Card>
      <Button
        variant="outline"
        onClick={async () => {
          await useAuth.getState().logout();
          navigate('/auth/login', { replace: true });
        }}
      >
        Đăng xuất
      </Button>
    </div>
  );
}
