import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Sparkles, SlidersHorizontal, X } from 'lucide-react';
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
import { MenuShowcase } from './MenuShowcase';
import './menu-showcase.css';

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

  const searchPending = searchActive && (searchQuery.isLoading || debouncedQuery !== searchText);
  const status =
    menuQuery.isLoading || searchPending ? (
      <div className="space-y-4" aria-label="Đang tải thực đơn">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-4/5" />
      </div>
    ) : menuQuery.isError ? (
      <ErrorState message={getErrorMessage(menuQuery.error)} onRetry={() => menuQuery.refetch()} />
    ) : searchActive && searchQuery.isError ? (
      <ErrorState
        message={getErrorMessage(searchQuery.error)}
        onRetry={() => searchQuery.refetch()}
      />
    ) : filtered.length === 0 ? (
      <EmptyState
        title="Không có món phù hợp"
        description={searchQuery.data?.message ?? 'Thử bỏ bộ lọc hoặc đổi từ khóa khác.'}
      />
    ) : undefined;

  return (
    <>
      <MenuShowcase
        products={filtered}
        categories={menuQuery.data?.categories ?? []}
        onChoose={setSelected}
        status={status}
      >
        <div className="menu-toolbar">
          <div className="menu-toolbar-heading">
            <span className="menu-toolbar-label">Thực đơn</span>
            <h1>Hôm nay uống gì?</h1>
          </div>
          <div className="menu-toolbar-actions">
            <div className="menu-search">
              <Search aria-hidden="true" className="h-4 w-4" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="Tìm món"
                placeholder="Thử: cà phê không sữa"
              />
              {query ? (
                <button type="button" aria-label="Xóa tìm kiếm" onClick={() => setQuery('')}>
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            <button
              type="button"
              className={cn('menu-tool-button', manualFilters && 'is-active')}
              onClick={() => setManualFilters((value) => !value)}
              aria-label={manualFilters ? 'Dùng câu tìm kiếm' : 'Chỉnh bộ lọc'}
              title={manualFilters ? 'Dùng câu tìm kiếm' : 'Chỉnh bộ lọc'}
            >
              <SlidersHorizontal className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="menu-ai-button"
              aria-label="Hỏi AI Barista"
              onClick={() => setAiOpen(true)}
            >
              <Sparkles className="h-4 w-4" />
              <span>Hỏi AI Barista</span>
            </button>
          </div>
        </div>
        {manualFilters ? (
          <div className="menu-filter-panel">
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
            <p className="text-xs text-muted-foreground">Giá theo size rẻ nhất còn bán.</p>
          </div>
        ) : null}
        <div className="menu-categories no-scrollbar" aria-label="Danh mục món">
          <Chip active={activeCat === 'all'} onClick={() => setActiveCat('all')}>
            Tất cả
          </Chip>
          {menuQuery.data?.categories.map((category) => (
            <Chip
              key={category._id}
              active={activeCat === category._id}
              onClick={() => setActiveCat(category._id)}
            >
              {category.name}
            </Chip>
          ))}
        </div>
        {searchActive ? (
          <div className="menu-search-summary" aria-live="polite">
            <p>
              {searchQuery.isFetching
                ? 'Đang hiểu câu tìm kiếm…'
                : (searchQuery.data?.message ?? 'Đang tìm trong menu…')}
            </p>
            {searchQuery.data ? <UnderstoodFilters intent={searchQuery.data.intent} /> : null}
          </div>
        ) : null}
      </MenuShowcase>
      <ProductDetailModal
        product={selected}
        toppings={menuQuery.data?.toppings ?? []}
        onClose={() => setSelected(null)}
        onAdded={() => setSelected(null)}
      />
      <AISheet
        open={aiOpen}
        onOpenChange={setAiOpen}
        products={menuQuery.data?.products ?? []}
        toppings={menuQuery.data?.toppings ?? []}
      />
    </>
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
      className={cn('menu-category', active && 'is-active')}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
