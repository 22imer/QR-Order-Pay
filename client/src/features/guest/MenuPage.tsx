import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Sparkles, SlidersHorizontal, X, Plus } from 'lucide-react';
import type { MenuSearchResponse } from '@may-cafe/contracts';
import { api, getErrorMessage, unwrap, vnd } from '../../lib/api';
import { cn } from '../../lib/cn';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Skeleton';
import { EmptyState, ErrorState } from '../../components/ui/EmptyState';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';
import { ProductDetailModal } from './ProductDetailModal';
import { ToggleCheck } from './ToggleCheck';
import { AISheet } from '../ai/AISheet';

interface Product {
  _id: string;
  name: string;
  description: string;
  image: string;
  basePrice: number;
  categoryId: string;
  isArchived: boolean;
  variants: Array<{ _id: string; name: string; price: number; isAvailable?: boolean }>;
  allowedOptions: {
    sizes: string[];
    sugarLevels: string[];
    iceLevels: string[];
    toppingIds: string[];
  };
  toppingIds: string[];
  tags: string[];
  ingredientMetadata: { caffeine: boolean; dairy: boolean; flavorProfile: string[] };
  isAvailable: boolean;
  isFeatured: boolean;
}

interface Category {
  _id: string;
  name: string;
  slug: string;
  sortOrder: number;
}

interface Topping {
  _id: string;
  name: string;
  price: number;
  isAvailable: boolean;
}

interface MenuResponse {
  categories: Category[];
  products: Product[];
  toppings: Topping[];
}

interface MenuGroup {
  id: string;
  title: string;
  items: Product[];
}

