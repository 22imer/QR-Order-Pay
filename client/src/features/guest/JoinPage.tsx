import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { QrCode } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { api, getErrorCode, getErrorMessage, unwrap } from '../../lib/api';
import { useToast } from '../../components/ui/useToast';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';
import { useQueryClient } from '@tanstack/react-query';
import { useCart } from '../../store/cart';
import { disconnectSocket } from '../../lib/socket';
import { CloudMark } from './CloudMark';
import type { JoinTableResponse } from '@may-cafe/contracts';

export function JoinPage(): JSX.Element {
  useDocumentTitle('Vào bàn');
  const navigate = useNavigate();
  const { token } = useParams<{ token?: string }>();
  const [value, setValue] = useState(token ?? '');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const autoTried = useRef(false);
  const qc = useQueryClient();

  async function join(t: string): Promise<void> {
    if (!t.trim()) {
      toast({ title: 'Vui lòng nhập mã QR', tone: 'danger' });
      return;
    }
    setLoading(true);
    try {
      let tableToken = t.trim();
      if (tableToken.includes('/t/')) tableToken = tableToken.split('/t/')[1]!.split(/[?#]/)[0]!;
      const joined = unwrap<JoinTableResponse>(
        await api.post('/table-sessions/join', { tableToken }),
      );
      disconnectSocket();
      const previousSessionId = useCart.getState().tableSessionId;
      if (previousSessionId !== null && previousSessionId !== joined.tableSessionId) {
        toast({ title: 'Phiên trước đã kết thúc — đây là phiên mới', tone: 'info' });
      }
      useCart.getState().setSession(joined.tableSessionId, joined.participantId);
      qc.removeQueries({ queryKey: ['my-orders'] });
      qc.removeQueries({ queryKey: ['receipt'] });
      qc.removeQueries({ queryKey: ['guest-session'] });
      toast({
        title: joined.created ? 'Đã mở phiên mới cho bàn' : 'Đã vào bàn',
        description: 'Bạn có thể bắt đầu chọn món.',
        tone: 'success',
      });
      navigate('/menu');
    } catch (e) {
      if (getErrorCode(e) === 'FORBIDDEN') {
        toast({
          title: 'Chưa vào được bàn',
          description: getErrorMessage(e),
          tone: 'danger',
        });
      } else {
        toast({ title: 'Không vào được bàn', description: getErrorMessage(e), tone: 'danger' });
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (token && !autoTried.current) {
      autoTried.current = true;
      void join(token);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <main className="grid min-h-dvh md:grid-cols-2">
      <section className="guest-join-intro flex flex-col px-5 pb-6 pt-8 md:bg-primary md:px-10 md:py-10 md:text-primary-foreground lg:px-16">
        <div className="flex items-center gap-3">
          <CloudMark className="h-7 w-10 text-primary md:text-primary-foreground" />
          <span className="g-title text-2xl">Fantastic cafe</span>
        </div>
        <div className="hidden flex-1 flex-col justify-center py-14 md:flex">
          <CloudMark className="mb-10 h-24 w-36 text-primary-foreground/70" />
          <p className="g-display max-w-md text-5xl lg:text-6xl">Gọi món tại bàn bằng QR</p>
          <p className="mt-6 max-w-sm text-base leading-relaxed text-primary-foreground/70">
            Mở camera và quét mã QR đang hiển thị trên màn hình tại bàn. Mã tự đổi mỗi 60 giây.
          </p>
        </div>
        <p className="hidden border-t border-primary-foreground/20 pt-6 text-sm text-primary-foreground/70 md:block">
          Thanh toán từng đơn trước khi pha chế.
        </p>
      </section>
      <section className="flex items-center justify-center px-5 pb-10 md:px-10 md:py-16">
        <div className="w-full max-w-md rounded-3xl border border-foreground/10 bg-card p-6 shadow-soft sm:p-9">
          <span className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <QrCode className="h-6 w-6" />
          </span>
          <h1 className="g-display text-[2.5rem]">Quét QR hoặc nhập mã bàn</h1>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            Mở camera và quét mã QR đang hiển thị trên màn hình tại bàn. Mã tự đổi mỗi 60 giây.
          </p>
          <form
            className="mt-8 space-y-5"
            aria-busy={loading}
            onSubmit={(event) => {
              event.preventDefault();
              void join(value);
            }}
          >
            <label className="block text-sm font-semibold">
              Mã QR
              <Input
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder="Link vào bàn"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                className="mt-2 h-12 text-base font-normal"
              />
            </label>
            <Button type="submit" size="lg" disabled={loading} className="w-full">
              <QrCode className="h-5 w-5" />
              {loading ? 'Đang vào...' : 'Vào bàn'}
            </Button>
          </form>
          <Link
            to="/pickup"
            className="mt-4 block rounded-xl border border-foreground/15 px-4 py-3 text-center text-sm font-semibold hover:bg-muted"
          >
            Đặt mang đi / đặt trước
          </Link>
          <Link to="/reservations" className="mt-3 block rounded-xl border border-foreground/15 px-4 py-3 text-center text-sm font-semibold hover:bg-muted">Đặt bàn</Link>
          <details className="mt-6 border-t border-foreground/10 pt-5 text-sm text-muted-foreground">
            <summary className="cursor-pointer rounded font-semibold text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              Mở link vào bàn
            </summary>
            <p className="mt-3 leading-relaxed">
              Trên màn hình QR tại bàn, bấm “Sao chép link”, rồi dán vào ô Mã QR. Link tự đổi cùng
              QR.
            </p>
          </details>
        </div>
      </section>
    </main>
  );
}
