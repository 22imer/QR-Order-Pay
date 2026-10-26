import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  FREESTYLE_OPTIONS,
  type MemberDto,
  type CurrentTableSessionResponse,
  type FreestyleResult,
  type FreestyleCatalog,
  type FreestyleRecommendation,
  type FreestyleView,
} from '@may-cafe/contracts';
import type { CartItem } from '../../store/cart';
import { useCart } from '../../store/cart';
import { api, unwrap, vnd, getErrorMessage } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { FreestyleRecipe } from '../../components/FreestyleRecipe';
import { useMember } from '../guest/useMember';
export function FreestylePanel({
  context,
  onAdd,
  onAdded,
}: {
  context: 'TABLE' | 'PICKUP';
  onAdd?: (item: Omit<CartItem, 'clientId'>) => void;
  onAdded?: () => void;
}): JSX.Element {
  const session = useQuery({
    queryKey: ['guest-session'],
    enabled: context === 'TABLE',
    queryFn: async () =>
      unwrap<CurrentTableSessionResponse>(await api.get('/table-sessions/current')),
  });
  const member = useMember(context === 'PICKUP');
  if ((context === 'TABLE' && session.isPending) || (context === 'PICKUP' && member.isPending))
    return <p role="status">Đang kiểm tra phiên…</p>;
  const owner =
    context === 'TABLE'
      ? session.data?.active && session.data.status === 'OPEN'
        ? `${session.data.tableSessionId}:${session.data.participantId}`
        : null
      : (member.data?.member?.id ?? null);
  if (!owner)
    return (
      <p>
        {context === 'TABLE'
          ? 'Quét QR vào bàn đang mở để dùng Freestyle.'
          : 'Đăng nhập thành viên để dùng Freestyle mang đi.'}{' '}
        <Link className="underline" to={context === 'TABLE' ? '/t' : '/pickup/member'}>
          Tiếp tục
        </Link>
      </p>
    );
  return (
    <Room
      key={`${context}:${owner}`}
      context={context}
      owner={owner}
      onAdd={onAdd}
      onAdded={onAdded}
    />
  );
}
function Room({
  context,
  owner,
  onAdd,
  onAdded,
}: {
  context: 'TABLE' | 'PICKUP';
  owner: string;
  onAdd?: (item: Omit<CartItem, 'clientId'>) => void;
  onAdded?: () => void;
}): JSX.Element {
  const qc = useQueryClient(),
    alive = useRef(true),
    flight = useRef(false);
  const [prompt, setPrompt] = useState('Mình muốn một món trái cây ít ngọt.'),
    [budget, setBudget] = useState(''),
    [noCaffeine, setNoCaffeine] = useState(false),
    [noDairy, setNoDairy] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [result, setResult] = useState<FreestyleResult | null>(null),
    [now, setNow] = useState(Date.now);
  const catalog = useQuery({
    queryKey: ['freestyle-catalog', context],
    queryFn: async () => unwrap<FreestyleCatalog>(await api.get('/ai/freestyle')),
  });
  useEffect(() => {
    alive.current = true;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
    };
  }, []);
  async function ask() {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const response = unwrap<FreestyleResult>(
        await api.post('/ai/freestyle', {
          context,
          prompt,
          ...(budget ? { maxBudget: Number(budget) } : {}),
          preferences: { noCaffeine, noDairy },
        }),
      );
      if (alive.current) setResult(response);
    } catch (err) {
      if (alive.current) setError(getErrorMessage(err));
    } finally {
      flight.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function add(rec: FreestyleRecommendation) {
    if (flight.current || Date.parse(rec.expiresAt) <= Date.now()) return;
    flight.current = true;
    setBusy(true);
    setError('');
    try {
      const checked = unwrap<{ unitPrice: number; sizeName: string; freestyle: FreestyleView }>(
        await api.post('/ai/freestyle/validate', {
          context,
          productId: rec.productId,
          token: rec.token,
        }),
      );
      if (!alive.current) return;
      if (context === 'TABLE') {
        const s = qc.getQueryData<CurrentTableSessionResponse>(['guest-session']);
        if (!s?.active || `${s.tableSessionId}:${s.participantId}` !== owner || s.status !== 'OPEN')
          throw new Error('Phiên bàn vừa đổi. Mở Freestyle lại.');
      } else if (qc.getQueryData<{ member: MemberDto | null }>(['member'])?.member?.id !== owner)
        throw new Error('Tài khoản vừa đổi. Mở Freestyle lại.');
      const item: Omit<CartItem, 'clientId'> = {
        productId: rec.productId,
        freestyleToken: rec.token,
        freestyle: checked.freestyle,
        name: checked.freestyle.name,
        variantId: null,
        sizeName: checked.sizeName,
        variantName: checked.sizeName,
        sugarLevel: FREESTYLE_OPTIONS,
        iceLevel: FREESTYLE_OPTIONS,
        toppingIds: [],
        note: '',
        quantity: 1,
        unitPrice: checked.unitPrice,
        image: '/favicon.svg',
      };
      if (onAdd) onAdd(item);
      else {
        if (`${useCart.getState().tableSessionId}:${useCart.getState().participantId}` !== owner)
          throw new Error('Phiên bàn vừa đổi. Vui lòng tải lại.');
        useCart.getState().add(item);
      }
      onAdded?.();
      setResult(null);
    } catch (err) {
      if (alive.current) setError(getErrorMessage(err));
    } finally {
      flight.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <div className="space-y-4" aria-label="AI Freestyle">
      <h2 className="font-display text-xl font-semibold">Pha một món riêng</h2>
      {catalog.isPending && <p role="status">Đang tải Freestyle…</p>}
      {catalog.isError && <p role="alert">{getErrorMessage(catalog.error)}</p>}
      {catalog.data && !catalog.data.enabled && <p>Quán chưa mở Freestyle.</p>}
      {catalog.data?.enabled && (
        <>
          <p className="text-sm">
            Giá cố định {vnd(catalog.data.price)} / {catalog.data.sizeName} · {catalog.data.sizeMl}{' '}
            ml. Đường, đá và thành phần theo công thức đã duyệt; không thêm topping ngoài đề xuất.
          </p>
          <fieldset disabled={busy} className="space-y-3">
            <label className="block text-sm">
              Bạn thích vị gì?
              <textarea
                aria-label="Khẩu vị Freestyle"
                className="mt-1 block w-full rounded-xl border bg-background p-3"
                value={prompt}
                maxLength={500}
                onChange={(e) => {
                  setPrompt(e.target.value);
                  setResult(null);
                }}
              />
            </label>
            <label className="block text-sm">
              Ngân sách / cốc
              <input
                aria-label="Ngân sách Freestyle"
                type="number"
                min="1"
                className="ml-2 w-32 rounded-lg border bg-background p-2"
                value={budget}
                onChange={(e) => {
                  setBudget(e.target.value);
                  setResult(null);
                }}
              />
            </label>
            <div className="flex flex-wrap gap-4">
              <label>
                <input
                  type="checkbox"
                  checked={noCaffeine}
                  onChange={(e) => {
                    setNoCaffeine(e.target.checked);
                    setResult(null);
                  }}
                />{' '}
                Không caffeine
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={noDairy}
                  onChange={(e) => {
                    setNoDairy(e.target.checked);
                    setResult(null);
                  }}
                />{' '}
                Không sữa
              </label>
            </div>
            <Button disabled={busy || !prompt.trim()} onClick={() => void ask()}>
              {busy ? 'Đang kiểm tra…' : 'Gợi ý công thức'}
            </Button>
          </fieldset>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {result && (
        <div className="space-y-3">
          <p role="status">{result.message}</p>
          {result.recommendations.map((r) => (
            <Card key={r.productId} className="space-y-2 p-4">
              <h3 className="font-semibold">{r.name}</h3>
              <p>
                {vnd(r.unitPrice)} · {r.reason}
              </p>
              <p className="text-sm text-muted-foreground">
                {r.components.map((c) => c.name).join(', ')}
              </p>
              <FreestyleRecipe value={r} />
              <Button disabled={busy || now >= Date.parse(r.expiresAt)} onClick={() => void add(r)}>
                {now >= Date.parse(r.expiresAt)
                  ? 'Đã hết hạn · tạo lại gợi ý'
                  : 'Thêm công thức vào giỏ'}
              </Button>
            </Card>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Kiểm tra lại tồn khi thêm/đặt món. Thông tin caffeine/sữa do quán xác nhận; dị ứng cần hỏi
        nhân viên.
      </p>
    </div>
  );
}
