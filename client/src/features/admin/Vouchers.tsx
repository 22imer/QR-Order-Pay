import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { voucherCreateSchema, type VoucherDto } from '@may-cafe/contracts';
import { api, unwrap, getErrorMessage, vnd } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { ErrorState } from '../../components/ui/EmptyState';
import { Modal } from '../../components/ui/Modal';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';
const localDate = (value: string) => {
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
export function AdminVouchers(): JSX.Element {
  useDocumentTitle('Voucher');
  const http = api;
  const qc = useQueryClient();
  const [editing, setEditing] = useState<VoucherDto | 'new' | null>(null);
  const [error, setError] = useState('');
  const query = useQuery({
    queryKey: ['admin-vouchers'],
    queryFn: async () => unwrap<{ items: VoucherDto[] }>(await http.get('/admin/vouchers')),
  });
  const save = useMutation({
    mutationFn: async (body: unknown) =>
      editing && editing !== 'new'
        ? http.patch(`/admin/vouchers/${editing.id}`, body)
        : http.post('/admin/vouchers', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-vouchers'] });
      setEditing(null);
    },
    onError: (e) => setError(getErrorMessage(e)),
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const data = new FormData(e.currentTarget);
    try {
      const body = voucherCreateSchema.parse({
        code: data.get('code'),
        name: data.get('name'),
        type: data.get('type'),
        value: Number(data.get('value')),
        minSubtotal: Number(data.get('minSubtotal')),
        maxDiscount: data.get('maxDiscount') ? Number(data.get('maxDiscount')) : null,
        startsAt: new Date(String(data.get('startsAt'))).toISOString(),
        endsAt: new Date(String(data.get('endsAt'))).toISOString(),
        maxUses: Number(data.get('maxUses')),
        memberRequired: data.get('memberRequired') === 'on',
        allowPointRedemption: data.get('allowPointRedemption') === 'on',
        perMemberLimit: data.get('perMemberLimit') ? Number(data.get('perMemberLimit')) : null,
        isActive: data.get('isActive') === 'on',
      });
      save.mutate({
        ...body,
        ...(editing !== 'new' && editing ? { expectedVersion: editing.version } : {}),
      });
    } catch {
      setError(
        'Kiểm tra các trường: % tối đa 100, ngày kết thúc sau ngày bắt đầu; giới hạn mỗi thành viên cần bật yêu cầu thành viên.',
      );
    }
  }
  const current = editing && editing !== 'new' ? editing : null;
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-3xl">Voucher</h1>
        <Button
          onClick={() => {
            setEditing('new');
            setError('');
          }}
        >
          Tạo voucher
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Giảm số tiền cố định hoặc theo %. Lượt đang giữ cho đơn chờ thanh toán được tính vào giới
        hạn; hủy đơn hợp lệ sẽ trả lượt.
      </p>
      {query.isError ? (
        <ErrorState message={getErrorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : query.isPending ? (
        <p>Đang tải…</p>
      ) : query.data.items.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {query.data.items.map((v) => (
            <article className="space-y-3 rounded-2xl border bg-card p-5" key={v.id}>
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-semibold">{v.code}</h2>
                <span className="text-sm">
                  {!v.isActive
                    ? 'Tạm dừng'
                    : new Date(v.endsAt).getTime() <= Date.now()
                      ? 'Hết hạn'
                      : new Date(v.startsAt).getTime() > Date.now()
                        ? 'Sắp bắt đầu'
                        : 'Đang bật'}
                </span>
              </div>
              <p>{v.name}</p>
              <p className="text-xl font-semibold">
                Giảm {v.type === 'FIXED' ? vnd(v.value) : `${v.value}%`}
              </p>
              <p className="text-sm">
                Đơn từ {vnd(v.minSubtotal)}
                {v.maxDiscount ? ` · tối đa ${vnd(v.maxDiscount)}` : ''}
              </p>
              <p className="text-sm">
                {v.usedCount}/{v.maxUses} lượt đang giữ/đã dùng
                {v.memberRequired
                  ? ` · Thành viên${v.perMemberLimit ? `, ${v.perMemberLimit} lượt/người` : ''}`
                  : ''}
              </p>
              <p className="text-sm text-muted-foreground">
                {v.allowPointRedemption ? 'Cho phép dùng kèm điểm' : 'Không dùng kèm điểm'}
              </p>
              <p className="text-sm text-muted-foreground">
                {new Date(v.startsAt).toLocaleString('vi-VN')} –{' '}
                {new Date(v.endsAt).toLocaleString('vi-VN')}
              </p>
              <Button
                variant="ghost"
                onClick={() => {
                  setEditing(v);
                  setError('');
                }}
              >
                Sửa voucher
              </Button>
            </article>
          ))}
        </div>
      ) : (
        <p>Chưa có voucher.</p>
      )}
      <Modal
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open && !save.isPending) setEditing(null);
        }}
        title={current ? `Sửa ${current.code}` : 'Tạo voucher'}
      >
        <form key={current?.id ?? 'new'} onSubmit={submit} className="space-y-4">
          <fieldset disabled={save.isPending} className="space-y-4">
            <label className="block text-sm">
              Mã voucher
              <Input
                name="code"
                defaultValue={current?.code}
                readOnly={!!current}
                required
                minLength={3}
                maxLength={32}
                pattern="[A-Za-z0-9_-]+"
              />
            </label>
            <label className="block text-sm">
              Tên chương trình
              <Input
                name="name"
                defaultValue={current?.name}
                required
                minLength={2}
                maxLength={100}
              />
            </label>
            <label className="block text-sm">
              Loại giảm
              <select
                name="type"
                defaultValue={current?.type ?? 'FIXED'}
                className="mt-1 w-full rounded-xl border bg-background p-3"
              >
                <option value="FIXED">Số tiền (đ)</option>
                <option value="PERCENT">Phần trăm (%)</option>
              </select>
            </label>
            <label className="block text-sm">
              Giá trị giảm
              <Input
                name="value"
                type="number"
                min={1}
                step={1}
                max={100000000}
                defaultValue={current?.value ?? 10000}
                required
              />
            </label>
            <label className="block text-sm">
              Đơn tối thiểu (đ)
              <Input
                name="minSubtotal"
                type="number"
                min={0}
                step={1}
                max={100000000}
                defaultValue={current?.minSubtotal ?? 0}
                required
              />
            </label>
            <label className="block text-sm">
              Giảm tối đa (đ, để trống nếu không giới hạn)
              <Input
                name="maxDiscount"
                type="number"
                min={1}
                step={1}
                max={100000000}
                defaultValue={current?.maxDiscount ?? ''}
              />
            </label>
            <label className="block text-sm">
              Bắt đầu
              <Input
                name="startsAt"
                type="datetime-local"
                defaultValue={localDate(current?.startsAt ?? new Date().toISOString())}
                required
              />
            </label>
            <label className="block text-sm">
              Kết thúc
              <Input
                name="endsAt"
                type="datetime-local"
                defaultValue={localDate(
                  current?.endsAt ?? new Date(Date.now() + 30 * 86400000).toISOString(),
                )}
                required
              />
            </label>
            <label className="block text-sm">
              Tổng lượt dùng
              <Input
                name="maxUses"
                type="number"
                min={1}
                max={1000000}
                step={1}
                defaultValue={current?.maxUses ?? 100}
                required
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                name="memberRequired"
                type="checkbox"
                defaultChecked={current?.memberRequired}
              />
              Yêu cầu đăng nhập thành viên
            </label>
            <label className="block text-sm">
              Lượt mỗi thành viên (để trống nếu không giới hạn)
              <Input
                name="perMemberLimit"
                type="number"
                min={1}
                max={1000000}
                step={1}
                defaultValue={current?.perMemberLimit ?? ''}
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                name="allowPointRedemption"
                type="checkbox"
                defaultChecked={current?.allowPointRedemption ?? false}
              />
              Cho phép dùng kèm điểm
            </label>
            <p className="text-sm text-muted-foreground">
              Trừ voucher trước, sau đó điểm được giảm tối đa 50% số tiền còn lại.
            </p>
            <label className="flex items-center gap-2">
              <input name="isActive" type="checkbox" defaultChecked={current?.isActive ?? true} />
              Bật voucher
            </label>
            {error ? (
              <p role="alert" className="text-danger">
                {error}
              </p>
            ) : null}
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Đang lưu…' : 'Lưu voucher'}
            </Button>
          </fieldset>
        </form>
      </Modal>
    </div>
  );
}
