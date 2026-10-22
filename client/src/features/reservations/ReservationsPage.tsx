import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Clock3, Users, Check, Armchair } from 'lucide-react';
import {
  reservationCreateSchema,
  type Reservation,
  type ReservationCreate,
  type ReservationAvailability,
} from '@may-cafe/contracts';
import { api, unwrap, getErrorMessage, getAxiosError, generateIdempotencyKey } from '../../lib/api';
import { useAuth } from '../auth/useAuth';
import { useMember } from '../guest/useMember';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card } from '../../components/ui/Card';
import { ErrorState } from '../../components/ui/EmptyState';
import { Modal } from '../../components/ui/Modal';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';
import { useSocketEvent } from '../../lib/socket';

const vnTime = (s: string) =>
  new Date(s).toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour12: false,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
const localTime = (d: Date) => new Date(d.getTime() + 7 * 3600000).toISOString().slice(0, 16);
const uuid = () => {
  const raw = generateIdempotencyKey().split('');
  raw[12] = '4';
  raw[16] = ((parseInt(raw[16]!, 16) & 3) | 8).toString(16);
  const s = raw.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
};
const labels: Record<Reservation['status'], string> = {
  CONFIRMED: 'Đang giữ chỗ',
  CHECKED_IN: 'Đã đến',
  COMPLETED: 'Hoàn tất',
  CANCELLED: 'Đã hủy',
  NO_SHOW: 'Không đến',
};
function readPending(key: string) {
  try {
    const parsed = reservationCreateSchema.safeParse(
      JSON.parse(sessionStorage.getItem(key) ?? 'null'),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
function savePending(key: string, value: ReservationCreate | null) {
  try {
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
  } catch {
    /* In-memory replay remains available. */
  }
}

export function ReservationsPage({
  staff = false,
  admin = false,
  mine = false,
}: {
  staff?: boolean;
  admin?: boolean;
  mine?: boolean;
}): JSX.Element {
  useDocumentTitle('Đặt bàn');
  const memberQuery = useMember(!staff),
    user = useAuth((s) => s.user),
    member = memberQuery.data?.member;
  if (!staff && memberQuery.isPending) return <p role="status">Đang tải tài khoản…</p>;
  if (!staff && memberQuery.isError)
    return (
      <ErrorState
        message={getErrorMessage(memberQuery.error)}
        onRetry={() => memberQuery.refetch()}
      />
    );
  if (!staff && !member)
    return (
      <Card className="mx-auto max-w-xl space-y-4 p-6">
        <CalendarDays className="h-9 w-9 text-primary" />
        <h1 className="g-display text-3xl">Hẹn một chỗ quen.</h1>
        <p className="text-sm text-muted-foreground">Đăng nhập để chọn bàn và giờ đến.</p>
        <Link
          to="/reservations/member"
          className="inline-block rounded-full bg-primary px-5 py-3 font-semibold text-primary-foreground"
        >
          Đăng nhập / Đăng ký
        </Link>
      </Card>
    );
  const identity = (staff ? user?.id : member?.id) ?? '';
  return (
    <ReservationWorkspace
      key={`${staff}:${identity}:${mine}`}
      identity={identity}
      staff={staff}
      admin={admin}
      mine={mine}
      name={member?.name ?? ''}
      phone={member?.phone ?? ''}
    />
  );
}
function ReservationWorkspace({
  identity,
  staff,
  admin,
  mine,
  name,
  phone,
}: {
  identity: string;
  staff: boolean;
  admin: boolean;
  mine: boolean;
  name: string;
  phone: string;
}): JSX.Element {
  const prefix = staff ? `/${admin ? 'admin' : 'staff'}/reservations` : '/reservations',
    qc = useQueryClient();
  const [creating, setCreating] = useState(
      !mine && (!staff || !!readPending(`reservation-pending:${prefix}:${identity}`)),
    ),
    [history, setHistory] = useState(false),
    [page, setPage] = useState(1),
    [date, setDate] = useState(''),
    [selected, setSelected] = useState<Reservation | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['reservations'] });
    void qc.invalidateQueries({ queryKey: ['reservation-availability'] });
    void qc.invalidateQueries({ queryKey: ['reservation-alerts'] });
  };
  useSocketEvent('reservation.changed', refresh);
  useSocketEvent('tableSession.statusChanged', refresh);
  useSocketEvent('connect', refresh);
  const query = useQuery({
    queryKey: ['reservations', prefix, identity, page, history, date],
    queryFn: async () =>
      unwrap<{ items: Reservation[]; total: number }>(
        await api.get(prefix, { params: { page, history, ...(date ? { date } : {}) } }),
      ),
    enabled: staff || mine,
    refetchInterval: 10000,
  });
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[.2em] text-primary">
            Fantastic cafe
          </p>
          <h1 className="g-display text-3xl sm:text-4xl">
            {staff ? 'Lịch đặt bàn' : mine ? 'Lịch của tôi' : 'Một giờ thảnh thơi.'}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            60 phút mỗi lượt · Giữ chỗ đến 15 phút sau giờ hẹn
          </p>
        </div>
        {staff ? (
          <Button disabled={creating} onClick={() => setCreating(true)}>
            Đặt tại quầy
          </Button>
        ) : null}
      </div>
      {creating ? (
        <ReservationForm
          key={`${prefix}:${identity}`}
          storageKey={`reservation-pending:${prefix}:${identity}`}
          prefix={prefix}
          initialName={name}
          initialPhone={phone}
          onDone={() => {
            refresh();
            if (staff) setCreating(false);
          }}
        />
      ) : null}
      {staff || mine ? (
        <section className="space-y-4" aria-label="Danh sách lịch đặt">
          <div className="flex flex-wrap items-end gap-3">
            <Button
              variant={history ? 'outline' : 'primary'}
              onClick={() => {
                setHistory(false);
                setPage(1);
              }}
            >
              Đang xử lý
            </Button>
            <Button
              variant={history ? 'primary' : 'outline'}
              onClick={() => {
                setHistory(true);
                setPage(1);
              }}
            >
              Tất cả
            </Button>
            {staff ? (
              <label className="text-sm">
                Ngày đến
                <Input
                  type="date"
                  aria-label="Lọc ngày đến"
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setPage(1);
                  }}
                />
              </label>
            ) : null}
            <Button variant="ghost" onClick={refresh}>
              Tải lại
            </Button>
          </div>
          {query.isPending ? (
            <p role="status">Đang tải lịch đặt…</p>
          ) : query.isError ? (
            <ErrorState message={getErrorMessage(query.error)} onRetry={() => query.refetch()} />
          ) : (
            <>
              <p className="text-sm text-muted-foreground">{query.data.total} lịch đặt</p>
              {!query.data.items.length ? (
                <Card className="p-8 text-center text-muted-foreground">Chưa có lịch đặt.</Card>
              ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                  {query.data.items.map((r) => (
                    <Card key={r.id} className="space-y-4 p-5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <strong>
                          {r.tableName} · {r.partySize} khách
                        </strong>
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${r.status === 'CONFIRMED' ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}
                        >
                          {labels[r.status]}
                        </span>
                      </div>
                      <p className="text-lg font-semibold">{vnTime(r.startsAt)}</p>
                      <p className="text-sm text-muted-foreground">
                        Đến {vnTime(r.endsAt)} · {r.code}
                      </p>
                      <p className="text-sm">
                        {r.name} · {r.phone}
                      </p>
                      {r.note ? <p className="text-sm text-muted-foreground">{r.note}</p> : null}
                      {r.reason ? (
                        <p className="text-sm text-muted-foreground">{r.reason}</p>
                      ) : null}
                      {r.status === 'CHECKED_IN' ? (
                        <p className="text-sm text-muted-foreground">Quét QR tại bàn để gọi món.</p>
                      ) : null}
                      {r.status === 'CONFIRMED' ? (
                        <Button variant="outline" onClick={() => setSelected(r)}>
                          {staff ? 'Xử lý lịch đặt' : 'Hủy lịch đặt'}
                        </Button>
                      ) : null}
                      {staff && r.tableSessionId ? (
                        <Link
                          className="ml-3 text-sm underline"
                          to={admin ? '/admin/tables' : '/staff/tables'}
                        >
                          Bàn & phiên
                        </Link>
                      ) : null}
                    </Card>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-center gap-3">
                <Button variant="ghost" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                  Trước
                </Button>
                <span className="text-sm">Trang {page}</span>
                <Button
                  variant="ghost"
                  disabled={page * 30 >= query.data.total}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Sau
                </Button>
              </div>
            </>
          )}
        </section>
      ) : (
        <Link className="block text-center text-sm text-primary underline" to="/reservations/mine">
          Xem lịch của tôi
        </Link>
      )}
      {selected ? (
        <ReservationActions
          reservation={selected}
          prefix={prefix}
          staff={staff}
          onClose={() => setSelected(null)}
          onDone={() => {
            setSelected(null);
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}
function ReservationForm({
  storageKey,
  prefix,
  initialName,
  initialPhone,
  onDone,
}: {
  storageKey: string;
  prefix: string;
  initialName: string;
  initialPhone: string;
  onDone: () => void;
}): JSX.Element {
  const recovered = useRef(readPending(storageKey)),
    [when, setWhen] = useState(
      recovered.current
        ? localTime(new Date(recovered.current.startsAt))
        : localTime(new Date(Math.ceil((Date.now() + 30 * 60000) / 900000) * 900000)),
    ),
    [partySize, setPartySize] = useState(recovered.current?.partySize ?? 2),
    [name, setName] = useState(recovered.current?.name ?? initialName),
    [phone, setPhone] = useState(recovered.current?.phone ?? initialPhone),
    [note, setNote] = useState(recovered.current?.note ?? ''),
    [tableId, setTableId] = useState(recovered.current?.tableId ?? ''),
    [criteria, setCriteria] = useState<{ startsAt: string; partySize: number } | null>(null),
    [error, setError] = useState(''),
    [uncertain, setUncertain] = useState(!!recovered.current),
    [success, setSuccess] = useState<Reservation | null>(null);
  const attempt = useRef<ReservationCreate | null>(recovered.current),
    requestId = useRef(recovered.current?.requestId ?? uuid());
  const available = useQuery({
    queryKey: ['reservation-availability', prefix, criteria],
    queryFn: async () =>
      unwrap<ReservationAvailability>(
        await api.get(`${prefix}/availability`, { params: criteria }),
      ),
    enabled: !!criteria,
    refetchInterval: 15000,
  });
  const submit = useMutation({
    mutationFn: async () => {
      if (!attempt.current) {
        if (!criteria || !tableId) throw new Error('Chọn giờ và bàn còn trống.');
        const parsed = reservationCreateSchema.safeParse({
          requestId: requestId.current,
          tableId,
          startsAt: criteria.startsAt,
          partySize,
          name,
          phone,
          note,
        });
        if (!parsed.success)
          throw new Error(parsed.error.issues[0]?.message ?? 'Kiểm tra thông tin đặt bàn.');
        attempt.current = parsed.data;
        savePending(storageKey, parsed.data);
      }
      return unwrap<{ reservation: Reservation }>(await api.post(prefix, attempt.current));
    },
    onSuccess: (data) => {
      savePending(storageKey, null);
      attempt.current = null;
      requestId.current = uuid();
      setUncertain(false);
      setError('');
      setSuccess(data.reservation);
      setTableId('');
      setCriteria(null);
      onDone();
    },
    onError: (e) => {
      setError(getErrorMessage(e));
      const status = getAxiosError(e)?.response?.status;
      const pending = !!attempt.current && (!status || status >= 500);
      setUncertain(pending);
      if (!pending) {
        attempt.current = null;
        savePending(storageKey, null);
        if (criteria) void available.refetch();
      }
    },
  });
  const locked = uncertain || submit.isPending;
  const resetSearch = () => {
    setCriteria(null);
    setTableId('');
    setSuccess(null);
    setError('');
  };
  useEffect(() => {
    if (
      available.data &&
      tableId &&
      !uncertain &&
      !available.data.tables.some((t) => t.id === tableId)
    )
      setTableId('');
  }, [available.data, tableId, uncertain]);
  return (
    <Card className="overflow-hidden border-primary/20 p-5 sm:p-7">
      <div className="mb-6 flex items-center gap-3">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
          <CalendarDays className="h-6 w-6" />
        </span>
        <div>
          <h2 className="text-xl font-semibold">Chọn giờ, chọn chỗ.</h2>
          <p className="mt-1 text-xs text-muted-foreground">Giờ Việt Nam · Không cần quét QR</p>
        </div>
      </div>
      {success ? (
        <div role="status" className="mb-5 rounded-2xl border border-success/30 bg-success/10 p-4">
          <p className="font-semibold">Đã giữ chỗ · {success.code}</p>
          <p className="mt-1 text-sm">
            {success.tableName} · {vnTime(success.startsAt)} · {success.partySize} khách
          </p>
          <p className="mt-2 text-sm">Đến quầy để check-in, sau đó quét QR tại bàn.</p>
        </div>
      ) : null}
      <fieldset disabled={locked} className="min-w-0 space-y-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_140px_auto] sm:items-end">
          <label className="space-y-2 text-sm font-semibold">
            <span className="flex items-center gap-2">
              <Clock3 className="h-4 w-4" />
              Ngày & giờ đến
            </span>
            <Input
              type="datetime-local"
              aria-label="Ngày và giờ đến (giờ Việt Nam)"
              value={when}
              step={60}
              onChange={(e) => {
                setWhen(e.target.value);
                resetSearch();
              }}
            />
          </label>
          <label className="space-y-2 text-sm font-semibold">
            <span className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Số khách
            </span>
            <Input
              aria-label="Số khách"
              type="number"
              min={1}
              max={30}
              step={1}
              value={partySize}
              onChange={(e) => {
                setPartySize(Number(e.target.value));
                resetSearch();
              }}
            />
          </label>
          <Button
            className="h-12"
            disabled={
              !when ||
              !Number.isInteger(partySize) ||
              partySize < 1 ||
              partySize > 30 ||
              available.isFetching
            }
            onClick={() => {
              try {
                const startsAt = new Date(`${when}:00+07:00`).toISOString();
                if (criteria?.startsAt === startsAt && criteria.partySize === partySize)
                  void available.refetch();
                setCriteria({ startsAt, partySize });
                setTableId('');
                setError('');
                setSuccess(null);
              } catch {
                setError('Chọn ngày và giờ hợp lệ.');
              }
            }}
          >
            Tìm bàn trống
          </Button>
        </div>
        {criteria ? (
          <section aria-label="Bàn còn trống">
            {available.isFetching && !available.data ? (
              <p role="status">Đang tìm bàn…</p>
            ) : available.isError ? (
              <ErrorState
                message={getErrorMessage(available.error)}
                onRetry={() => available.refetch()}
              />
            ) : available.data ? (
              <>
                <p className="mb-3 text-sm text-muted-foreground">
                  {vnTime(available.data.startsAt)} → {vnTime(available.data.endsAt)}
                </p>
                {available.data.tables.length ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {available.data.tables.map((t) => (
                      <button
                        type="button"
                        key={t.id}
                        aria-pressed={tableId === t.id}
                        aria-label={`${t.name} · ${t.capacity} chỗ`}
                        onClick={() => {
                          setTableId(t.id);
                          setError('');
                        }}
                        className={`relative flex min-h-28 flex-col items-center justify-center gap-2 rounded-2xl border p-4 transition hover:border-primary ${tableId === t.id ? 'border-primary bg-primary/10' : 'border-foreground/15 bg-muted/20'}`}
                      >
                        <Armchair className="h-7 w-7 text-primary" />
                        <strong>{t.name}</strong>
                        <span className="text-xs text-muted-foreground">{t.capacity} chỗ</span>
                        {tableId === t.id ? (
                          <Check className="absolute right-3 top-3 h-4 w-4 text-primary" />
                        ) : null}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-2xl border border-dashed p-6 text-center text-muted-foreground">
                    Chưa có bàn phù hợp. Hãy thử giờ khác.
                  </p>
                )}
              </>
            ) : null}
          </section>
        ) : null}
        {tableId ? (
          <div className="space-y-4 border-t border-foreground/10 pt-5">
            <h3 className="font-semibold">Thông tin nhận bàn</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-2 text-sm">
                Tên người đặt
                <Input
                  aria-label="Tên người đặt"
                  value={name}
                  maxLength={80}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="space-y-2 text-sm">
                SĐT liên hệ
                <Input
                  aria-label="SĐT đặt bàn"
                  type="tel"
                  value={phone}
                  maxLength={24}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </label>
            </div>
            <label className="block space-y-2 text-sm">
              Ghi chú
              <Input
                aria-label="Ghi chú đặt bàn"
                value={note}
                maxLength={280}
                placeholder="Ví dụ: cần ghế cho bé"
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          </div>
        ) : null}
      </fieldset>
      {error ? (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {uncertain ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Chưa rõ kết quả gửi. Thử lại cùng yêu cầu để tránh đặt trùng.
        </p>
      ) : null}
      {tableId ? (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-foreground/10 pt-5">
          <p className="text-xs text-muted-foreground">60 phút/lượt · Trễ 15 phút sẽ nhả chỗ</p>
          <Button size="lg" disabled={submit.isPending} onClick={() => submit.mutate()}>
            {submit.isPending
              ? 'Đang giữ chỗ…'
              : uncertain
                ? 'Thử lại cùng yêu cầu'
                : 'Xác nhận đặt bàn'}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
function ReservationActions({
  reservation: r,
  prefix,
  staff,
  onClose,
  onDone,
}: {
  reservation: Reservation;
  prefix: string;
  staff: boolean;
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [uncertain, setUncertain] = useState(false),
    [now, setNow] = useState(Date.now());
  const attempt = useRef<{
    kind: 'cancel' | 'check-in';
    body: { expectedVersion: number; reason?: string };
  } | null>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);
  const submit = useMutation({
    mutationFn: async (kind: 'cancel' | 'check-in') => {
      attempt.current ??= {
        kind,
        body: { expectedVersion: r.version, ...(kind === 'cancel' ? { reason } : {}) },
      };
      return api.post(`${prefix}/${r.id}/${attempt.current.kind}`, attempt.current.body);
    },
    onSuccess: onDone,
    onError: (e) => {
      setError(getErrorMessage(e));
      const status = getAxiosError(e)?.response?.status;
      setUncertain(!status || status >= 500);
      if (status && status < 500) attempt.current = null;
    },
  });
  const busy = submit.isPending || uncertain,
    canCheckIn =
      now >= new Date(r.startsAt).getTime() - 15 * 60000 &&
      now < new Date(r.arrivalDeadline).getTime();
  return (
    <Modal
      open
      title={`${staff ? 'Xử lý' : 'Hủy'} ${r.code}`}
      onOpenChange={(o) => {
        if (!o && !submit.isPending) onClose();
      }}
    >
      <p>
        {r.tableName} · {r.partySize} khách
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        {vnTime(r.startsAt)} → {vnTime(r.endsAt)}
      </p>
      {staff ? (
        <p className="mt-4 text-sm">
          Check-in từ 15 phút trước giờ đặt. Bàn phải được dọn và đóng phiên cũ.
        </p>
      ) : null}
      <fieldset disabled={busy} className="mt-5 space-y-4">
        <label className="block text-sm">
          Lý do hủy
          <Input
            aria-label="Lý do hủy lịch"
            value={reason}
            maxLength={280}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-3">
          {staff ? (
            <Button disabled={!canCheckIn} onClick={() => submit.mutate('check-in')}>
              Khách đã đến — Check-in
            </Button>
          ) : null}
          <Button
            variant="outline"
            disabled={reason.trim().length < 3}
            onClick={() => submit.mutate('cancel')}
          >
            Xác nhận hủy lịch
          </Button>
        </div>
      </fieldset>
      {error ? (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {uncertain ? (
        <Button
          className="mt-4"
          disabled={submit.isPending}
          onClick={() => submit.mutate(attempt.current!.kind)}
        >
          Thử lại cùng thao tác
        </Button>
      ) : null}
    </Modal>
  );
}
