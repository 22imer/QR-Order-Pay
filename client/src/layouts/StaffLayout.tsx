import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ClipboardList,
  UtensilsCrossed,
  BellRing,
  Volume2,
  VolumeX,
  PackageCheck,
  WalletCards,
  CalendarDays,
  ShoppingBag,
  Music2,
  Printer,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../features/auth/useAuth';
import { connectStaffSocket, disconnectSocket, useSocketEvent } from '../lib/socket';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { InternalShell } from '../components/layout/InternalShell';
import { useToast } from '../components/ui/useToast';
import { api, unwrap } from '../lib/api';
import { useNewOrderAlerts } from '../features/staff/useNewOrderAlerts';
import {
  isSoundEnabled,
  notifyBrowser,
  playAlert,
  requestNotifyPermission,
  setSoundEnabled,
  useCountDelta,
  unlockAlertAudio,
} from '../features/staff/notifications';

interface OrderRow {
  _id: string;
  code: string;
  status: 'PENDING' | 'CONFIRMED' | 'PREPARING' | 'READY' | 'SERVED' | 'CANCELLED';
  tableSessionId: string;
}

interface ServiceReqRow {
  _id: string;
  type: 'CALL_STAFF' | 'REQUEST_BILL' | 'OTHER';
  status: 'OPEN' | 'RESOLVED';
  tableName: string;
}

const NAV = [
  { to: '/staff/cup-prints', label: 'In tem ảnh', icon: <Printer className="h-4 w-4" /> },
  { to: '/staff/jukebox', label: 'Jukebox', icon: <Music2 className="h-4 w-4" /> },
  {
    to: '/staff/reservations',
    label: 'Đặt bàn',
    icon: <CalendarDays className="h-4 w-4" />,
    badgeKey: 'reservations' as const,
  },
  {
    to: '/staff/pickups',
    label: 'Mang đi & đặt trước',
    icon: <ShoppingBag className="h-4 w-4" />,
    badgeKey: 'pickups' as const,
  },
  { to: '/staff/workforce', label: 'Lịch & chấm công', icon: <CalendarDays className="h-4 w-4" /> },
  {
    to: '/staff/kds',
    label: 'KDS',
    icon: <UtensilsCrossed className="h-4 w-4" />,
    badgeKey: 'pending' as const,
  },
  {
    to: '/staff/tables',
    label: 'Bàn & phiên',
    icon: <ClipboardList className="h-4 w-4" />,
    badgeKey: 'awaiting' as const,
  },
  {
    to: '/staff/service-requests',
    label: 'Yêu cầu',
    icon: <BellRing className="h-4 w-4" />,
    badgeKey: 'requests' as const,
  },
  { to: '/staff/availability', label: 'Hết món', icon: <PackageCheck className="h-4 w-4" /> },
  { to: '/staff/cash-shift', label: 'Ca thu ngân', icon: <WalletCards className="h-4 w-4" /> },
  { to: '/staff/payments', label: 'Khoản thu', icon: <WalletCards className="h-4 w-4" /> },
];

