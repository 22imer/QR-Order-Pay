import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowRight, Coffee, Plus, Search, ShoppingBag, Sparkles } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { ErrorState } from '../../components/ui/EmptyState';
import { MenuPhoto } from '../guest/MenuPhoto';
import type { Product } from '../guest/ProductDetailModal';
import { vnd } from '../../lib/api';
import './pickup-storefront.css';

type PickupProduct = Product & { categoryId?: string };
function pickupStartingPrice(product: Product): number {
  const prices = product.variants
    .filter((v) => v.isAvailable !== false && product.allowedOptions.sizes.includes(v.name))
    .map((v) => v.price);
  return prices.length ? Math.min(...prices) : product.basePrice;
}

export function PickupStorefront({
  products,
  categories = [],
  loading,
  catalogError,
  onRetry,
  onChoose,
  onAi,
  locked,
  count,
  total,
  uncertain,
  checkout,
}: {
  products: PickupProduct[];
  categories?: Array<{ _id: string; name: string }>;
  loading: boolean;
  catalogError?: string;
  onRetry: () => void;
  onChoose: (product: Product) => void;
  onAi: () => void;
  locked: boolean;
  count: number;
  total: number;
  uncertain: boolean;
  checkout: ReactNode;
}): JSX.Element {
  const [search, setSearch] = useState(''),
    [category, setCategory] = useState('all'),
    [limit, setLimit] = useState(6),
    [cartOpen, setCartOpen] = useState(uncertain);
  useEffect(() => {
    if (uncertain) setCartOpen(true);
  }, [uncertain]);
  const available = products.filter((p) => p.isAvailable);
  const featured = available[0];
  const visibleCategories = categories.filter((c) => available.some((p) => p.categoryId === c._id));
  const filtered = useMemo(
    () =>
      products.filter(
        (p) =>
          p.isAvailable &&
          (category === 'all' || p.categoryId === category) &&
          p.name.toLocaleLowerCase('vi').includes(search.trim().toLocaleLowerCase('vi')),
      ),
    [products, search, category],
  );
  return (
    <div className="pickup-storefront">
      <section className="pickup-hero" aria-label="Mang đi và đặt trước">
        <div className="pickup-hero-copy">
          <span className="pickup-eyebrow">
            <span /> CÀ PHÊ THEO BẠN
          </span>
          <h1>
            Gu quen.
            <br />
            <em>Mang theo.</em>
          </h1>
          <div className="pickup-hero-actions">
            <a href="#pickup-menu" className="pickup-primary-link">
              Chọn món <ArrowDown className="h-4 w-4" />
            </a>
            <button
              type="button"
              className="pickup-ai-link"
              onClick={onAi}
              disabled={loading || locked || !featured}
              aria-label="Hỏi AI cho đơn mang đi"
            >
              <Sparkles className="h-4 w-4" /> Gợi ý AI
            </button>
          </div>
          <div className="pickup-service-tags">
            <span>Mang đi ngay</span>
            <span>Hẹn giờ nhận</span>
          </div>
        </div>
        <div className="pickup-hero-visual">
          <span className="pickup-orbit" aria-hidden="true" />
          {featured ? (
            <>
              <MenuPhoto source={featured.image} eager className="pickup-hero-photo" />
              <button
                type="button"
                className="pickup-featured-note"
                aria-label="Chọn món nổi bật"
                onClick={() => onChoose(featured)}
                disabled={locked}
              >
                <span>
                  <span className="pickup-note-label">HÔM NAY CHỌN</span>
                  <strong>{featured.name}</strong>
                  <span>{vnd(pickupStartingPrice(featured))}</span>
                </span>
                <span className="pickup-note-add">
                  <Plus className="h-5 w-5" />
                </span>
              </button>
            </>
          ) : (
            <div className="pickup-hero-placeholder" aria-hidden="true">
              <Coffee />
            </div>
          )}
          <span className="pickup-hero-stamp" aria-hidden="true">
            FANTASTIC
            <br />
            TO GO ↗
          </span>
        </div>
      </section>
      <section id="pickup-menu" className="pickup-catalog" aria-label="Thực đơn mang đi">
        <div className="pickup-catalog-heading">
          <div>
            <span className="pickup-eyebrow">THỰC ĐƠN</span>
            <h2>Hôm nay uống gì?</h2>
          </div>
          <label className="pickup-search">
            <Search className="h-4 w-4" aria-hidden="true" />
            <input
              aria-label="Tìm món mang đi"
              value={search}
              placeholder="Tìm món…"
              onChange={(e) => {
                setSearch(e.target.value);
                setLimit(6);
              }}
            />
          </label>
        </div>
        {visibleCategories.length > 0 ? (
          <div className="pickup-categories" aria-label="Danh mục mang đi">
            <button
              type="button"
              aria-pressed={category === 'all'}
              onClick={() => {
                setCategory('all');
                setLimit(6);
              }}
            >
              Tất cả
            </button>
            {visibleCategories.map((c) => (
              <button
                key={c._id}
                type="button"
                aria-pressed={category === c._id}
                onClick={() => {
                  setCategory(c._id);
                  setLimit(6);
                }}
              >
                {c.name}
              </button>
            ))}
          </div>
        ) : null}
        {catalogError ? (
          <ErrorState message={catalogError} onRetry={onRetry} />
        ) : loading ? (
          <p role="status" className="py-12 text-center text-muted-foreground">
            Đang tải thực đơn…
          </p>
        ) : filtered.length ? (
          <>
            <div className="pickup-product-grid">
              {filtered.slice(0, limit).map((p) => (
                <button
                  key={p._id}
                  type="button"
                  className="pickup-product"
                  onClick={() => onChoose(p)}
                  disabled={locked}
                  aria-label={`${p.name} · ${vnd(pickupStartingPrice(p))}`}
                >
                  <span className="pickup-product-image">
                    <MenuPhoto source={p.image} />
                    <span className="pickup-product-plus">
                      <Plus className="h-5 w-5" />
                    </span>
                  </span>
                  <span className="pickup-product-copy">
                    <strong>{p.name}</strong>
                    <span>
                      {p.variants.length ? 'Từ ' : ''}
                      {vnd(pickupStartingPrice(p))}
                    </span>
                  </span>
                </button>
              ))}
            </div>
            {filtered.length > limit ? (
              <button type="button" className="pickup-more" onClick={() => setLimit((v) => v + 6)}>
                Xem thêm món ({filtered.length - limit}) <ArrowDown className="h-4 w-4" />
              </button>
            ) : null}
          </>
        ) : (
          <div className="pickup-empty">
            <Search className="h-6 w-6" />
            <p>Không tìm thấy món.</p>
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setCategory('all');
                setLimit(6);
              }}
            >
              Xem tất cả
            </button>
          </div>
        )}
      </section>
      <div className="pickup-cart-dock print:hidden">
        <button
          type="button"
          className="pickup-floating-cart"
          onClick={() => setCartOpen(true)}
          aria-label={`Giỏ hàng mang đi (${count})`}
          aria-haspopup="dialog"
          aria-expanded={cartOpen}
        >
          <span className="pickup-cart-icon">
            <ShoppingBag className="h-6 w-6" />
            <span aria-live="polite">{count}</span>
          </span>
          <span className="pickup-cart-copy">
            <strong>Giỏ mang đi</strong>
            <span>{uncertain ? 'Cần kiểm tra đơn vừa gửi' : `${count} món đã chọn`}</span>
          </span>
          <strong className="pickup-cart-total" aria-live="polite">
            {vnd(total)}
          </strong>
          <span className="pickup-cart-arrow">
            <ArrowRight className="h-5 w-5" />
          </span>
        </button>
      </div>
      <Modal
        open={cartOpen}
        onOpenChange={setCartOpen}
        title="Giỏ mang đi"
        titleIcon={<ShoppingBag className="h-5 w-5" />}
        className="g-sheet pickup-checkout"
      >
        {count > 0 ? (
          <button type="button" className="pickup-keep-shopping" onClick={() => setCartOpen(false)}>
            ← Tiếp tục chọn món
          </button>
        ) : null}
        {count > 0 ? (
          checkout
        ) : (
          <div className="pickup-empty">
            <ShoppingBag className="h-10 w-10" />
            <p>Giỏ hàng chưa có món.</p>
            <Button onClick={() => setCartOpen(false)}>Chọn món</Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
