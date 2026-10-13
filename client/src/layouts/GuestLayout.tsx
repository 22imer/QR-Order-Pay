import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  Coffee,
  ShoppingBag,
  ListChecks,
  Sparkles,
  LogOut,
  BellRing,
  ReceiptText,
  QrCode,
} from 'lucide-react';
import { useCart, cartTotals } from '../store/cart';
import { api, unwrap, vnd, getErrorMessage } from '../lib/api';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { connectGuestSocket, disconnectSocket, useSocketEvent } from '../lib/socket';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/useToast';
import { cn } from '../lib/cn';
import { CloudMark } from '../features/guest/CloudMark';
import type { GuestContext } from '../features/guest/guestContext';
import type { CurrentTableSessionResponse } from '@may-cafe/contracts';

const dockItem =
  'relative flex flex-1 flex-col items-center gap-1 rounded-2xl px-1 pb-2 pt-3 text-center text-xs leading-tight transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50';

export function GuestLayout(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const items = useCart((s) => s.items);
  const setSession = useCart((s) => s.setSession);
  const resetSession = useCart((s) => s.resetSession);
  const { count, subtotal } = cartTotals(items);
  const [connected, setConnected] = useState(false);
  const sessionQuery = useQuery({
    queryKey: ['guest-session'],
    queryFn: async () =>
      unwrap(await api.get<CurrentTableSessionResponse>('/table-sessions/current')),
    refetchInterval: 10_000,
  });
  const session = sessionQuery.data;
  const activeSession = session?.active ? session : undefined;
  const activeParticipantId = activeSession?.participantId;
  const receiptAvailable = session?.active === false && session.receiptAvailable;
  const refreshSession = () => {
    void qc.invalidateQueries({ queryKey: ['guest-session'] });
  };
  const refreshOrders = () => {
    void qc.invalidateQueries({ queryKey: ['my-orders'] });
  };
  useSocketEvent('connect', () => {
    setConnected(true);
    refreshSession();
    refreshOrders();
    void qc.invalidateQueries({ queryKey: ['menu'] });
  });
  useSocketEvent('disconnect', () => {
    setConnected(false);
    refreshSession();
  });
  useSocketEvent('order.statusChanged', refreshOrders);
  useSocketEvent('order.created', refreshOrders);
  useSocketEvent('menu.availabilityChanged', () => {
    void qc.invalidateQueries({ queryKey: ['menu'] });
  });
  useSocketEvent('tableSession.statusChanged', refreshSession);
  useSocketEvent('payment.confirmed', () => {
    refreshOrders();
    refreshSession();
    void qc.invalidateQueries({ queryKey: ['receipt'] });
    navigate('/receipt');
  });
  useSocketEvent('serviceRequest.resolved', () =>
    toast({ title: 'Nhân viên đã xử lý yêu cầu của bạn', tone: 'success' }),
  );

  useEffect(() => {
    if (session?.active && session.tableSessionId && session.participantId)
      setSession(session.tableSessionId, session.participantId);
    else if (session && !session.active) {
      resetSession();
      if (session.receiptAvailable && location.pathname !== '/receipt')
        navigate('/receipt', { replace: true });
    }
  }, [session, setSession, resetSession, navigate, location.pathname]);

  useEffect(() => {
    if (!activeParticipantId) return;
    const socket = connectGuestSocket(activeParticipantId);
    setConnected(socket.connected);
    return () => {
      disconnectSocket();
      setConnected(false);
    };
  }, [activeParticipantId]);

  const callStaff = useMutation({
    mutationFn: () => api.post('/service-requests', { type: 'CALL_STAFF' }),
    onSuccess: () =>
      toast({
        title: 'Đã gọi nhân viên',
        description: 'Nhân viên sẽ đến hỗ trợ bạn.',
        tone: 'success',
      }),
    onError: (e) =>
      toast({ title: 'Chưa gửi được yêu cầu', description: getErrorMessage(e), tone: 'danger' }),
  });
  const leave = useMutation({
    mutationFn: () => api.post('/table-sessions/leave'),
    onSuccess: () => {
      disconnectSocket();
      resetSession();
      qc.removeQueries({ queryKey: ['my-orders'] });
      qc.removeQueries({ queryKey: ['receipt'] });
      qc.setQueryData(['guest-session'], { active: false });
      navigate('/t');
    },
    onError: (e) =>
      toast({ title: 'Chưa rời được bàn', description: getErrorMessage(e), tone: 'danger' }),
  });

  const showCartPill = count > 0 && !!activeSession && location.pathname !== '/cart';
  const context: GuestContext = { tableName: activeSession?.table?.name ?? null };

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-30 border-b border-foreground/10 bg-background/95 backdrop-blur print:hidden">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 lg:h-20 lg:gap-6 lg:px-6">
          <CloudMark className="h-6 w-8 shrink-0 text-primary" />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="g-title text-lg lg:text-xl">Fantastic cafe</p>
            <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
              {activeSession ? (
                <>
                  <span
                    aria-hidden="true"
                    className={cn(
                      'h-2 w-2 shrink-0 rounded-full',
                      connected ? 'bg-success' : 'bg-foreground/25',
                    )}
                  />
                  <span className="sr-only">{connected ? 'Đã kết nối' : 'Đang kết nối lại'}</span>
                  <span className="font-semibold text-foreground">
                    {activeSession.table?.name ?? 'Đang vào bàn'}
                  </span>
                  {activeSession.status === 'CHECKOUT' ? (
                    <span className="rounded-full bg-accent/30 px-2 py-0.5 font-medium text-foreground">
                      Đang thanh toán
                    </span>
                  ) : null}
                </>
              ) : receiptAvailable ? (
                'Đã kết thúc phiên'
              ) : (
                'Chưa vào bàn'
              )}
            </p>
          </div>
          <nav aria-label="Điều hướng chính" className="hidden items-center gap-1 lg:flex">
            {[
              { to: '/menu', label: 'Thực đơn' },
              { to: '/ai', label: 'AI Barista' },
              {
                to: receiptAvailable ? '/receipt' : '/orders',
                label: receiptAvailable ? 'Hóa đơn' : 'Đơn của tôi',
              },
            ].map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'rounded-full px-4 py-2.5 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-card hover:text-foreground',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
            {activeSession ? (
              <Button
                variant="ghost"
                onClick={() => callStaff.mutate()}
                disabled={callStaff.isPending}
              >
                <BellRing className="h-4 w-4" /> Gọi nhân viên
              </Button>
            ) : null}
          </nav>
          {activeSession || receiptAvailable ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => leave.mutate()}
              disabled={leave.isPending}
            >
              <LogOut className="h-4 w-4" /> Rời bàn
            </Button>
          ) : null}
        </div>
      </header>

      <main
        className={cn(
          'mx-auto w-full max-w-6xl flex-1 px-4 pt-5 lg:px-6 lg:pt-8 print:pb-0',
          showCartPill ? 'pb-56 lg:pb-32' : 'pb-36 lg:pb-12',
        )}
      >
        {receiptAvailable ? (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-l-4 border-accent bg-card py-3 pl-4 pr-3 text-sm print:hidden">
            <p>Phiên trước đã thanh toán. Quét QR tại bàn để mở phiên mới.</p>
            <Button size="sm" onClick={() => navigate('/t')}>
              <QrCode className="h-4 w-4" /> Quét lại QR
            </Button>
          </div>
        ) : null}
        <Outlet context={context} />
      </main>

      <div className="safe-bottom pointer-events-none fixed inset-x-0 bottom-0 z-30 print:hidden">
        <div className="mx-auto max-w-md space-y-2 px-3 pb-3 lg:mr-6 lg:max-w-sm lg:pb-6">
          {showCartPill ? (
            <button
              type="button"
              onClick={() => navigate('/cart')}
              disabled={activeSession?.status !== 'OPEN'}
              className="pill-in pointer-events-auto flex h-14 w-full items-center gap-3 rounded-full bg-primary pl-2 pr-5 text-primary-foreground shadow-soft transition hover:bg-primary/95 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 disabled:opacity-60"
            >
              <span className="relative grid h-10 w-10 place-items-center rounded-full bg-primary-foreground/15">
                <ShoppingBag className="h-5 w-5" />
                <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-xs font-bold text-accent-foreground tabular-nums">
                  {count}
                </span>
              </span>
              <span className="flex-1 text-left leading-tight">
                <span className="block text-xs opacity-80">
                  {activeSession?.status === 'OPEN'
                    ? `${count} món trong giỏ`
                    : 'Bàn đang thanh toán'}
                </span>
                <span className="block font-semibold tabular-nums">{vnd(subtotal)}</span>
              </span>
              <span className="font-semibold">Xem giỏ</span>
            </button>
          ) : null}
          <nav
            aria-label="Điều hướng chính"
            className="pointer-events-auto flex rounded-3xl border border-foreground/10 bg-card/95 px-1 shadow-soft backdrop-blur lg:hidden"
          >
            <DockLink to="/menu" label="Thực đơn" icon={<Coffee className="h-5 w-5" />} />
            <DockLink to="/ai" label="AI Barista" icon={<Sparkles className="h-5 w-5" />} />
            <DockLink
              to={receiptAvailable ? '/receipt' : '/orders'}
              label={receiptAvailable ? 'Hóa đơn' : 'Đơn của tôi'}
              icon={
                receiptAvailable ? (
                  <ReceiptText className="h-5 w-5" />
                ) : (
                  <ListChecks className="h-5 w-5" />
                )
              }
            />
            {activeSession ? (
              <button
                type="button"
                className={cn(dockItem, 'text-muted-foreground hover:text-foreground')}
                onClick={() => callStaff.mutate()}
                disabled={callStaff.isPending}
              >
                <BellRing className="h-5 w-5" />
                Gọi nhân viên
              </button>
            ) : (
              <button
                type="button"
                className={cn(dockItem, 'text-muted-foreground hover:text-foreground')}
                onClick={() => navigate('/t')}
              >
                <QrCode className="h-5 w-5" />
                Vào bàn
              </button>
            )}
          </nav>
        </div>
      </div>
    </div>
  );
}

function DockLink({
  to,
  label,
  icon,
}: {
  to: string;
  label: string;
  icon: ReactNode;
}): JSX.Element {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          dockItem,
          isActive ? 'font-semibold text-primary' : 'text-muted-foreground hover:text-foreground',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive ? (
            <span
              aria-hidden="true"
              className="absolute left-1/2 top-0 h-1 w-8 -translate-x-1/2 rounded-b-full bg-accent"
            />
          ) : null}
          {icon}
          {label}
        </>
      )}
    </NavLink>
  );
}
