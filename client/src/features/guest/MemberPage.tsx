import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PointEntry } from '@may-cafe/contracts';
import { api, unwrap, getErrorMessage } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { ErrorState } from '../../components/ui/EmptyState';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';
import { useMember } from './useMember';

export function MemberPage(): JSX.Element {
  const pickupMode = useLocation().pathname.startsWith('/pickup');
  const navigate = useNavigate();
  useDocumentTitle('Thành viên');
  const qc = useQueryClient();
  const query = useMember();
  const member = query.data?.member;
  const [register, setRegister] = useState(false);
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState('');
  const history = useQuery({
    queryKey: ['member-points', member?.id, page],
    enabled: !!member,
    queryFn: async () =>
      unwrap<{ items: PointEntry[]; total: number }>(
        await api.get('/members/points', { params: { page } }),
      ),
    refetchInterval: 30000,
  });
  const mutation = useMutation({
    mutationFn: async ({ path, body }: { path: string; body?: unknown }) =>
      api.post(`/members/${path}`, body),
    onSuccess: async (_data, input) => {
      if (input.path === 'password') setNotice('Đã đổi mật khẩu. Vui lòng đăng nhập lại.');
      else setNotice('');
      await qc.cancelQueries({ queryKey: ['member-points'] });
      if (input.path === 'logout' || input.path === 'password')
        qc.setQueryData(['member'], { member: null });
      await qc.invalidateQueries({ queryKey: ['member'] });
      qc.removeQueries({ queryKey: ['member-points'] });
      qc.removeQueries({ queryKey: ['pickups'] });
      qc.removeQueries({ queryKey: ['pickup-bill'] });
      setPage(1);
      if (pickupMode && (input.path === 'login' || input.path === 'register')) navigate('/pickup');
    },
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    mutation.mutate({
      path: register ? 'register' : 'login',
      body: {
        phone: data.get('phone'),
        password: data.get('password'),
        ...(register ? { name: data.get('name') } : {}),
      },
    });
  }
  return (
    <div className="mx-auto max-w-xl space-y-5 pt-2">
      <h1 className="g-display text-3xl">Thành viên</h1>
      {query.isError ? (
        <ErrorState message={getErrorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : query.isPending ? (
        <p>Đang tải tài khoản…</p>
      ) : member ? (
        <>
          <section className="space-y-3 rounded-2xl border bg-card p-5">
            <h2 className="text-xl font-semibold">{member.name}</h2>
            <p>{member.phone}</p>
            <p className="g-display text-3xl">{member.points} điểm</p>
            <Link className="inline-block underline" to={pickupMode ? '/pickup' : '/cart'}>
              {pickupMode ? 'Đặt món' : 'Đổi điểm trong giỏ hàng'}
            </Link>
            <Button
              variant="ghost"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate({ path: 'logout' })}
            >
              Đăng xuất thành viên
            </Button>
          </section>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Lịch sử điểm</h2>
            {history.isError ? (
              <ErrorState
                message={getErrorMessage(history.error)}
                onRetry={() => history.refetch()}
              />
            ) : history.isPending ? (
              <p>Đang tải…</p>
            ) : history.data.items.length ? (
              history.data.items.map((entry) => (
                <div className="flex justify-between gap-3 border-b py-3 text-sm" key={entry.id}>
                  <div>
                    <p>
                      {entry.type === 'EARN'
                        ? 'Tích điểm'
                        : entry.type === 'REDEEM'
                          ? 'Đổi điểm'
                          : 'Hoàn điểm'}{' '}
                      · {entry.orderCode}
                    </p>
                    <time>{new Date(entry.createdAt).toLocaleString('vi-VN')}</time>
                  </div>
                  <div className="text-right">
                    <strong>
                      {entry.points > 0 ? '+' : ''}
                      {entry.points}
                    </strong>
                    <p>Còn {entry.balanceAfter}</p>
                  </div>
                </div>
              ))
            ) : (
              <p>Chưa có giao dịch điểm.</p>
            )}
            <div className="flex items-center gap-3">
              <Button variant="ghost" disabled={page === 1} onClick={() => setPage(page - 1)}>
                Trước
              </Button>
              <span>Trang {page}</span>
              <Button
                variant="ghost"
                disabled={!history.data || page * 20 >= history.data.total}
                onClick={() => setPage(page + 1)}
              >
                Sau
              </Button>
            </div>
          </section>
          <details className="rounded-2xl border p-4">
            <summary className="cursor-pointer font-semibold">Đổi mật khẩu</summary>
            <form
              className="mt-4 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                mutation.mutate({
                  path: 'password',
                  body: {
                    currentPassword: data.get('currentPassword'),
                    password: data.get('password'),
                  },
                });
                e.currentTarget.reset();
              }}
            >
              <label className="block">
                Mật khẩu hiện tại
                <Input
                  name="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </label>
              <label className="block">
                Mật khẩu mới
                <Input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={64}
                  required
                />
              </label>
              <Button disabled={mutation.isPending}>Đổi và đăng nhập lại</Button>
            </form>
          </details>
        </>
      ) : (
        <section className="space-y-4 rounded-2xl border bg-card p-5">
          <h2 className="text-xl font-semibold">
            {register ? 'Đăng ký thành viên' : 'Đăng nhập thành viên'}
          </h2>
          <form key={String(register)} className="space-y-4" onSubmit={submit}>
            {register ? (
              <label className="block">
                Tên của bạn
                <Input name="name" autoComplete="name" minLength={2} maxLength={80} required />
              </label>
            ) : null}
            <label className="block">
              Số điện thoại
              <Input name="phone" type="tel" autoComplete="tel" maxLength={24} required />
            </label>
            <label className="block">
              Mật khẩu
              <Input
                name="password"
                type="password"
                autoComplete={register ? 'new-password' : 'current-password'}
                minLength={register ? 8 : 1}
                maxLength={64}
                required
              />
            </label>
            <Button className="w-full" disabled={mutation.isPending}>
              {mutation.isPending ? 'Đang xử lý…' : register ? 'Tạo tài khoản' : 'Đăng nhập'}
            </Button>
          </form>
          <Button
            variant="ghost"
            disabled={mutation.isPending}
            onClick={() => {
              setRegister(!register);
              mutation.reset();
            }}
          >
            {register ? 'Đã có tài khoản? Đăng nhập' : 'Chưa có tài khoản? Đăng ký'}
          </Button>
          <p className="text-sm text-muted-foreground">Quên mật khẩu? Liên hệ quầy.</p>
        </section>
      )}
      <details className="text-sm text-muted-foreground">
        <summary className="cursor-pointer py-2">Quyền lợi & tài khoản</summary>
        <div className="space-y-2 pt-2">
          <p>
            Tích 1 điểm / 10.000đ sau khi phục vụ. Đổi 1 điểm = 1.000đ, tối đa 50% tiền sau voucher;
            dùng kèm khi voucher cho phép.
          </p>
          <p>Đăng nhập trước khi đặt để tích điểm. Đơn cũ không được cộng lại.</p>
          <p>
            Ghi nhớ đăng nhập 14 ngày, dùng chung tại bàn và mang đi. Rời bàn không đăng xuất thành
            viên.
          </p>
          <p>SĐT là tên đăng nhập, chưa xác minh qua SMS.</p>
        </div>
      </details>
      {notice ? <p role="status">{notice}</p> : null}
      {mutation.isError ? (
        <p role="alert" className="text-danger">
          {getErrorMessage(mutation.error)}
        </p>
      ) : null}
    </div>
  );
}
