import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { LogIn, QrCode, UtensilsCrossed, ReceiptText } from 'lucide-react';
import { CloudMark } from '../guest/CloudMark';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { api, getErrorMessage, unwrap } from '../../lib/api';
import { useAuth, type AuthUser } from './useAuth';
import { useToast } from '../../components/ui/useToast';
import { getPortalMode } from '../../lib/portals';

export function LoginPage(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const setSession = useAuth((s) => s.setSession);
  const { toast } = useToast();
  const portal = getPortalMode();
  const [email, setEmail] = useState(
    portal === 'admin' ? 'admin@maycafe.vn' : 'staff.a@maycafe.vn',
  );
  const [password, setPassword] = useState('MayCafe@2025');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await unwrap(
        await api.post<{ accessToken: string; user: AuthUser }>('/auth/login', { email, password }),
      );
      if (portal === 'admin' && data.user.role !== 'ADMIN') {
        try {
          await api.post('/auth/logout');
        } catch {
          // The portal still refuses the role even if the cleanup request fails.
        }
        throw new Error('Cổng này chỉ dành cho quản trị viên.');
      }
      setSession(data.accessToken, data.user);
      toast({ title: `Xin chào, ${data.user.name}`, tone: 'success' });
      const defaultTarget =
        portal === 'admin'
          ? '/admin'
          : portal === 'staff'
            ? '/staff'
            : data.user.role === 'ADMIN'
              ? '/admin'
              : '/staff';
      const target = (location.state as { from?: string } | null)?.from ?? defaultTarget;
      navigate(target, { replace: true });
    } catch (e) {
      toast({ title: 'Đăng nhập thất bại', description: getErrorMessage(e), tone: 'danger' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-dvh bg-background md:grid-cols-2">
      <section className="flex flex-col px-5 py-8 md:bg-primary md:px-10 md:py-10 md:text-primary-foreground lg:px-16">
        <div className="flex items-center gap-3">
          <CloudMark className="h-7 w-10 text-primary md:text-primary-foreground" />
          <span className="font-display text-2xl font-semibold">Fantastic cafe</span>
        </div>
        <div className="hidden flex-1 flex-col justify-center py-16 md:flex">
          <p className="font-display text-5xl font-semibold leading-tight lg:text-6xl">
            {portal === 'admin' ? 'Quản trị' : 'Vận hành'}
          </p>
          <p className="mt-5 max-w-sm leading-relaxed text-primary-foreground/70">
            Dành cho nhân viên và quản trị viên.
          </p>
          <div className="mt-10 space-y-4 border-t border-primary-foreground/20 pt-8 text-sm">
            <p className="flex items-center gap-3">
              <QrCode className="h-5 w-5 text-primary-foreground/60" />
              {portal === 'admin' ? 'Bàn & QR' : 'Bàn & phiên'}
            </p>
            <p className="flex items-center gap-3">
              <UtensilsCrossed className="h-5 w-5 text-primary-foreground/60" />
              {portal === 'admin' ? 'Món' : 'KDS'}
            </p>
            <p className="flex items-center gap-3">
              <ReceiptText className="h-5 w-5 text-primary-foreground/60" />
              {portal === 'admin' ? 'Hóa đơn' : 'Ca thu ngân'}
            </p>
          </div>
        </div>
      </section>
      <section className="flex items-center justify-center px-5 pb-10 md:px-10 md:py-16">
        <Card className="w-full max-w-md p-6 sm:p-9">
          <span className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <LogIn className="h-6 w-6" />
          </span>
          <h1 className="font-display text-3xl font-semibold">Đăng nhập nội bộ</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Dành cho nhân viên và quản trị viên.
          </p>
          <form className="mt-8 space-y-5" onSubmit={submit}>
            <label className="block text-sm font-semibold">
              Email
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoComplete="username"
                className="mt-2 h-12 font-normal"
              />
            </label>
            <label className="block text-sm font-semibold">
              Mật khẩu
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                autoComplete="current-password"
                className="mt-2 h-12 font-normal"
              />
            </label>
            <Button type="submit" size="lg" className="w-full" disabled={loading}>
              <LogIn className="h-4 w-4" />
              {loading ? 'Đang đăng nhập...' : 'Đăng nhập'}
            </Button>
          </form>
          <p className="mt-6 border-t border-foreground/10 pt-5 text-xs leading-relaxed text-muted-foreground">
            Demo: admin@maycafe.vn / MayCafe@2025 (ADMIN) hoặc staff.a@maycafe.vn / MayCafe@2025
            (STAFF).
          </p>
        </Card>
      </section>
    </main>
  );
}
