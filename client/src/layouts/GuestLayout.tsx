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
  Gift,
  Dices,
  Music2,
} from 'lucide-react';
import { useCart, cartTotals } from '../store/cart';
import { api, unwrap, vnd, getErrorMessage } from '../lib/api';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { connectGuestSocket, disconnectSocket, useSocketEvent } from '../lib/socket';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/useToast';
import { cn } from '../lib/cn';
import { CloudMark } from '../features/guest/CloudMark';
import type { GuestContext } from '../features/guest/guestContext';
import type { CurrentTableSessionResponse } from '@may-cafe/contracts';
import { useGifts } from '../features/gifts/useGifts';

const dockItem =
  'relative flex min-w-0 flex-1 flex-col items-center gap-1 rounded-2xl px-1 pb-2 pt-3 text-center text-xs leading-tight transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50';

export function GuestLayout(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const showcase = location.pathname === '/menu';
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
  const giftOwner = activeSession
    ? `${activeSession.tableSessionId}:${activeSession.participantId}`
    : null;
  const gifts = useGifts(giftOwner);
  const giftCount = gifts.data?.incomingCount ?? 0;
  const previousGifts = useRef<{ owner: string | null; count: number } | null>(null);
  useEffect(() => {
    if (!gifts.data) return;
    if (previousGifts.current?.owner === giftOwner && giftCount > previousGifts.current.count)
      toast({
        title: 'Bàn bạn có quà mới',
        description: 'Mở Tặng quà để nhận hoặc từ chối.',
        tone: 'info',
      });
    previousGifts.current = { owner: giftOwner, count: giftCount };
  }, [giftCount, giftOwner, gifts.data, toast]);
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
    void qc.invalidateQueries({ queryKey: ['gifts'] });
    void qc.invalidateQueries({ queryKey: ['game'] });
    void qc.invalidateQueries({ queryKey: ['menu'] });
  });
  useSocketEvent('disconnect', () => {
    setConnected(false);
    refreshSession();
  });
  useSocketEvent('order.statusChanged', refreshOrders);
  useSocketEvent('gift.changed', () => {
    void qc.invalidateQueries({ queryKey: ['gifts'] });
  });
  useSocketEvent('order.created', refreshOrders);
  useSocketEvent('menu.availabilityChanged', () => {
    void qc.invalidateQueries({ queryKey: ['menu'] });
    void qc.invalidateQueries({ queryKey: ['menu-search'] });
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
      if (
        session.receiptAvailable &&
        !['/receipt', '/member', '/pickup', '/ai'].includes(location.pathname)
      )
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
      qc.setQueryData(['member'], { member: null });
      qc.setQueryData(['guest-session'], { active: false });
      navigate('/t');
    },
    onError: (e) =>
      toast({ title: 'Chưa rời được bàn', description: getErrorMessage(e), tone: 'danger' }),
  });

  const showCartPill = count > 0 && !!activeSession && location.pathname !== '/cart';
  const context: GuestContext = { tableName: activeSession?.table?.name ?? null };

  return (
    <div
      className={cn(
        'guest-shell flex min-h-dvh flex-col bg-background',
        showcase && 'guest-showcase',
      )}
    >
      <header className="guest-header sticky top-0 z-30 border-b border-foreground/10 bg-background/95 backdrop-blur print:hidden">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-2 px-4 py-3 sm:gap-3 lg:px-6">
          <CloudMark className="h-6 w-8 shrink-0 text-primary" />
          <div className="min-w-[9rem] flex-1 leading-tight">
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
          <nav
            aria-label="Điều hướng chính"
            className="guest-header-nav order-last hidden w-full min-w-0 basis-full items-center gap-1 overflow-x-auto border-t border-foreground/10 pt-2 lg:flex [&>*]:shrink-0 [&>*]:whitespace-nowrap"
          >
            {[
              { to: '/menu', label: 'Thực đơn' },
              { to: '/ai', label: 'AI Barista' },
              ...(activeSession
                ? [{ to: '/gifts', label: `Tặng quà${giftCount ? ` (${giftCount})` : ''}` }]
                : []),
              ...(activeSession ? [{ to: '/game', label: 'Vòng quay' }] : []),
              ...(activeSession ? [{ to: '/jukebox', label: 'Chọn nhạc' }] : []),
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
                    'shrink-0 whitespace-nowrap rounded-full px-4 py-2.5 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
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
          <NavLink
            to="/pickup"
            className="shrink-0 rounded-full px-2 py-2 text-sm font-semibold hover:bg-card"
          >
            Mang đi
          </NavLink>
          <NavLink
            to="/member"
            className="shrink-0 rounded-full px-3 py-2 text-sm font-semibold hover:bg-card"
          >
            Thành viên
          </NavLink>
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
          showcase
            ? 'w-full flex-1'
            : 'mx-auto w-full max-w-6xl flex-1 px-4 pt-5 lg:px-6 lg:pt-8 print:pb-0',
          !showcase && (showCartPill ? 'pb-56 lg:pb-32' : 'pb-36 lg:pb-12'),
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
        {giftCount > 0 && location.pathname !== '/gifts' && (
          <NavLink
            to="/gifts"
            role="status"
            className="mx-4 mb-4 block rounded-2xl border border-primary/40 bg-card p-4 font-semibold"
          >
            🎁 Bàn bạn có {giftCount} lời mời tặng quà · Mở để nhận hoặc từ chối
          </NavLink>
        )}
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
            className="guest-dock pointer-events-auto flex overflow-x-auto rounded-3xl border border-foreground/10 bg-card/95 px-1 shadow-soft backdrop-blur lg:hidden [&>*]:min-w-[4rem] [&>*]:shrink-0"
          >
            <DockLink to="/menu" label="Thực đơn" icon={<Coffee className="h-5 w-5" />} />
            <DockLink to="/ai" label="AI Barista" icon={<Sparkles className="h-5 w-5" />} />
            {activeSession && (
              <DockLink to="/game" label="Vòng quay" icon={<Dices className="h-5 w-5" />} />
            )}
            {activeSession && (
              <DockLink to="/jukebox" label="Chọn nhạc" icon={<Music2 className="h-5 w-5" />} />
            )}
            {activeSession && (
              <DockLink
                to="/gifts"
                label={`Tặng quà${giftCount ? ` (${giftCount})` : ''}`}
                icon={<Gift className="h-5 w-5" />}
              />
            )}
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
