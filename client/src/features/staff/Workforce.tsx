import { useState, useCallback, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Users } from 'lucide-react';
import { z } from 'zod';
import {
  workShiftCreateSchema,
  workShiftUpdateSchema,
  workAttendanceCorrectionSchema,
  staffingPolicySchema,
  type WorkShiftDto,
  type WorkforceWeek,
} from '@may-cafe/contracts';
import { api, unwrap, getErrorMessage, getAxiosError } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { ErrorState } from '../../components/ui/EmptyState';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';
import { useAuth } from '../auth/useAuth';
import { useSocketEvent } from '../../lib/socket';
import {
  WorkforceCopyModal,
  WorkforceExportButton,
  WorkforcePeaksPanel,
  WorkforceCashPanel,
} from './WorkforceExtras';

const DAY = 86400000;
// getRandomValues also works on HTTP LAN portals, where randomUUID may be unavailable.
function newRequestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const vnDate = (date: Date) => new Date(date.getTime() + 7 * 3600000).toISOString().slice(0, 10);
const localInput = (iso: string) =>
  new Date(Date.parse(iso) + 7 * 3600000).toISOString().slice(0, 16);
const asIso = (value: FormDataEntryValue | null) =>
  new Date(`${String(value)}:00+07:00`).toISOString();
const stamp = (iso: string) =>
  new Date(iso).toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
  });
function monday() {
  const date = new Date(`${vnDate(new Date())}T00:00:00+07:00`);
  const weekday = new Date(date.getTime() + 7 * 3600000).getUTCDay() || 7;
  return vnDate(new Date(date.getTime() - (weekday - 1) * DAY));
}
const attendanceLabels = {
  CANCELLED: 'Đã hủy',
  UPCOMING: 'Sắp tới',
  WAITING: 'Chưa vào ca',
  ABSENT: 'Vắng',
  WORKING: 'Đang làm',
  COMPLETED: 'Đã ra ca',
};
type Editor =
  | { kind: 'schedule'; shift: WorkShiftDto | null; requestId: string }
  | { kind: 'cancel'; shift: WorkShiftDto }
  | { kind: 'attendance'; shift: WorkShiftDto }
  | { kind: 'policy'; version: number; rules: WorkforceWeek['policy']['rules']; capacity: number };
type Write = { method: 'post' | 'patch' | 'put'; url: string; body: unknown };

