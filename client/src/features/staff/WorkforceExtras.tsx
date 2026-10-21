import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type {
  WorkCopyPreview,
  WorkforceCash,
  WorkforcePeaks,
  WorkforceWeek,
} from '@may-cafe/contracts';
import { api, unwrap, getErrorMessage, getAxiosError, vnd } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';

const dateTime = (s: string) =>
  new Date(s).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
const dayName = (d: number) => (d === 7 ? 'Chủ nhật' : `Thứ ${d + 1}`);
const hourName = (h: number) => `${String(h).padStart(2, '0')}:00`;
export function WorkforcePeaksPanel({
  data,
  rules,
  busy,
  onUse,
}: {
  data: WorkforcePeaks | null;
  rules: WorkforceWeek['policy']['rules'];
  busy: boolean;
  onUse: (rule: WorkforceWeek['policy']['rules'][number]) => void;
}) {
  if (!data) return null;
  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4">
      <h2 className="font-semibold">Gợi ý từ lịch sử đơn</h2>
      <p className="text-sm text-muted-foreground">
        {data.paidOrders} đơn đã thanh toán từ {dateTime(data.from)} đến trước{' '}
        {dateTime(data.until)} ({data.weeks} tuần). Định mức {data.ordersPerStaffHour}{' '}
        đơn/người/giờ; chia đều cho 4 lần xuất hiện mỗi thứ, kể cả tuần không có đơn. Gợi ý để quản
        lý xem xét.
      </p>
      {!data.enoughData ? (
        <p>Cần ít nhất {data.minimumOrders} đơn trong khoảng này để gợi ý nhân sự.</p>
      ) : !data.items.length ? (
        <p>Chưa có khung nào đủ 3 đơn để làm mẫu.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.items.map((p) => {
            const covered = rules.some(
              (r) =>
                r.day === p.day && r.startMinute < (p.hour + 1) * 60 && r.endMinute > p.hour * 60,
            );
            return (
              <article key={`${p.day}-${p.hour}`} className="space-y-2 rounded-xl border p-3">
                <h3 className="font-semibold">
                  {dayName(p.day)} · {hourName(p.hour)}–{hourName(p.hour + 1)}
                </h3>
                <p className="text-sm">
                  {p.orders} đơn / {p.occurrences} tuần · TB {p.averageOrders} đơn/giờ
                </p>
                <p className="text-sm">Gợi ý tối thiểu {p.recommendedStaff} người</p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || covered}
                  onClick={() =>
                    onUse({
                      day: p.day,
                      startMinute: p.hour * 60,
                      endMinute: (p.hour + 1) * 60,
                      minStaff: p.recommendedStaff,
                      label: `Cao điểm ${hourName(p.hour)}`,
                    })
                  }
                  aria-label={`Dùng gợi ý ${dayName(p.day)} ${hourName(p.hour)}`}
                >
                  {covered ? 'Đã có khung giao giờ này' : 'Dùng gợi ý'}
                </Button>
              </article>
            );
          })}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Chọn gợi ý để mở bản nháp cấu hình rồi bấm Lưu. Chưa tự thay lịch hay số người tối thiểu;
        định mức điều chỉnh ở Cấu hình nhu cầu.
      </p>
    </section>
  );
}

