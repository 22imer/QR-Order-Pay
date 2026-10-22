import { Link, NavLink, Outlet } from 'react-router-dom';
import { CalendarDays, ListChecks, UserRound, QrCode } from 'lucide-react';
import { CloudMark } from '../features/guest/CloudMark';
import { cn } from '../lib/cn';

export function ReservationLayout(): JSX.Element {
  return (
    <div className="guest-shell min-h-dvh bg-background">
      <header className="sticky top-0 z-30 border-b border-foreground/10 bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 lg:px-6">
          <Link to="/reservations" className="flex items-center gap-3">
            <CloudMark className="h-6 w-8 text-primary" />
            <span>
              <span className="g-title block text-lg">Fantastic cafe</span>
              <span className="block text-xs text-muted-foreground">Hẹn một chỗ quen</span>
            </span>
          </Link>
          <Link
            to="/t"
            className="flex items-center gap-2 rounded-full px-3 py-2 text-sm hover:bg-card"
          >
            <QrCode className="h-4 w-4" /> Tại quán
          </Link>
        </div>
        <nav
          aria-label="Điều hướng đặt bàn"
          className="mx-auto flex max-w-6xl gap-2 overflow-x-auto px-4 pb-3 lg:px-6"
        >
          {[
            { to: '/reservations', label: 'Đặt bàn', icon: CalendarDays },
            { to: '/reservations/mine', label: 'Lịch của tôi', icon: ListChecks },
            { to: '/reservations/member', label: 'Thành viên', icon: UserRound },
          ].map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/reservations'}
              className={({ isActive }) =>
                cn(
                  'flex shrink-0 items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-card',
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
          <Link
            to="/pickup"
            className="shrink-0 rounded-full px-4 py-2.5 text-sm text-muted-foreground hover:bg-card"
          >
            Mang đi
          </Link>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-6 lg:px-6 lg:py-8">
        <Outlet />
      </main>
    </div>
  );
}
