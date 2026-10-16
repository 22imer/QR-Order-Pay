import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, Plus } from 'lucide-react';
import { vnd } from '../../lib/api';
import { cn } from '../../lib/cn';
import type { Product } from './ProductDetailModal';
import { menuImageSource } from './menuImages';
import { MenuPhoto } from './MenuPhoto';

function menuStartingPrice(product: Product): number {
  const prices = product.variants
    .filter(
      (variant) =>
        variant.isAvailable !== false && product.allowedOptions.sizes.includes(variant.name),
    )
    .map((variant) => variant.price);
  return prices.length ? Math.min(...prices) : product.basePrice;
}

export function MenuShowcase<T extends Product & { categoryId: string }>({
  products,
  categories,
  onChoose,
  children,
  status,
}: {
  products: T[];
  categories: Array<{ _id: string; name: string }>;
  onChoose: (product: T) => void;
  children: ReactNode;
  status?: ReactNode;
}): JSX.Element {
  const [activeId, setActiveId] = useState<string | null>(null);
  const index = Math.max(
    0,
    products.findIndex((product) => product._id === activeId),
  );
  const active = products[index];
  const track = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLButtonElement>());
  const activeCategory = categories.find((category) => category._id === active?.categoryId)?.name;
  useEffect(() => {
    if (!active) return;
    const card = cards.current.get(active._id);
    const container = track.current;
    if (card && container)
      container.scrollTo({
        left: card.offsetLeft - (container.clientWidth - card.clientWidth) / 2,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      });
    for (const next of [products[index - 1], products[index + 1]]) {
      if (next?.image) {
        const image = new Image();
        image.src = menuImageSource(next.image);
      }
    }
  }, [active, index, products]);
  const select = (next: number) => {
    const product = products[(next + products.length) % products.length];
    if (product) setActiveId(product._id);
  };
  return (
    <section className="menu-experience" aria-label="Thực đơn">
      <div className="menu-backdrop" aria-hidden="true" data-product-id={active?._id ?? ''}>
        {active ? (
          <MenuPhoto
            key={active._id}
            source={active.image}
            eager
            className="menu-photo menu-backdrop-photo"
          />
        ) : null}
      </div>
      <div className="menu-backdrop-shade" aria-hidden="true" />
      <div className="menu-experience-inner">
        <div className="menu-tools">{children}</div>
        {status ? (
          <div className="menu-status">
            <div className="menu-state-panel">{status}</div>
          </div>
        ) : active ? (
          <div className="menu-showcase-body">
            <div className="menu-story" aria-live="polite" aria-atomic="true">
              <div key={active._id} className="menu-story-content">
                <span className="menu-story-rule" aria-hidden="true" />
                {activeCategory ? <p className="menu-eyebrow">{activeCategory}</p> : null}
                <h2 id="menu-product-title" className="menu-product-title">
                  {active.name}
                </h2>
                {active.description ? (
                  <p className="menu-product-description">{active.description}</p>
                ) : null}
                <div className="menu-story-price">
                  <span>Từ</span> {vnd(menuStartingPrice(active))}
                </div>
                <div className="menu-story-actions">
                  <button
                    type="button"
                    className="menu-choose"
                    disabled={!active.isAvailable}
                    onClick={() => onChoose(active)}
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    {active.isAvailable ? 'Chọn món' : 'Tạm hết'}
                  </button>
                  <button
                    type="button"
                    className="menu-browse"
                    onClick={() => {
                      track.current?.focus();
                      track.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }}
                  >
                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                    <span>Thực đơn</span>
                  </button>
                </div>
              </div>
            </div>
            <div className="menu-gallery" aria-label="Danh sách món">
              <div
                ref={track}
                className="menu-card-track no-scrollbar"
                tabIndex={0}
                aria-label="Chọn món để xem ảnh và mô tả"
              >
                {products.map((product, cardIndex) => (
                  <button
                    key={product._id}
                    ref={(element) => {
                      if (element) cards.current.set(product._id, element);
                      else cards.current.delete(product._id);
                    }}
                    type="button"
                    className={cn(
                      'menu-product-card',
                      product._id === active._id && 'is-selected',
                      !product.isAvailable && 'is-unavailable',
                    )}
                    aria-label={`Xem món ${product.name}`}
                    aria-pressed={product._id === active._id}
                    onClick={() => setActiveId(product._id)}
                  >
                    <MenuPhoto source={product.image} className="menu-photo" />
                    <span className="menu-card-shade" aria-hidden="true" />
                    <span className="menu-card-index">
                      {String(cardIndex + 1).padStart(2, '0')}
                    </span>
                    {!product.isAvailable ? (
                      <span className="menu-card-availability">Tạm hết</span>
                    ) : null}
                    <span className="menu-card-copy">
                      <span className="menu-card-category">
                        {categories.find((category) => category._id === product.categoryId)?.name}
                      </span>
                      <span className="menu-card-name">{product.name}</span>
                      <span className="menu-card-price">Từ {vnd(menuStartingPrice(product))}</span>
                    </span>
                  </button>
                ))}
              </div>
              <div className="menu-gallery-controls">
                <div className="menu-arrows">
                  <button
                    type="button"
                    aria-label="Món trước"
                    disabled={products.length < 2}
                    onClick={() => select(index - 1)}
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Món tiếp theo"
                    disabled={products.length < 2}
                    onClick={() => select(index + 1)}
                  >
                    <ArrowRight className="h-5 w-5" />
                  </button>
                </div>
                <div className="menu-gallery-progress" aria-hidden="true">
                  <span style={{ width: `${((index + 1) / products.length) * 100}%` }} />
                </div>
                <p className="menu-gallery-count">
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <span>/ {String(products.length).padStart(2, '0')}</span>
                </p>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