export function MenuPage(): JSX.Element {
  useDocumentTitle('Menu');
  const [query, setQuery] = useState('');
  const [activeCat, setActiveCat] = useState<string | 'all'>('all');
  const [selected, setSelected] = useState<Product | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [manualFilters, setManualFilters] = useState(false);
  const [maxBudget, setMaxBudget] = useState('');
  const [noCaffeine, setNoCaffeine] = useState(false);
  const [noDairy, setNoDairy] = useState(false);

  const searchText = query.trim() || (manualFilters ? 'món' : '');
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(searchText), 350);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  const menuQuery = useQuery({
    queryKey: ['menu'],
    queryFn: async () => unwrap(await api.get<MenuResponse>('/categories')),
  });

  const searchQuery = useQuery({
    queryKey: ['menu-search', debouncedQuery, manualFilters, maxBudget, noCaffeine, noDairy],
    queryFn: async ({ signal }) =>
      unwrap<MenuSearchResponse>(
        await api.post(
          '/menu/search',
          {
            query: debouncedQuery,
            ...(manualFilters
              ? {
                  filters: {
                    maxBudget: maxBudget ? Number(maxBudget) : null,
                    noCaffeine,
                    noDairy,
                  },
                }
              : {}),
          },
          { signal },
        ),
      ),
    enabled: debouncedQuery.length > 0,
    staleTime: 30_000,
  });

  const searchActive = searchText.length > 0;

  const filtered = useMemo(() => {
    if (!menuQuery.data) return [];
    const byId = new Map(menuQuery.data.products.map((product) => [product._id, product]));
    const list = searchActive
      ? (searchQuery.data?.items
          .map((item) => byId.get(item.productId))
          .filter((product): product is Product => !!product) ?? [])
      : menuQuery.data.products.filter((p) => !p.isArchived);
    return list.filter((p) => {
      const inCat = activeCat === 'all' || p.categoryId === activeCat;
      return inCat;
    });
  }, [menuQuery.data, activeCat, searchActive, searchQuery.data]);

  const featured = useMemo(() => filtered.filter((p) => p.isFeatured).slice(0, 3), [filtered]);

  const groups = useMemo<MenuGroup[]>(() => {
    if (filtered.length === 0) return [];
    const categories = [...(menuQuery.data?.categories ?? [])].sort(
      (a, b) => a.sortOrder - b.sortOrder,
    );
    if (searchActive) return [{ id: 'search', title: 'Kết quả tìm kiếm', items: filtered }];
    if (activeCat !== 'all') {
      const title = categories.find((c) => c._id === activeCat)?.name ?? 'Thực đơn';
      return [{ id: activeCat, title, items: filtered }];
    }
    const result: MenuGroup[] = categories
      .map((c) => ({
        id: c._id,
        title: c.name,
        items: filtered.filter((p) => p.categoryId === c._id),
      }))
      .filter((g) => g.items.length > 0);
    const known = new Set(categories.map((c) => c._id));
    const others = filtered.filter((p) => !known.has(p.categoryId));
    if (others.length > 0) result.push({ id: 'other', title: 'Món khác', items: others });
    return result;
  }, [filtered, menuQuery.data, searchActive, activeCat]);

  const searchPending = searchActive && (searchQuery.isLoading || debouncedQuery !== searchText);

  return (
    <div className="space-y-6 pt-2 lg:space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            Thực đơn
          </p>
          <h1 className="g-display text-[2.5rem] sm:text-5xl lg:text-6xl">Hôm nay uống gì?</h1>
        </div>
        <button
          type="button"
          onClick={() => setAiOpen(true)}
          className="flex items-center gap-3 rounded-2xl border border-foreground/10 bg-card px-4 py-3 text-left transition hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent/20 text-foreground">
            <Sparkles className="h-5 w-5" />
          </span>
          <span className="leading-tight">
            <span className="block text-sm font-semibold">Hỏi AI Barista</span>
            <span className="mt-1 block text-xs text-muted-foreground">
              Nói khẩu vị và ngân sách, AI chọn món từ menu.
            </span>
          </span>
        </button>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Tìm món"
            placeholder="Thử: cà phê không sữa"
            className="h-12 rounded-2xl pl-11 pr-11 text-base [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <button
              type="button"
              aria-label="Xóa tìm kiếm"
              onClick={() => setQuery('')}
              className="absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setManualFilters((value) => !value)}
          aria-label={manualFilters ? 'Dùng câu tìm kiếm' : 'Chỉnh bộ lọc'}
          title={manualFilters ? 'Dùng câu tìm kiếm' : 'Chỉnh bộ lọc'}
          className={cn(
            'grid h-12 w-12 shrink-0 place-items-center rounded-2xl border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
            manualFilters
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-foreground/15 bg-card hover:bg-muted',
          )}
        >
          <SlidersHorizontal className="h-5 w-5" />
        </button>
      </div>

      {manualFilters ? (
        <div className="space-y-3 rounded-2xl border border-foreground/10 bg-card p-4">
          <label className="block text-sm font-semibold">
            Ngân sách tối đa mỗi món
            <Input
              type="number"
              min="1000"
              step="1000"
              value={maxBudget}
              onChange={(event) => setMaxBudget(event.target.value)}
              placeholder="Ví dụ 40000"
              className="mt-2 h-11 rounded-xl font-normal"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <ToggleCheck checked={noCaffeine} onChange={setNoCaffeine}>
              Không caffeine
            </ToggleCheck>
            <ToggleCheck checked={noDairy} onChange={setNoDairy}>
              Không sữa
            </ToggleCheck>
          </div>
          <p className="text-sm text-muted-foreground">
            Bộ lọc thủ công thay cho các điều kiện ngân sách, caffeine và sữa được hiểu từ câu tìm
            kiếm. Giá tính cho một món ở size khả dụng rẻ nhất.
          </p>
        </div>
      ) : null}

      {searchActive ? (
        <div className="space-y-2 border-l-4 border-accent pl-3 text-sm" aria-live="polite">
          <p>
            {searchQuery.isFetching
              ? 'Đang hiểu câu tìm kiếm…'
              : (searchQuery.data?.message ?? 'Đang tìm trong menu…')}
          </p>
          {searchQuery.data ? <UnderstoodFilters intent={searchQuery.data.intent} /> : null}
        </div>
      ) : null}

      <div className="sticky top-16 z-20 -mx-4 border-b border-foreground/10 bg-background/95 py-3 backdrop-blur lg:top-20 lg:-mx-6">
        <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 lg:px-6">
          <Chip active={activeCat === 'all'} onClick={() => setActiveCat('all')}>
            Tất cả
          </Chip>
          {menuQuery.data?.categories.map((c) => (
            <Chip key={c._id} active={activeCat === c._id} onClick={() => setActiveCat(c._id)}>
              {c.name}
            </Chip>
          ))}
        </div>
      </div>

      {featured.length > 0 && !query && activeCat === 'all' ? (
        <section aria-labelledby="featured-title">
          <h2 id="featured-title" className="g-title mb-3 text-xl">
            Đề xuất hôm nay
          </h2>
          <ul className="no-scrollbar -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 pb-2 lg:mx-0 lg:grid lg:grid-cols-3 lg:gap-6 lg:overflow-visible lg:px-0">
            {featured.map((p) => (
              <li key={p._id} className="w-[15.5rem] shrink-0 snap-start lg:w-auto">
                <FeaturedTile product={p} onClick={() => setSelected(p)} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {menuQuery.isLoading ? (
        <div className="grid gap-x-10 md:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <RowSkeleton key={i} />
          ))}
        </div>
      ) : menuQuery.isError ? (
        <ErrorState
          message={getErrorMessage(menuQuery.error)}
          onRetry={() => menuQuery.refetch()}
        />
      ) : searchActive && searchQuery.isError ? (
        <ErrorState
          message={getErrorMessage(searchQuery.error)}
          onRetry={() => searchQuery.refetch()}
        />
      ) : searchPending ? (
        <div className="grid gap-x-10 md:grid-cols-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <RowSkeleton key={i} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title="Không có món phù hợp"
          description={searchQuery.data?.message ?? 'Thử bỏ bộ lọc hoặc đổi từ khóa khác.'}
        />
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <section key={group.id} aria-labelledby={`group-${group.id}`}>
              <h2 id={`group-${group.id}`} className="g-title flex items-center gap-3 text-2xl">
                {group.title}
                <span className="rounded-full bg-card px-2.5 py-1 font-sans text-xs font-medium tabular-nums text-muted-foreground">
                  {group.items.length}
                </span>
              </h2>
              <div className="mt-1 grid gap-x-10 md:grid-cols-2">
                {group.items.map((p) => (
                  <ProductRow key={p._id} product={p} onClick={() => setSelected(p)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <ProductDetailModal
        product={selected}
        toppings={menuQuery.data?.toppings ?? []}
        onClose={() => setSelected(null)}
        onAdded={() => {
          setSelected(null);
        }}
      />

      <AISheet
        open={aiOpen}
        onOpenChange={setAiOpen}
        products={menuQuery.data?.products ?? []}
        toppings={menuQuery.data?.toppings ?? []}
      />
    </div>
  );
}

function UnderstoodFilters({ intent }: { intent: MenuSearchResponse['intent'] }): JSX.Element {
  const labels: string[] = [];
  if (intent.requirements.noCaffeine) labels.push('Không caffeine');
  if (intent.requirements.noDairy) labels.push('Không sữa');
  for (const group of intent.requirements.includedGroups)
    labels.push({ coffee: 'Nhóm cà phê', tea: 'Nhóm trà', fruit: 'Trái cây' }[group]);
  for (const group of intent.requirements.excludedGroups)
    labels.push(`Loại ${{ coffee: 'cà phê', tea: 'trà', fruit: 'trái cây' }[group]}`);
  if (intent.requirements.budget)
    labels.push(
      `${intent.requirements.budget.inclusive ? 'Không quá' : 'Dưới'} ${vnd(intent.requirements.budget.maxVnd)}/món`,
    );
  if (intent.preferences.lowSugar) labels.push('Ưu tiên ít đường');
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-muted-foreground">Đã hiểu:</span>
      {labels.length > 0 ? (
        labels.map((label) => (
          <Badge key={label} tone="info">
            {label}
          </Badge>
        ))
      ) : (
        <span className="text-muted-foreground">từ khóa tự do</span>
      )}
      <span className="basis-full text-muted-foreground">
        Sửa câu tìm kiếm hoặc bấm nút bộ lọc để thay đổi.
      </span>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        'h-10 shrink-0 rounded-full border px-4 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        active
          ? 'border-foreground bg-foreground text-background'
          : 'border-foreground/15 bg-card text-foreground hover:bg-muted',
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function FeaturedTile({
  product,
  onClick,
}: {
  product: Product;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className="group block w-full rounded-3xl border border-foreground/10 bg-card p-2.5 text-left shadow-soft transition hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      onClick={onClick}
    >
      <span className="relative block aspect-[5/4] overflow-hidden rounded-2xl bg-muted">
        <img
          src={product.image}
          alt=""
          className={cn(
            'h-full w-full object-cover transition duration-300 motion-safe:group-hover:scale-[1.03]',
            !product.isAvailable && 'grayscale',
          )}
          loading="lazy"
        />
        {!product.isAvailable ? (
          <span className="absolute left-3 top-3">
            <Badge tone="danger" className="bg-card">
              Tạm hết
            </Badge>
          </span>
        ) : null}
      </span>
      <span className="g-title mx-2 mt-4 block text-xl">{product.name}</span>
      <span className="mx-2 mt-1 line-clamp-2 block text-sm text-muted-foreground">
        {product.description}
      </span>
      <span className="mx-2 mb-2 mt-3 block font-semibold tabular-nums">
        Từ {vnd(product.basePrice)}
      </span>
    </button>
  );
}

function ProductRow({ product, onClick }: { product: Product; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        'group flex w-full items-start gap-4 border-b border-foreground/10 py-5 text-left transition hover:bg-card/50 focus:outline-none focus-visible:bg-card/70 focus-visible:ring-2 focus-visible:ring-primary/40',
        !product.isAvailable && 'opacity-70',
      )}
      onClick={onClick}
    >
      <span className="min-w-0 flex-1">
        <span className="g-title block text-[1.0625rem]">{product.name}</span>
        <span className="mt-1 line-clamp-2 block text-sm text-muted-foreground">
          {product.description}
        </span>
        <span className="mt-2 flex items-center gap-2 text-sm">
          <span className="font-semibold tabular-nums">Từ {vnd(product.basePrice)}</span>
          {!product.isAvailable ? <Badge tone="danger">Tạm hết</Badge> : null}
        </span>
      </span>
      <span className="relative h-24 w-24 shrink-0">
        <img
          src={product.image}
          alt=""
          className={cn(
            'h-full w-full rounded-2xl bg-muted object-cover',
            !product.isAvailable && 'grayscale',
          )}
          loading="lazy"
        />
        {product.isAvailable ? (
          <span
            aria-hidden="true"
            className="absolute -bottom-1.5 -right-1.5 grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-foreground shadow-soft"
          >
            <Plus className="h-4 w-4" />
          </span>
        ) : null}
      </span>
    </button>
  );
}

function RowSkeleton(): JSX.Element {
  return (
    <div className="flex items-start gap-4 border-b border-foreground/10 py-4">
      <div className="flex-1 space-y-2">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-1/3" />
      </div>
      <Skeleton className="h-24 w-24 rounded-2xl" />
    </div>
  );
}