export function WorkforceCashPanel({ data }: { data: WorkforceCash | null }) {
  if (!data) return <p>Đang tải đối soát…</p>;
  return (
    <section className="space-y-4">
      <div className="rounded-2xl border bg-card p-4">
        <h2 className="font-semibold">Đối soát ca thu ngân</h2>
        <p className="mt-2">
          {data.closedCount} ca chốt trong tuần · Tổng chênh lệch {vnd(data.totalDifference)}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Hiển thị ca mở/chốt trong tuần và ca thu ngân đang mở. Tổng chênh lệch tính toàn bộ ca
          chốt trong tuần, theo giờ chốt. Số tiền lấy từ biên bản đối soát; người có lịch làm trùng
          giờ không tự chịu chênh lệch này.
        </p>
      </div>
      <div className="overflow-x-auto rounded-2xl border bg-card">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Đối soát ca thu ngân trong tuần</caption>
          <thead className="bg-muted">
            <tr>
              {[
                'Ca',
                'Người mở / chốt',
                'Mở / chốt lúc',
                'Tiền dự kiến / kiểm đếm',
                'Chênh lệch',
                'Giải trình',
              ].map((h) => (
                <th key={h} className="whitespace-nowrap p-3">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.items.map((s) => (
              <tr key={s.id} className="border-t">
                <th className="p-3" scope="row">
                  {s.code}
                  <p className="text-xs font-normal">
                    {s.status === 'OPEN' ? 'Đang mở' : 'Đã chốt'}
                  </p>
                </th>
                <td className="p-3">
                  {s.openedByName}
                  <br />
                  {s.closedByName || 'Chưa chốt'}
                </td>
                <td className="whitespace-nowrap p-3">
                  {dateTime(s.openedAt)}
                  <br />
                  {s.closedAt ? dateTime(s.closedAt) : '—'}
                </td>
                <td className="whitespace-nowrap p-3">
                  {s.expectedCash === null ? 'Chưa chốt' : vnd(s.expectedCash)} /{' '}
                  {s.countedCash === null ? 'Chưa chốt' : vnd(s.countedCash)}
                </td>
                <td className={`whitespace-nowrap p-3 ${s.difference ? 'text-danger' : ''}`}>
                  {s.difference === null ? 'Chưa chốt' : vnd(s.difference)}
                </td>
                <td className="min-w-48 max-w-sm break-words p-3">{s.reconciliationNote || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!data.total ? (
        <p>Chưa có ca thu ngân trong khoảng đã chọn.</p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Hiển thị {data.items.length}/{data.total} ca gần nhất. Tổng phía trên không bị giới hạn
          bởi số dòng hiển thị.
        </p>
      )}
      <Link to="/admin/payments" className="text-sm font-semibold text-primary underline">
        Xem khoản thu và lịch sử điều chỉnh
      </Link>
    </section>
  );
}

export function WorkforceExportButton({
  admin,
  from,
  disabled,
}: {
  admin: boolean;
  from: string;
  disabled: boolean;
}) {
  const [error, setError] = useState('');
  const exportFile = useMutation({
    mutationFn: async () => {
      const res = await api.get<Blob>(`${admin ? '/admin' : '/staff'}/workforce/export`, {
        params: { from },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `bang-cong-${from}.csv`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      const revoke = URL.revokeObjectURL.bind(URL);
      setTimeout(() => revoke(url), 1000);
    },
    onError: (e) => setError(getErrorMessage(e)),
  });
  return (
    <div>
      <Button
        variant="outline"
        disabled={disabled || exportFile.isPending}
        onClick={() => {
          setError('');
          exportFile.mutate();
        }}
      >
        {exportFile.isPending ? 'Đang xuất…' : 'Xuất bảng công CSV'}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function WorkforceCopyModal({
  from,
  requestId,
  onClose,
  onSuccess,
}: {
  from: string;
  requestId: string;
  onClose: () => void;
  onSuccess: (count: number, targetFrom: string) => void;
}) {
  const [targetFrom, setTargetFrom] = useState(() =>
    new Date(Date.parse(`${from}T00:00:00+07:00`) + 7 * 86400000 + 7 * 3600000)
      .toISOString()
      .slice(0, 10),
  );
  const [plan, setPlan] = useState<WorkCopyPreview | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState<unknown | null>(null);
  const preview = useMutation({
    mutationFn: async () =>
      unwrap<WorkCopyPreview>(
        await api.post('/admin/workforce/copy-preview', { from, targetFrom }),
      ),
    onSuccess: (p) => setPlan(p),
    onError: (e) => setError(getErrorMessage(e)),
  });
  const copy = useMutation({
    mutationFn: async (body: unknown) =>
      unwrap<{ count: number }>(await api.post('/admin/workforce/copy', body)),
    onSuccess: (r) => {
      setRetry(null);
      onSuccess(r.count, targetFrom);
    },
    onError: (e, body) => {
      const status = getAxiosError(e)?.response?.status;
      setRetry(!status || status >= 500 ? body : null);
      setError(getErrorMessage(e));
      if (status && status < 500) setPlan(null);
    },
  });
  const busy = preview.isPending || copy.isPending || !!retry;
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setPlan(null);
    preview.mutate();
  }
  return (
    <Modal
      open
      onOpenChange={(v) => {
        if (!v && !busy) onClose();
      }}
      title="Sao chép lịch tuần"
    >
      <form onSubmit={submit} className="space-y-4">
        <fieldset disabled={busy} className="space-y-3">
          <p className="text-sm">
            Lấy ca bắt đầu trong 7 ngày từ {from}, bỏ ca đã hủy. Bản sao chỉ có lịch, không mang giờ
            chấm công, số liệu KDS hay điều chỉnh cũ.
          </p>
          <label className="block text-sm">
            Tuần đích từ
            <Input
              type="date"
              value={targetFrom}
              onChange={(e) => {
                setTargetFrom(e.target.value);
                setPlan(null);
              }}
              required
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Tuần đích cùng thứ, sau tuần nguồn ít nhất 7 ngày. Ca đích phải ở tương lai; có xung đột
            thì không tạo ca nào.
          </p>
          <Button variant="outline" type="submit">
            {preview.isPending ? 'Đang kiểm tra…' : 'Xem trước lịch sao chép'}
          </Button>
        </fieldset>
      </form>
      {plan ? (
        <section className="mt-4 space-y-3">
          <p className="font-semibold">
            {plan.shifts.length} ca sẽ sao chép · {plan.conflicts.length} xung đột
          </p>
          <ul className="max-h-48 space-y-2 overflow-y-auto text-sm">
            {plan.shifts.map((s) => (
              <li key={s.sourceId}>
                {s.staffName} · {s.label} · {dateTime(s.startsAt)} → {dateTime(s.endsAt)}
              </li>
            ))}
          </ul>
          {plan.conflicts.map((c, i) => (
            <p key={i} className="text-sm text-danger">
              {c.staffName} · {c.label}: {c.reason}
            </p>
          ))}
          <Button
            disabled={busy || !!plan.conflicts.length}
            onClick={() => {
              setError('');
              copy.mutate({ from, targetFrom, requestId, snapshot: plan.snapshot });
            }}
          >
            Xác nhận sao chép {plan.shifts.length} ca
          </Button>
        </section>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {retry ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm">Chưa rõ kết quả. Giữ nguyên yêu cầu để thử lại an toàn.</p>
          <Button disabled={copy.isPending} onClick={() => copy.mutate(retry)}>
            Thử lại sao chép
          </Button>
        </div>
      ) : null}
    </Modal>
  );
}
