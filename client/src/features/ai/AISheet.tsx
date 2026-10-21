import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useGuestContext } from '../guest/guestContext';
import type { CartItem } from '../../store/cart';
import { useQuery } from '@tanstack/react-query';
import { Sparkles, Send, ArrowUpRight, LoaderCircle } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Input } from '../../components/ui/Input';
import { ToggleCheck } from '../guest/ToggleCheck';
import { api, getErrorMessage, unwrap, vnd } from '../../lib/api';
import { useToast } from '../../components/ui/useToast';
import { EmptyState, ErrorState } from '../../components/ui/EmptyState';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';
import { Skeleton } from '../../components/ui/Skeleton';
import { MenuPhoto } from '../guest/MenuPhoto';
import type { ReactNode } from 'react';
import {
  ProductDetailModal,
  type Product as MenuProduct,
  type Topping,
} from '../guest/ProductDetailModal';

interface Recommendation {
  productId: string;
  variantId: string | null;
  reason: string;
  unitPrice: number;
  name: string;
  image: string;
  evidence: {
    variant: string | null;
    price: number;
    withinBudget: boolean;
    caffeine: boolean | null;
    dairy: boolean | null;
  };
}

interface AIRecommendResponse {
  mode: 'llm' | 'fallback';
  message: string;
  recommendations: Recommendation[];
  followUpQuestion?: string;
  latencyMs?: number;
}

interface MenuResponse {
  categories: Array<{ _id: string; name: string }>;
  products: MenuProduct[];
  toppings: Array<{ _id: string; name: string; price: number }>;
}

const PRESETS = [
  {
    label: 'Chua nhẹ',
    prompt: 'Mình thích vị chua nhẹ, không uống cà phê, muốn ít ngọt, dưới 50 nghìn.',
  },
  { label: 'Ít ngọt', prompt: 'Gợi ý món ít ngọt cho người mới uống.' },
  { label: 'Không sữa', prompt: 'Đồ uống không có sữa, có vị trái cây.' },
  { label: 'Signature', prompt: 'Món signature nổi bật nhất hôm nay?' },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: MenuProduct[];
  toppings?: Topping[];
  children?: ReactNode;
  onAdd?: (item: Omit<CartItem, 'clientId'>) => void;
}