export function Workforce({ admin = false }: { admin?: boolean }): JSX.Element {
  useDocumentTitle(admin ? 'Lịch ca & hiệu suất' : 'Lịch làm & chấm công');
  const qc = useQueryClient();
  const userId = useAuth((state) => state.user?.id);
  const [from, setFrom] = useState(monday);
  const [tab, setTab] = useState<'schedule' | 'metrics' | 'coverage' | 'cash'>('schedule');
  const [copyRequestId, setCopyRequestId] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState<Write | null>(null);
  const [message, setMessage] = useState('');
  const query = useQuery({
    queryKey: ['workforce', admin, userId, from],
    queryFn: async () =>
      unwrap<WorkforceWeek>(
        await api.get(`${admin ? '/admin' : '/staff'}/workforce`, { params: { from } }),
      ),
    refetchInterval: 30000,
  });
  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['workforce'] });
  }, [qc]);
  useSocketEvent('workforce.changed', refresh);
  useSocketEvent('order.statusChanged', refresh);
  useSocketEvent('connect', refresh);
  const save = useMutation({
    mutationFn: async (write: Write) => api[write.method](write.url, write.body),
    onSuccess: (result, write) => {
      const updated = unwrap<{ shift?: WorkShiftDto }>(result).shift;
      if (admin && updated && /^\/admin\/workforce\/shifts(?:\/[^/]+)?$/.test(write.url)) {
        const start = Date.parse(`${from}T00:00:00+07:00`);
        if (Date.parse(updated.startsAt) >= start + 7 * DAY || Date.parse(updated.endsAt) <= start)
          setFrom(vnDate(new Date(updated.startsAt)));
        setTab('schedule');
      }
      setUncertain(null);
      setEditor(null);
      setError('');
      setMessage('Đã ghi nhận.');
      void qc.invalidateQueries({ queryKey: ['workforce'] });
    },
    onError: (err, write) => {
      const status = getAxiosError(err)?.response?.status;
      setUncertain(!status || status >= 500 ? write : null);
      setError(getErrorMessage(err));
      void qc.invalidateQueries({ queryKey: ['workforce'] });
    },
  });
  const data = query.data;
  const busy = save.isPending || !!uncertain;
  function open(next: Editor) {
    setEditor(next);
    setError('');
    setMessage('');
  }
  function send(write: Write) {
    setError('');
    setMessage('');
    save.mutate(write);
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editor || !data) return;
    const f = new FormData(e.currentTarget);
    try {
      if (editor.kind === 'schedule') {
        const fields = {
          staffId: f.get('staffId'),
          label: f.get('label'),
          note: f.get('note'),
          startsAt: asIso(f.get('startsAt')),
          endsAt: asIso(f.get('endsAt')),
        };
        const body = editor.shift
          ? workShiftUpdateSchema.parse({ ...fields, expectedVersion: editor.shift.version })
          : workShiftCreateSchema.parse({ ...fields, requestId: editor.requestId });
        send({
          method: editor.shift ? 'patch' : 'post',
          url: `/admin/workforce/shifts${editor.shift ? `/${editor.shift.id}` : ''}`,
          body,
        });
      } else if (editor.kind === 'cancel') {
        send({
          method: 'post',
          url: `/admin/workforce/shifts/${editor.shift.id}/cancel`,
          body: { expectedVersion: editor.shift.version, reason: String(f.get('reason')).trim() },
        });
      } else if (editor.kind === 'attendance') {
        const body = workAttendanceCorrectionSchema.parse({
          expectedVersion: editor.shift.version,
          startsAt: asIso(f.get('startsAt')),
          endsAt: asIso(f.get('endsAt')),
          reason: f.get('reason'),
        });
        send({
          method: 'post',
          url: `/admin/workforce/shifts/${editor.shift.id}/attendance`,
          body,
        });
      } else {
        const rules = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-rule]')).map(
          (_, index) => ({
            day: Number(f.get(`day-${index}`)),
            label: f.get(`label-${index}`),
            startMinute: minuteValue(f.get(`start-${index}`)),
            endMinute: minuteValue(f.get(`end-${index}`)),
            minStaff: Number(f.get(`min-${index}`)),
          }),
        );
        send({
          method: 'put',
          url: '/admin/workforce/policy',
          body: staffingPolicySchema.parse({
            expectedVersion: editor.version,
            rules,
            ordersPerStaffHour: Number(f.get('ordersPerStaffHour')),
          }),
        });
      }
    } catch (err) {
      setError(
        err instanceof z.ZodError
          ? (err.issues[0]?.message ?? 'Kiểm tra lại thông tin.')
          : 'Kiểm tra lại ngày và giờ.',
      );
    }
  }
  function clock(shift: WorkShiftDto, direction: 'in' | 'out') {
    send({
      method: 'post',
      url: `/staff/workforce/${shift.id}/clock-${direction}`,
      body: { expectedVersion: shift.version },
    });
  }
  const current = data?.currentShift;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Nhân sự · Giờ Việt Nam (UTC+7)</p>
          <h1 className="font-display text-3xl">
            {admin ? 'Lịch ca & hiệu suất' : 'Lịch làm & chấm công'}
          </h1>
        </div>
        {admin ? (
          <Button
            disabled={busy || !data}
            onClick={() => open({ kind: 'schedule', shift: null, requestId: newRequestId() })}
          >
            <CalendarDays className="mr-2 h-4 w-4" />
            Xếp ca
          </Button>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">
        Vào ca từ 30 phút trước giờ bắt đầu. Trễ được tính sau 5 phút. Giờ làm chỉ cộng khi đã ra
        ca; quên chấm công cần quản lý điều chỉnh.
      </p>
      {!admin && current ? (
        <section
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary bg-primary/5 p-5"
          aria-label="Ca đang làm"
        >
          <div>
            <p className="font-semibold">
              <Clock3 className="mr-2 inline h-5 w-5" />
              Đang làm · {current.label}
            </p>
            <p className="text-sm">
              Vào lúc {stamp(current.effectiveInAt!)} · Lịch {stamp(current.startsAt)} –{' '}
              {stamp(current.endsAt)}
            </p>
          </div>
          <Button disabled={busy} onClick={() => clock(current, 'out')}>
            Ra ca
          </Button>
        </section>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label="Tuần trước"
          disabled={busy}
          onClick={() => setFrom(vnDate(new Date(Date.parse(`${from}T00:00:00+07:00`) - 7 * DAY)))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <label className="text-sm">
          Tuần từ
          <Input
            type="date"
            value={from}
            disabled={busy}
            onChange={(e) => {
              if (e.target.value) setFrom(e.target.value);
            }}
          />
        </label>
        <Button
          variant="outline"
          size="icon"
          aria-label="Tuần sau"
          disabled={busy}
          onClick={() => setFrom(vnDate(new Date(Date.parse(`${from}T00:00:00+07:00`) + 7 * DAY)))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => setFrom(monday())}>
          Tuần này
        </Button>
        <Button
          variant="outline"
          disabled={save.isPending}
          onClick={() => {
            setError('');
            void query.refetch();
          }}
        >
          Tải lại
        </Button>
        {admin ? (
          <Button
            variant="outline"
            disabled={busy || !data}
            onClick={() => setCopyRequestId(newRequestId())}
          >
            Sao chép lịch tuần
          </Button>
        ) : null}
        <WorkforceExportButton admin={admin} from={from} disabled={busy || !data} />
      </div>
      <div className="flex flex-wrap gap-2" aria-label="Nội dung nhân sự">
        <Button
          variant={tab === 'schedule' ? 'primary' : 'outline'}
          onClick={() => setTab('schedule')}
        >
          Lịch & chấm công
        </Button>
        <Button
          variant={tab === 'metrics' ? 'primary' : 'outline'}
          onClick={() => setTab('metrics')}
        >
          Hiệu suất
        </Button>
        {admin ? (
          <Button
            variant={tab === 'coverage' ? 'primary' : 'outline'}
            onClick={() => setTab('coverage')}
          >
            Nhu cầu nhân sự
          </Button>
        ) : null}
        {admin ? (
          <Button variant={tab === 'cash' ? 'primary' : 'outline'} onClick={() => setTab('cash')}>
            Đối soát ca thu ngân
          </Button>
        ) : null}
      </div>
      {message ? (
        <p role="status" className="text-success">
          {message}
        </p>
      ) : null}
      {!editor && error ? (
        <p role="alert" className="text-danger">
          {error}
        </p>
      ) : null}
      {!editor && uncertain ? (
        <Retry write={uncertain} pending={save.isPending} onRetry={send} />
      ) : null}
      {query.isError ? (
        <ErrorState message={getErrorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : query.isPending ? (
        <p>Đang tải lịch…</p>
      ) : data ? (
        <>
          {tab === 'schedule' ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {Array.from({ length: 7 }, (_, d) => {
                const day = vnDate(new Date(Date.parse(`${from}T00:00:00+07:00`) + d * DAY));
                const shifts = data.shifts.filter(
                  (s) =>
                    vnDate(new Date(s.startsAt)) <= day &&
                    vnDate(new Date(Date.parse(s.endsAt) - 1)) >= day,
                );
                return (
                  <section key={day} className="min-w-0 rounded-2xl border bg-card p-4">
                    <h2 className="mb-3 font-semibold">
                      {new Date(`${day}T00:00:00+07:00`).toLocaleDateString('vi-VN', {
                        timeZone: 'Asia/Ho_Chi_Minh',
                        weekday: 'long',
                        day: '2-digit',
                        month: '2-digit',
                      })}
                    </h2>
                    {!shifts.length ? (
                      <p className="text-sm text-muted-foreground">Chưa có lịch ca.</p>
                    ) : (
                      <div className="space-y-3">
                        {shifts.map((s) => (
                          <article className="space-y-2 rounded-xl border p-3" key={s.id}>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <h3 className="font-semibold">
                                {s.staffName} · {s.label}
                              </h3>
                              <span
                                className={`rounded-full px-2 py-1 text-xs ${s.attendance === 'ABSENT' ? 'bg-danger/10 text-danger' : s.attendance === 'WORKING' ? 'bg-primary/10 text-primary' : 'bg-muted'}`}
                              >
                                {attendanceLabels[s.attendance]}
                              </span>
                            </div>
                            <p className="text-sm">
                              {stamp(s.startsAt)} – {stamp(s.endsAt)}
                            </p>
                            {s.note ? (
                              <p className="break-words text-sm text-muted-foreground">{s.note}</p>
                            ) : null}
                            {s.effectiveInAt ? (
                              <p className="text-sm">
                                Thực tế {stamp(s.effectiveInAt)} →{' '}
                                {s.effectiveOutAt ? stamp(s.effectiveOutAt) : 'chưa ra ca'}
                                {s.workedMinutes !== null ? ` · ${s.workedMinutes} phút` : ''}
                                {s.lateMinutes ? ` · Trễ ${s.lateMinutes} phút sau dung sai` : ''}
                              </p>
                            ) : null}
                            {s.correctionReason ? (
                              <p className="break-words text-sm text-muted-foreground">
                                Điều chỉnh bởi {s.correctedByName}: {s.correctionReason}. Chấm gốc:{' '}
                                {s.clockInAt ? stamp(s.clockInAt) : 'chưa vào'} →{' '}
                                {s.clockOutAt ? stamp(s.clockOutAt) : 'chưa ra'}.
                              </p>
                            ) : null}
                            {s.cancelReason ? (
                              <p className="break-words text-sm text-muted-foreground">
                                Lý do hủy: {s.cancelReason}
                              </p>
                            ) : null}
                            {data.shiftMetrics
                              .filter((m) => m.workShiftId === s.id)
                              .map((m) => (
                                <p key={m.workShiftId} className="text-xs text-muted-foreground">
                                  KDS gắn ca: nhận {m.confirmed} · pha {m.preparing} · sẵn sàng{' '}
                                  {m.ready} · giao {m.served}
                                  {m.averagePreparationMinutes !== null
                                    ? ` · pha TB ${m.averagePreparationMinutes} phút (${m.preparationSamples} mẫu)`
                                    : ''}
                                  {m.averageOrderRating !== null
                                    ? ` · sao đơn đã giao ${m.averageOrderRating}/5 (${m.reviewedOrders} đơn)`
                                    : ''}
                                </p>
                              ))}
                            <div className="flex flex-wrap gap-2">
                              {admin && s.status === 'SCHEDULED' ? (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={busy}
                                    onClick={() =>
                                      open({
                                        kind: 'schedule',
                                        shift: s,
                                        requestId: newRequestId(),
                                      })
                                    }
                                  >
                                    Sửa lịch
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={busy}
                                    onClick={() => open({ kind: 'cancel', shift: s })}
                                  >
                                    Hủy ca
                                  </Button>
                                </>
                              ) : null}
                              {admin &&
                              s.status !== 'CANCELLED' &&
                              Date.parse(s.startsAt) < Date.parse(data.now) ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={busy}
                                  onClick={() => open({ kind: 'attendance', shift: s })}
                                >
                                  Điều chỉnh giờ
                                </Button>
                              ) : null}
                              {!admin && s.status === 'SCHEDULED' ? (
                                <Button
                                  size="sm"
                                  disabled={
                                    busy ||
                                    !!current ||
                                    Date.parse(data.now) < Date.parse(s.startsAt) - 1800000 ||
                                    Date.parse(data.now) >= Date.parse(s.endsAt)
                                  }
                                  onClick={() => clock(s, 'in')}
                                >
                                  Vào ca
                                </Button>
                              ) : null}
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          ) : tab === 'coverage' ? (
            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="max-w-2xl text-sm text-muted-foreground">
                  Đặt số người tối thiểu cho từng khung giờ, kể cả giờ cao điểm. Số đã xếp là mức
                  thấp nhất trong cả khung; nhân viên bị khóa/xóa không được tính.
                </p>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    open({
                      kind: 'policy',
                      version: data.policy.version,
                      rules: data.policy.rules,
                      capacity: data.policy.ordersPerStaffHour,
                    })
                  }
                >
                  <Users className="mr-2 h-4 w-4" />
                  Cấu hình nhu cầu
                </Button>
              </div>
              <WorkforcePeaksPanel
                data={data.peaks}
                rules={data.policy.rules}
                busy={busy}
                onUse={(rule) =>
                  open({
                    kind: 'policy',
                    version: data.policy.version,
                    rules: [...data.policy.rules, rule],
                    capacity: data.policy.ordersPerStaffHour,
                  })
                }
              />
              {!data.coverage.length ? (
                <p className="rounded-2xl border bg-card p-5">
                  Chưa có khung nhu cầu. Thêm khung giờ để kiểm tra thiếu người.
                </p>
              ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {data.coverage.map((c) => (
                    <article
                      key={c.startsAt}
                      className={`rounded-2xl border bg-card p-4 ${c.shortage || (c.presentNow !== null && c.presentNow < c.required) ? 'border-danger' : ''}`}
                    >
                      <h2 className="font-semibold">{c.label}</h2>
                      <p className="text-sm">
                        {stamp(c.startsAt)} – {time(c.endsAt)}
                      </p>
                      <p className="mt-2">
                        Đã xếp {c.scheduled}/{c.required} người
                        {c.shortage ? ` · Thiếu ${c.shortage}` : ' · Đủ lịch'}
                      </p>
                      {c.presentNow !== null ? (
                        <p className={c.presentNow < c.required ? 'text-danger' : 'text-success'}>
                          Đang chấm công {c.presentNow}/{c.required} người
                        </p>
                      ) : null}
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : tab === 'cash' ? (
            <WorkforceCashPanel data={data.cash} />
          ) : (
            <section className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Chỉ ghi nhận thao tác KDS từ khi bật tính năng. Mỗi công đoạn tính cho người bấm;
                thời gian pha từ Bắt đầu pha → Sẵn sàng tính cho người bắt đầu pha, theo tuần hoàn
                tất pha. Sao là đánh giá đơn do người đó giao, kèm số mẫu; không phải điểm cá nhân.
              </p>
              <div className="overflow-x-auto rounded-2xl border bg-card">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Hiệu suất nhân viên trong tuần đã chọn</caption>
                  <thead className="bg-muted">
                    <tr>
                      {[
                        'Nhân viên',
                        'Lịch / Thực tế (giờ)',
                        'Vắng / Trễ / Chưa ra',
                        'Nhận / Pha / Sẵn sàng / Giao',
                        'Ngoài ca',
                        'Pha TB (phút)',
                        'Sao đơn đã giao',
                      ].map((h) => (
                        <th className="whitespace-nowrap p-3" key={h}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.metrics.map((m) => (
                      <tr key={m.staffId} className="border-t">
                        <th scope="row" className="whitespace-nowrap p-3">
                          {m.staffName}
                        </th>
                        <td className="p-3">
                          {(m.scheduledMinutes / 60).toFixed(1)} /{' '}
                          {(m.workedMinutes / 60).toFixed(1)}
                        </td>
                        <td className="p-3">
                          {m.absentShifts} / {m.lateShifts} / {m.openAttendances}
                        </td>
                        <td className="p-3">
                          {m.confirmed} / {m.preparing} / {m.ready} / {m.served}
                        </td>
                        <td className="p-3">{m.outsideShiftActions}</td>
                        <td className="whitespace-nowrap p-3">
                          {m.averagePreparationMinutes === null
                            ? 'Chưa có mẫu'
                            : `${m.averagePreparationMinutes} (${m.preparationSamples} mẫu)`}
                        </td>
                        <td className="whitespace-nowrap p-3">
                          {m.averageOrderRating === null
                            ? 'Chưa có mẫu'
                            : `${m.averageOrderRating}/5 (${m.reviewedOrders} đơn)`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!data.metrics.length ? <p>Chưa có dữ liệu trong tuần này.</p> : null}
              <p className="text-sm text-muted-foreground">
                Giờ thực tế được chia theo ranh giới tuần; ca chưa ra không tự cộng giờ. Thao tác
                ngoài ca vẫn ghi nhận. Điều chỉnh chấm công không đổi người/ca đã gắn với thao tác
                KDS.
              </p>
              {admin ? (
                <p className="text-sm">
                  Đối soát chênh lệch tiền xem tại tab Đối soát ca thu ngân. Lịch làm không chia
                  chênh lệch tiền cho từng nhân viên.
                </p>
              ) : null}
            </section>
          )}
        </>
      ) : null}
      <Modal
        open={!!editor}
        onOpenChange={(v) => {
          if (!v && !busy) setEditor(null);
        }}
        title={
          editor?.kind === 'schedule'
            ? editor.shift
              ? 'Sửa lịch ca'
              : 'Xếp ca'
            : editor?.kind === 'cancel'
              ? 'Hủy lịch ca'
              : editor?.kind === 'attendance'
                ? 'Điều chỉnh chấm công'
                : 'Nhu cầu nhân sự'
        }
      >
        {editor && data ? (
          <form
            key={
              editor.kind === 'policy'
                ? `policy-${editor.version}`
                : editor.kind === 'schedule'
                  ? (editor.shift?.id ?? editor.requestId)
                  : editor.shift.id
            }
            onSubmit={submit}
            className="space-y-4"
          >
            <fieldset disabled={busy} className="space-y-4">
              {editor.kind === 'schedule' ? (
                <>
                  <label className="block text-sm">
                    Nhân viên
                    <select
                      name="staffId"
                      defaultValue={editor.shift?.staffId}
                      required
                      className="mt-1 w-full rounded-xl border bg-background p-3"
                    >
                      {data.staff
                        .filter((s) => s.isActive)
                        .map((s) => (
                          <option value={s.id} key={s.id}>
                            {s.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="block text-sm">
                    Tên ca
                    <Input
                      name="label"
                      defaultValue={editor.shift?.label ?? 'Ca sáng'}
                      maxLength={80}
                      required
                    />
                  </label>
                  <TimeFields
                    start={editor.shift?.startsAt ?? `${from}T07:00:00+07:00`}
                    end={editor.shift?.endsAt ?? `${from}T12:00:00+07:00`}
                  />
                  <label className="block text-sm">
                    Ghi chú
                    <Input name="note" defaultValue={editor.shift?.note ?? ''} maxLength={500} />
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Mỗi ca tối đa 16 giờ, có thể qua đêm. Không trùng lịch của cùng nhân viên. Ca đã
                    vào làm không thể sửa lịch.
                  </p>
                </>
              ) : editor.kind === 'attendance' ? (
                <>
                  <p className="text-sm">
                    {editor.shift.staffName} · {editor.shift.label}. Giữ nguyên giờ bấm gốc và lưu
                    lịch sử điều chỉnh. Hai giờ thực tế phải ở quá khứ, tối đa 24 giờ.
                  </p>
                  <TimeFields
                    start={editor.shift.effectiveInAt ?? editor.shift.startsAt}
                    end={editor.shift.effectiveOutAt ?? editor.shift.endsAt}
                  />
                  <label className="block text-sm">
                    Lý do điều chỉnh
                    <Input name="reason" minLength={3} maxLength={500} required />
                  </label>
                </>
              ) : editor.kind === 'cancel' ? (
                <>
                  <p>
                    Hủy ca {editor.shift.label} của {editor.shift.staffName}?
                  </p>
                  <label className="block text-sm">
                    Lý do hủy
                    <Input name="reason" minLength={3} maxLength={500} required />
                  </label>
                </>
              ) : (
                <PolicyFields rules={editor.rules} capacity={editor.capacity} />
              )}
              <Button type="submit" disabled={busy}>
                {save.isPending ? 'Đang ghi…' : 'Lưu'}
              </Button>
            </fieldset>
            {error ? (
              <p role="alert" className="text-danger">
                {error}
              </p>
            ) : null}
            {uncertain ? <Retry write={uncertain} pending={save.isPending} onRetry={send} /> : null}
            {!busy && error ? (
              <p className="text-xs text-muted-foreground">
                Nếu ca đã đổi, đóng hộp này và tải lại trước khi sửa tiếp.
              </p>
            ) : null}
          </form>
        ) : null}
      </Modal>
      {copyRequestId ? (
        <WorkforceCopyModal
          from={from}
          requestId={copyRequestId}
          onClose={() => setCopyRequestId(null)}
          onSuccess={(count, targetFrom) => {
            setCopyRequestId(null);
            setFrom(targetFrom);
            setMessage(`Đã sao chép ${count} ca.`);
            void qc.invalidateQueries({ queryKey: ['workforce'] });
          }}
        />
      ) : null}
    </div>
  );
}
function TimeFields({ start, end }: { start: string; end: string }) {
  return (
    <>
      <label className="block text-sm">
        Bắt đầu (giờ Việt Nam)
        <Input name="startsAt" type="datetime-local" defaultValue={localInput(start)} required />
      </label>
      <label className="block text-sm">
        Kết thúc (giờ Việt Nam)
        <Input name="endsAt" type="datetime-local" defaultValue={localInput(end)} required />
      </label>
    </>
  );
}
const minuteValue = (value: FormDataEntryValue | null) => {
  const [h, m] = String(value).split(':').map(Number);
  return h! * 60 + m!;
};
const minuteInput = (n: number) =>
  `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
function PolicyFields({
  rules,
  capacity,
}: {
  rules: WorkforceWeek['policy']['rules'];
  capacity: number;
}) {
  const [rows, setRows] = useState(rules.map((r, i) => ({ ...r, key: `saved-${i}` })));
  return (
    <div className="space-y-3">
      <label className="block text-sm">
        Định mức đơn/người/giờ
        <Input
          name="ordersPerStaffHour"
          type="number"
          min={1}
          max={100}
          step={1}
          defaultValue={capacity ?? 6}
          required
        />
      </label>
      <p className="text-sm text-muted-foreground">
        Thứ 2–Chủ nhật, số người tối thiểu cho toàn khung. Các khung trong cùng ngày không chồng
        lấn. Chọn 24:00 cho cuối ngày.
      </p>
      {rows.map((r, i) => (
        <div data-rule key={r.key} className="space-y-2 rounded-xl border p-3">
          <label className="block text-sm">
            Tên khung
            <Input name={`label-${i}`} defaultValue={r.label} maxLength={80} required />
          </label>
          <label className="block text-sm">
            Ngày
            <select
              name={`day-${i}`}
              defaultValue={r.day}
              className="w-full rounded-xl border bg-background p-2"
            >
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <option value={d} key={d}>
                  {d === 7 ? 'Chủ nhật' : `Thứ ${d + 1}`}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm">
              Từ
              <Input
                name={`start-${i}`}
                type="time"
                defaultValue={minuteInput(r.startMinute)}
                required
              />
            </label>
            <label className="text-sm">
              Đến
              <select
                name={`end-${i}`}
                defaultValue={minuteInput(r.endMinute)}
                className="w-full rounded-xl border bg-background p-3"
              >
                {[...new Set([...Array.from({ length: 96 }, (_, n) => (n + 1) * 15), r.endMinute])]
                  .sort((a, b) => a - b)
                  .map((n) => (
                    <option value={minuteInput(n)} key={n}>
                      {minuteInput(n)}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <label className="block text-sm">
            Số người tối thiểu
            <Input
              name={`min-${i}`}
              type="number"
              min={1}
              max={50}
              step={1}
              defaultValue={r.minStaff}
              required
            />
          </label>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setRows(rows.filter((row) => row.key !== r.key))}
          >
            Bỏ khung
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        disabled={rows.length >= 100}
        onClick={() =>
          setRows([
            ...rows,
            {
              day: 1,
              startMinute: 420,
              endMinute: 540,
              minStaff: 2,
              label: 'Cao điểm sáng',
              key: newRequestId(),
            },
          ])
        }
      >
        Thêm khung giờ
      </Button>
      {!rows.length ? (
        <p className="text-sm">Lưu danh sách rỗng sẽ tắt cảnh báo thiếu người.</p>
      ) : null}
    </div>
  );
}
function Retry({
  write,
  pending,
  onRetry,
}: {
  write: Write;
  pending: boolean;
  onRetry: (write: Write) => void;
}) {
  return (
    <div className="space-y-2 rounded-xl border p-3">
      <p className="text-sm">Chưa rõ kết quả ghi nhận. Giữ nguyên yêu cầu để thử lại an toàn.</p>
      <Button type="button" disabled={pending} onClick={() => onRetry(write)}>
        Thử lại yêu cầu
      </Button>
    </div>
  );
}
