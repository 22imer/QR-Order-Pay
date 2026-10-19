import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MemberDto, PointEntry } from '@may-cafe/contracts';
import { api, getErrorMessage, unwrap } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { ErrorState } from '../../components/ui/EmptyState';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';
export function AdminMembers(): JSX.Element {
  useDocumentTitle('Thành viên');
  const authApi = api;
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<MemberDto | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [error, setError] = useState('');
  const query = useQuery({
    queryKey: ['admin-members', q, page],
    queryFn: async () =>
      unwrap<{ items: MemberDto[]; total: number }>(
        await authApi.get('/admin/members', { params: { q, page } }),
      ),
  });
  const history = useQuery({
    queryKey: ['admin-member-points', selected?.id, historyPage],
    enabled: !!selected,
    queryFn: async () =>
      unwrap<{ items: PointEntry[]; total: number }>(
        await authApi.get(`/admin/members/${selected!.id}/points`, {
          params: { page: historyPage },
        }),
      ),
  });
  const update = useMutation({
    mutationFn: async (body: unknown) => authApi.patch(`/admin/members/${selected!.id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-members'] });
      setSelected(null);
      setError('');
    },
    onError: (e) => setError(getErrorMessage(e)),
  });
  function reset(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get('password'));
    update.mutate({ expectedVersion: selected!.version, password });
    e.currentTarget.reset();
  }
  return (
    <div className="space-y-5">
      <h1 className="font-display text-3xl">Thành viên</h1>
      <form
        className="flex gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(String(new FormData(e.currentTarget).get('q')).trim());
          setPage(1);
        }}
      >
        <Input name="q" aria-label="Tìm thành viên" placeholder="SĐT hoặc tên" maxLength={80} />
        <Button>Tìm</Button>
      </form>
      {query.isError ? (
        <ErrorState message={getErrorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : query.isPending ? (
        <p>Đang tải…</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {query.data.items.map((m) => (
            <article
              key={m.id}
              className="flex items-center justify-between gap-3 rounded-2xl border bg-card p-4"
            >
              <div>
                <h2 className="font-semibold">{m.name}</h2>
                <p>
                  {m.phone} · {m.points} điểm
                </p>
                <p className="text-sm text-muted-foreground">
                  {m.isActive ? 'Đang hoạt động' : 'Đã khóa'}
                </p>
              </div>
              <Button
                variant="ghost"
                onClick={() => {
                  setSelected(m);
                  setHistoryPage(1);
                  setError('');
                }}
              >
                Chi tiết
              </Button>
            </article>
          ))}
          {!query.data.items.length ? <p>Không có thành viên phù hợp.</p> : null}
        </div>
      )}
      <div className="flex items-center gap-3">
        <Button variant="ghost" disabled={page === 1} onClick={() => setPage(page - 1)}>
          Trước
        </Button>
        <span>Trang {page}</span>
        <Button
          variant="ghost"
          disabled={!query.data || page * 20 >= query.data.total}
          onClick={() => setPage(page + 1)}
        >
          Sau
        </Button>
      </div>
      <Modal
        open={!!selected}
        onOpenChange={(open) => {
          if (!open && !update.isPending) setSelected(null);
        }}
        title={selected ? `${selected.name} · ${selected.phone}` : 'Thành viên'}
      >
        {selected ? (
          <div className="space-y-5">
            <p className="text-lg font-semibold">{selected.points} điểm</p>
            <Button
              variant="ghost"
              disabled={update.isPending}
              onClick={() =>
                update.mutate({ expectedVersion: selected.version, isActive: !selected.isActive })
              }
            >
              {selected.isActive ? 'Khóa tài khoản và đăng xuất mọi thiết bị' : 'Mở lại tài khoản'}
            </Button>
            <details>
              <summary className="cursor-pointer font-semibold">Đặt lại mật khẩu</summary>
              <p className="my-3 text-sm text-muted-foreground">
                Chỉ thực hiện sau khi kiểm tra yêu cầu của khách tại quầy. Tất cả thiết bị sẽ phải
                đăng nhập lại.
              </p>
              <form className="space-y-3" onSubmit={reset}>
                <label className="block text-sm">
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
                <Button disabled={update.isPending}>Xác nhận đặt lại mật khẩu</Button>
              </form>
            </details>
            {error ? (
              <p role="alert" className="text-danger">
                {error}
              </p>
            ) : null}
            <section className="space-y-2">
              <h3 className="font-semibold">Lịch sử điểm</h3>
              {history.isError ? (
                <ErrorState
                  message={getErrorMessage(history.error)}
                  onRetry={() => history.refetch()}
                />
              ) : history.isPending ? (
                <p>Đang tải…</p>
              ) : (
                history.data.items.map((entry) => (
                  <div key={entry.id} className="flex justify-between gap-3 border-b py-2 text-sm">
                    <div>
                      <p>
                        {entry.orderCode} ·{' '}
                        {entry.type === 'EARN' ? 'Tích' : entry.type === 'REDEEM' ? 'Đổi' : 'Hoàn'}{' '}
                        điểm
                      </p>
                      <p>{new Date(entry.createdAt).toLocaleString('vi-VN')}</p>
                    </div>
                    <span>
                      {entry.points > 0 ? '+' : ''}
                      {entry.points} · Còn {entry.balanceAfter}
                    </span>
                  </div>
                ))
              )}
            </section>
            <div className="flex gap-3">
              <Button
                variant="ghost"
                disabled={historyPage === 1}
                onClick={() => setHistoryPage(historyPage - 1)}
              >
                Trước
              </Button>
              <span>{historyPage}</span>
              <Button
                variant="ghost"
                disabled={!history.data || historyPage * 20 >= history.data.total}
                onClick={() => setHistoryPage(historyPage + 1)}
              >
                Sau
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