export function StaffLayout(): JSX.Element {
  const navigate = useNavigate();
  const { user, accessToken, logout } = useAuth();
  const [connected, setConnected] = useState(false);
  const [soundOn, setSoundOn] = useState<boolean>(isSoundEnabled());
  const qc = useQueryClient();
  const { toast } = useToast();

  const ordersQuery = useQuery({
    queryKey: ['staff-orders'],
    queryFn: async () => unwrap(await api.get<{ items: OrderRow[] }>('/staff/orders')),
    refetchInterval: 10_000,
  });
  const requestsQuery = useQuery({
    queryKey: ['staff-service-requests'],
    queryFn: async () =>
      unwrap(await api.get<{ items: ServiceReqRow[] }>('/staff/service-requests')),
    refetchInterval: 8_000,
  });

  const awaitingQuery = useQuery({
    queryKey: ['staff-awaiting-payments'],
    queryFn: async () =>
      unwrap(await api.get<{ items: Array<{ _id: string }> }>('/staff/awaiting-payments')),
    refetchInterval: 5_000,
  });
  const pickupsQuery = useQuery({
    queryKey: ['staff-pickup-alerts', user?.id],
    queryFn: async () =>
      unwrap(
        await api.get<{ items: Array<{ _id: string }>; total: number }>('/staff/pickups', {
          params: { history: false, page: 1 },
        }),
      ),
    refetchInterval: 5_000,
  });
  const reservationsQuery = useQuery({
    queryKey: ['reservation-alerts', user?.id],
    queryFn: async () =>
      unwrap(
        await api.get<{ items: Array<{ id: string }>; total: number }>('/staff/reservations', {
          params: { history: false, page: 1 },
        }),
      ),
    refetchInterval: 10000,
  });
  useCountDelta(reservationsQuery.data?.total, (delta) => {
    playAlert('request');
    notifyBrowser('Lịch đặt bàn mới', `${delta} lịch mới. Vào Đặt bàn để kiểm tra.`);
    toast({ title: `Lịch đặt bàn mới (${delta})`, tone: 'info' });
  });

  const pendingCount = useMemo(
    () => (ordersQuery.data?.items ?? []).filter((o) => o.status === 'PENDING').length,
    [ordersQuery.data],
  );
  const openRequestCount = useMemo(
    () => (requestsQuery.data?.items ?? []).filter((r) => r.status === 'OPEN').length,
    [requestsQuery.data],
  );

  const refresh = useCallback(() => {
    for (const key of [
      'staff-orders',
      'reservation-alerts',
      'reservations',
      'staff-pickup-alerts',
      'pickups',
      'staff-awaiting-payments',
      'staff-cancel-requests',
      'staff-table-sessions',
      'staff-bill',
      'staff-service-requests',
    ]) {
      void qc.invalidateQueries({ queryKey: [key] });
    }
  }, [qc]);

  const notifyNewOrder = useCallback(
    (pickup: boolean, delta: number) => {
      playAlert('order');
      const description = pickup
        ? 'Vào Mang đi & đặt trước để kiểm tra và thu tiền.'
        : 'Vào Bàn & phiên để kiểm tra và thu tiền.';
      notifyBrowser(
        pickup ? 'Đơn mang đi mới' : 'Đơn tại bàn mới',
        `${delta} đơn mới. ${description}`,
      );
      toast({
        title: `${pickup ? 'Đơn mang đi mới' : 'Đơn tại bàn mới'} (${delta})`,
        description,
        tone: 'info',
      });
    },
    [toast],
  );
  const notifyNewRequest = useCallback(
    (delta: number) => {
      playAlert('request');
      notifyBrowser('Yêu cầu mới', `${delta} yêu cầu mới từ bàn`);
      toast({
        title: `Yêu cầu mới (${delta})`,
        description: 'Khách gọi nhân viên / xin bill.',
        tone: 'info',
      });
    },
    [toast],
  );

  useNewOrderAlerts(user?.id, awaitingQuery.data?.items, pickupsQuery.data?.items, notifyNewOrder);
  useCountDelta(requestsQuery.data ? openRequestCount : undefined, notifyNewRequest);

  useSocketEvent('connect', () => {
    setConnected(true);
    refresh();
  });
  useSocketEvent('disconnect', () => setConnected(false));
  useSocketEvent('order.created', refresh);
  useSocketEvent('reservation.changed', refresh);
  useSocketEvent('order.statusChanged', refresh);
  useSocketEvent('tableSession.statusChanged', refresh);
  useSocketEvent('payment.confirmed', () => {
    refresh();
    playAlert('payment');
    toast({ title: 'Đã ghi nhận thanh toán', tone: 'success' });
  });
  useSocketEvent('serviceRequest.created', refresh);
  useSocketEvent('serviceRequest.resolved', refresh);

  useEffect(() => {
    if (!accessToken) return;
    const s = connectStaffSocket(accessToken);
    setConnected(s.connected);
    void requestNotifyPermission();
    return () => {
      disconnectSocket();
    };
  }, [accessToken]);

  useEffect(() => {
    window.addEventListener('pointerdown', unlockAlertAudio);
    window.addEventListener('keydown', unlockAlertAudio);
    return () => {
      window.removeEventListener('pointerdown', unlockAlertAudio);
      window.removeEventListener('keydown', unlockAlertAudio);
    };
  }, []);

  function toggleSound(): void {
    const next = !soundOn;
    setSoundOn(next);
    setSoundEnabled(next);
    if (next) playAlert('order');
  }

  function badgeFor(
    key: 'pending' | 'requests' | 'awaiting' | 'pickups' | 'reservations',
  ): number | null {
    if (key === 'reservations') return reservationsQuery.data?.total || null;
    if (key === 'pickups') return pickupsQuery.data?.total || null;
    if (key === 'awaiting') return awaitingQuery.data?.items.length || null;
    if (key === 'pending') return pendingCount > 0 ? pendingCount : null;
    return openRequestCount > 0 ? openRequestCount : null;
  }

  return (
    <InternalShell
      title="Vận hành"
      home="/staff"
      name={user?.name ?? 'Nhân viên'}
      role={user?.role ?? ''}
      nav={NAV.map((item) => ({ ...item, badge: item.badgeKey ? badgeFor(item.badgeKey) : null }))}
      status={
        <Badge tone={connected ? 'success' : 'danger'}>
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
          {connected ? 'Trực tuyến' : 'Mất kết nối'}
        </Badge>
      }
      tools={
        <Button
          variant="outline"
          size="icon"
          onClick={toggleSound}
          title={soundOn ? 'Tắt âm thanh báo' : 'Bật âm thanh báo'}
          aria-label={soundOn ? 'Tắt âm thanh báo' : 'Bật âm thanh báo'}
        >
          {soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
        </Button>
      }
      onLogout={async () => {
        await logout();
        navigate('/auth/login');
      }}
    />
  );
}
