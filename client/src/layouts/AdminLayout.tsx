import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  LayoutDashboard,
  UtensilsCrossed,
  Layers,
  Sparkles,
  Table2,
  Users,
  MessageSquareText,
  ReceiptText,
  Package,
  CalendarDays,
  Music2,
  Printer,
} from 'lucide-react';
import { useAuth } from '../features/auth/useAuth';
import { InternalShell } from '../components/layout/InternalShell';
import { PersistentJukebox } from '../features/jukebox/PersistentJukebox';
import { connectStaffSocket, disconnectSocket } from '../lib/socket';

const NAV = [
  { to: '/admin/insights', label: 'Smart Insights', icon: <Activity className="h-4 w-4" /> },
  { to: '/admin/freestyle', label: 'AI Freestyle', icon: <Sparkles className="h-4 w-4" /> },
  { to: '/admin/cup-prints', label: 'Ảnh cốc & latte art', icon: <Printer className="h-4 w-4" /> },
  { to: '/admin/jukebox', label: 'Jukebox', icon: <Music2 className="h-4 w-4" /> },
  { to: '/admin/reservations', label: 'Đặt bàn', icon: <CalendarDays className="h-4 w-4" /> },
  { to: '/admin/pickups', label: 'Mang đi & đặt trước', icon: <Package className="h-4 w-4" /> },
  {
    to: '/admin/workforce',
    label: 'Lịch ca & hiệu suất',
    icon: <CalendarDays className="h-4 w-4" />,
  },
  { to: '/admin/vouchers', label: 'Voucher', icon: <Sparkles className="h-4 w-4" /> },
  { to: '/admin/members', label: 'Thành viên', icon: <Users className="h-4 w-4" /> },
  { to: '/admin/inventory', label: 'Kho & công thức', icon: <Package className="h-4 w-4" /> },
  { to: '/admin/dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
  { to: '/admin/operations', label: 'Vận hành', icon: <Activity className="h-4 w-4" /> },
  { to: '/admin/bills', label: 'Hóa đơn', icon: <ReceiptText className="h-4 w-4" /> },
  { to: '/admin/payments', label: 'Khoản thu', icon: <ReceiptText className="h-4 w-4" /> },
  { to: '/admin/products', label: 'Món', icon: <UtensilsCrossed className="h-4 w-4" /> },
  { to: '/admin/categories', label: 'Danh mục', icon: <Layers className="h-4 w-4" /> },
  { to: '/admin/toppings', label: 'Topping', icon: <Sparkles className="h-4 w-4" /> },
  { to: '/admin/tables', label: 'Bàn & QR', icon: <Table2 className="h-4 w-4" /> },
  { to: '/admin/users', label: 'Nhân viên', icon: <Users className="h-4 w-4" /> },
  { to: '/admin/reviews', label: 'Đánh giá', icon: <MessageSquareText className="h-4 w-4" /> },
];

export function AdminLayout(): JSX.Element {
  const navigate = useNavigate();
  const { user, accessToken, logout } = useAuth();
  useEffect(() => {
    if (!accessToken) return;
    connectStaffSocket(accessToken);
    return () => disconnectSocket();
  }, [accessToken]);
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const orderedNav = [
    '/admin/insights',
    '/admin/freestyle',
    '/admin/cup-prints',
    '/admin/jukebox',
    '/admin/reservations',
    '/admin/pickups',
    '/admin/tables',
    '/admin/products',
    '/admin/categories',
    '/admin/toppings',
    '/admin/inventory',
    '/admin/vouchers',
    '/admin/members',
    '/admin/bills',
    '/admin/payments',
    '/admin/reviews',
    '/admin/users',
    '/admin/workforce',
    '/admin/dashboard',
    '/admin/operations',
  ].map((path) => NAV.find((item) => item.to === path)!);
  return (
    <InternalShell
      player={<PersistentJukebox admin />}
      title="Quản trị"
      home="/admin"
      name={user?.name ?? 'Quản trị'}
      role={user?.role ?? ''}
      nav={orderedNav}
      status={
        <time dateTime={now.toISOString()} className="text-xs text-muted-foreground tabular-nums">
          {now.toLocaleDateString('vi-VN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            timeZone: 'Asia/Ho_Chi_Minh',
          })}
          <span className="ml-2 hidden sm:inline">
            {now.toLocaleTimeString('vi-VN', {
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'Asia/Ho_Chi_Minh',
            })}
          </span>
        </time>
      }
      onLogout={async () => {
        await logout();
        navigate('/auth/login');
      }}
    />
  );
}
