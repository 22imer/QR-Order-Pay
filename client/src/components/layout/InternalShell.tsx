import { Suspense, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { ChevronDown, LogOut, Menu } from 'lucide-react';
import { CloudMark } from '../../features/guest/CloudMark';
import { cn } from '../../lib/cn';
import { Button } from '../ui/Button';

export interface InternalNavItem {
  to: string;
  label: string;
  icon: ReactNode;
  badge?: number | null;
}

export function InternalShell({
  title,
  home,
  nav,
  name,
  role,
  status,
  tools,
  player,
  onLogout,
}: {
  title: string;
  home: string;
  nav: InternalNavItem[];
  name: string;
  role: string;
  status?: ReactNode;
  tools?: ReactNode;
  player?: ReactNode;
  onLogout: () => void | Promise<void>;
}): JSX.Element {
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => setMenuOpen(false), [pathname]);
  const accountPath = `${home}/account`;
  const current = nav.find((item) => pathname === item.to);
  const navigation = (mobile = false) => (
    <nav
      id={mobile ? menuId : undefined}
      aria-label={mobile ? 'Tất cả chức năng' : 'Điều hướng chính'}
      onKeyDown={
        mobile
          ? (event) => {
              if (event.key === 'Escape') {
                setMenuOpen(false);
                menuButton.current?.focus();
              }
            }
          : undefined
      }
      className={
        mobile
          ? 'grid max-h-[min(60dvh,calc(100dvh-10rem))] grid-cols-1 gap-2 overflow-y-auto px-4 pb-4 min-[380px]:grid-cols-2 sm:grid-cols-3 lg:hidden'
          : 'flex flex-col gap-1.5'
      }
    >
      {nav.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={
            mobile
              ? () => {
                  setMenuOpen(false);
                  menuButton.current?.focus();
                }
              : undefined
          }
          className={({ isActive }) =>
            cn(
              'flex min-w-0 items-center gap-3 rounded-xl text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              mobile ? 'min-h-11 px-3 py-2.5' : 'min-h-11 px-3 py-3',
              isActive
                ? mobile
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-primary-foreground text-primary shadow-soft'
                : mobile
                  ? 'text-muted-foreground hover:bg-muted'
                  : 'text-primary-foreground/75 hover:bg-primary-foreground/10 hover:text-primary-foreground',
            )
          }
        >
          <span className="shrink-0 [&>svg]:h-[18px] [&>svg]:w-[18px]">{item.icon}</span>
          <span className="min-w-0 flex-1 break-words leading-snug">{item.label}</span>
          {item.badge != null && item.badge > 0 ? (
            <span
              aria-label={`${item.badge} chờ xử lý`}
              className="grid h-6 min-w-6 shrink-0 place-items-center rounded-full bg-accent px-1.5 text-xs font-bold text-accent-foreground tabular-nums"
            >
              {item.badge}
            </span>
          ) : null}
        </NavLink>
      ))}
    </nav>
  );
  return (
    <div className="min-h-dvh bg-background lg:pl-[232px] print:pl-0">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[232px] flex-col bg-primary px-4 py-6 text-primary-foreground lg:flex print:hidden">
        <Link
          to={home}
          className="mb-10 flex items-center gap-3 rounded-xl px-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-primary-foreground/15 bg-primary-foreground/10">
            <CloudMark className="h-6 w-8" />
          </span>
          <span className="min-w-0">
            <span className="block font-display text-lg font-semibold leading-snug">
              Fantastic cafe
            </span>
            <span className="mt-1 block text-xs text-primary-foreground/65">{title}</span>
          </span>
        </Link>
        <div className="min-h-0 flex-1 overflow-y-auto">{navigation()}</div>
        <div className="mt-6 border-t border-primary-foreground/15 pt-5">
          <Link
            to={accountPath}
            aria-label={`Tài khoản của ${name}`}
            className="mb-4 flex min-w-0 items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-primary-foreground/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-foreground/10 font-display text-lg">
              {name.charAt(0)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{name}</p>
              <p className="mt-0.5 text-[11px] text-primary-foreground/60">{role}</p>
            </div>
          </Link>
          <button
            onClick={() => void onLogout()}
            className="flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-sm text-primary-foreground/75 transition hover:bg-primary-foreground/10 hover:text-primary-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <LogOut className="h-4 w-4" /> Đăng xuất
          </button>
        </div>
      </aside>
      <header className="sticky top-0 z-30 border-b border-foreground/10 bg-background/95 backdrop-blur print:hidden">
        <div className="mx-auto flex min-h-[76px] max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-2.5 lg:hidden">
            <Link to={home} aria-label="Trang chủ">
              <CloudMark className="h-6 w-8 shrink-0 text-primary" />
            </Link>
            <div className="min-w-0">
              <Link to={home} className="block truncate font-display text-lg font-semibold">
                Fantastic cafe
              </Link>
              <Link
                to={accountPath}
                aria-label={`Tài khoản của ${name}`}
                className="block truncate rounded text-xs text-muted-foreground hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {name}
              </Link>
            </div>
          </div>
          <div className="hidden items-center gap-2 text-sm lg:flex">
            <span className="text-muted-foreground">{title}</span>
            <span aria-hidden="true" className="text-foreground/25">
              /
            </span>
            <span className="font-semibold">
              {current?.label ?? (pathname === accountPath ? 'Tài khoản của tôi' : title)}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {status}
            {tools}
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-label="Đăng xuất"
              onClick={() => void onLogout()}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="px-4 pb-3 lg:hidden">
          <Button
            ref={menuButton}
            variant="outline"
            className="h-auto min-h-11 w-full justify-start rounded-xl px-3 py-2.5"
            aria-label="Chọn chức năng"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            onClick={() => setMenuOpen((open) => !open)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setMenuOpen(false);
            }}
          >
            <Menu className="h-4 w-4 shrink-0" />
            <span className="shrink-0">Tất cả chức năng</span>
            <span className="min-w-0 flex-1 truncate text-right text-xs font-normal text-muted-foreground">
              {current?.label ?? (pathname === accountPath ? 'Tài khoản của tôi' : title)}
            </span>
            <ChevronDown
              aria-hidden="true"
              className={cn('h-4 w-4 shrink-0 transition-transform', menuOpen && 'rotate-180')}
            />
          </Button>
        </div>
        {menuOpen ? navigation(true) : null}
      </header>
      <main className="internal-main mx-auto min-w-0 max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        {player}
        <Suspense fallback={<p role="status">Đang tải trang…</p>}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