export function AISheet({
  open,
  onOpenChange,
  products,
  toppings = [],
  onAdd,
}: Props): JSX.Element {
  useDocumentTitle('AI Barista');
  const guest = useGuestContext();
  const needsTable = !onAdd && !guest?.tableName;
  const [prompt, setPrompt] = useState(PRESETS[0]?.prompt ?? '');
  const [busy, setBusy] = useState(false);
  const [response, setResponse] = useState<AIRecommendResponse | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!response) return;
    resultsRef.current?.scrollIntoView({
      block: 'start',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }, [response]);
  const { toast } = useToast();
  const [selected, setSelected] = useState<MenuProduct | null>(null);
  const [selectedConstraints, setSelectedConstraints] = useState<{
    noCaffeine?: boolean;
    noDairy?: boolean;
    maxBudget?: number;
  }>();
  const [budget, setBudget] = useState('');
  const [noCaffeine, setNoCaffeine] = useState(false);
  const [noDairy, setNoDairy] = useState(false);

  async function ask(): Promise<void> {
    setBusy(true);
    try {
      const data = await unwrap<AIRecommendResponse>(
        await api.post('/ai/recommendations', {
          prompt,
          ...(budget ? { maxBudget: Number(budget) } : {}),
          preferences: { noCaffeine, noDairy },
        }),
      );
      setResponse(data);
    } catch (e) {
      toast({ title: 'AI chưa phản hồi', description: getErrorMessage(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  function addRec(rec: Recommendation): void {
    const product = products.find((p) => p._id === rec.productId);
    if (!product) return;
    setSelected(product);
    setSelectedConstraints({
      noCaffeine,
      noDairy,
      ...(budget ? { maxBudget: Number(budget) } : {}),
    });
    onOpenChange(false);
  }

  return (
    <>
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        title="AI Barista"
        titleIcon={<Sparkles className="h-5 w-5" />}
        className="g-sheet ai-sheet"
      >
        <div className="space-y-4">
          {needsTable ? (
            <p className="text-sm text-muted-foreground">
              <Link to="/t" className="underline">
                Quét QR để dùng tại bàn
              </Link>
            </p>
          ) : null}
          <div className="ai-preferences">
            <label className="block text-xs font-semibold">
              Ngân sách / món (đ)
              <Input
                type="number"
                min="1000"
                step="1000"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                placeholder="Ví dụ: 50000"
                className="mt-2 h-11 rounded-xl font-normal"
              />
            </label>
            <div className="ai-preference-toggles">
              <ToggleCheck checked={noCaffeine} onChange={setNoCaffeine}>
                Không caffeine
              </ToggleCheck>
              <ToggleCheck checked={noDairy} onChange={setNoDairy}>
                Không sữa
              </ToggleCheck>
            </div>
          </div>
          <label className="block text-xs font-semibold">
            Khẩu vị
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              maxLength={500}
              aria-label="Mô tả khẩu vị"
              className="ai-prompt mt-2 w-full rounded-2xl border border-foreground/15 p-3 text-sm font-normal focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="Bạn thích vị gì?"
            />
          </label>
          <div className="ai-presets">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setPrompt(p.prompt)}
                aria-pressed={prompt === p.prompt}
                className="ai-preset"
              >
                {p.label}
              </button>
            ))}
          </div>
          <Button
            size="lg"
            className="w-full"
            onClick={() => void ask()}
            disabled={busy || prompt.trim().length === 0 || needsTable}
          >
            {busy ? (
              <LoaderCircle
                aria-hidden="true"
                className="h-4 w-4 animate-spin motion-reduce:animate-none"
              />
            ) : (
              <Send aria-hidden="true" className="h-4 w-4" />
            )}
            {busy ? 'AI đang phản hồi...' : 'Hỏi AI'}
          </Button>

          {response ? (
            <div
              ref={resultsRef}
              className="space-y-3 border-t border-foreground/10 pt-4"
              aria-live="polite"
            >
              <div className="ai-result-heading">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <p className="flex-1 text-sm">{response.message}</p>
                <Badge tone={response.mode === 'llm' ? 'success' : 'warning'}>
                  {response.mode === 'llm' ? 'AI' : 'Gợi ý theo menu'}
                </Badge>
              </div>
              <ul className="space-y-2">
                {response.recommendations
                  .filter((rec) =>
                    products.some(
                      (product) => product._id === rec.productId && product.isAvailable,
                    ),
                  )
                  .map((rec) => (
                    <li key={`${rec.productId}-${rec.variantId ?? ''}`}>
                      <button
                        type="button"
                        className="ai-recommendation"
                        onClick={() => addRec(rec)}
                      >
                        <MenuPhoto source={rec.image} className="h-16 w-16 shrink-0 rounded-xl" />
                        <span className="min-w-0 flex-1">
                          <span className="g-title block">{rec.name}</span>
                          <span className="block text-sm text-muted-foreground">{rec.reason}</span>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {[
                              rec.evidence.variant ? `Size ${rec.evidence.variant}` : null,
                              rec.evidence.caffeine === false
                                ? 'Không caffeine'
                                : rec.evidence.caffeine === true
                                  ? 'Có caffeine'
                                  : 'Chưa rõ caffeine',
                              rec.evidence.dairy === false
                                ? 'Không sữa'
                                : rec.evidence.dairy === true
                                  ? 'Có sữa'
                                  : 'Chưa rõ sữa',
                            ]
                              .filter(Boolean)
                              .join(', ')}
                          </span>
                          <span className="mt-2 block text-sm font-semibold tabular-nums text-primary">
                            {vnd(rec.unitPrice)}
                          </span>
                        </span>
                        <ArrowUpRight
                          aria-hidden="true"
                          className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                        />
                      </button>
                    </li>
                  ))}
              </ul>
              {response.followUpQuestion ? (
                <p className="text-sm text-muted-foreground">{response.followUpQuestion}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      </Modal>
      <ProductDetailModal
        product={selected}
        toppings={toppings}
        validationContext={selectedConstraints}
        onAdd={onAdd}
        onClose={() => {
          setSelected(null);
          setSelectedConstraints(undefined);
        }}
        onAdded={() => {
          setSelected(null);
          setSelectedConstraints(undefined);
        }}
      />
    </>
  );
}

export function AIPage(): JSX.Element {
  const [open, setOpen] = useState(true);
  const menuQuery = useQuery({
    queryKey: ['menu'],
    queryFn: async () => unwrap<MenuResponse>(await api.get('/categories')),
  });

  if (menuQuery.isLoading) {
    return <Skeleton className="h-64" />;
  }
  if (menuQuery.isError) {
    return (
      <ErrorState message={getErrorMessage(menuQuery.error)} onRetry={() => menuQuery.refetch()} />
    );
  }

  return (
    <div>
      <AISheet
        open={open}
        onOpenChange={setOpen}
        products={menuQuery.data?.products ?? []}
        toppings={menuQuery.data?.toppings ?? []}
      />
      {!open ? (
        <EmptyState
          title="AI Barista đã đóng"
          action={<Button onClick={() => setOpen(true)}>Mở AI Barista</Button>}
        />
      ) : null}
    </div>
  );
}
