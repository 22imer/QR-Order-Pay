import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGuestContext } from './guestContext';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { api, getErrorMessage, unwrap, vnd } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useCart } from '../../store/cart';
import type { CartItem } from '../../store/cart';
import { useToast } from '../../components/ui/useToast';
import { QtyStepper } from './QtyStepper';
import { MenuPhoto } from './MenuPhoto';

interface Variant {
  _id: string;
  name: string;
  price: number;
  isAvailable?: boolean;
}

export interface Product {
  _id: string;
  name: string;
  description: string;
  image: string;
  basePrice: number;
  variants: Variant[];
  allowedOptions: {
    sizes: string[];
    sugarLevels: string[];
    iceLevels: string[];
    toppingIds: string[];
  };
  toppingIds: string[];
  tags: string[];
  isAvailable: boolean;
}

export interface Topping {
  _id: string;
  name: string;
  price: number;
  isAvailable?: boolean;
}

interface Props {
  product: Product | null;
  toppings: Topping[];
  onClose: () => void;
  onAdded: () => void;
  validationContext?: { noCaffeine?: boolean; noDairy?: boolean; maxBudget?: number };
  onAdd?: (item: Omit<CartItem, 'clientId'>) => void | false;
}

const SUGAR_LEVELS = ['0%', '30%', '50%', '70%', '100%'];
const ICE_LEVELS = [
  { value: 'no-ice', label: 'Không đá' },
  { value: 'less-ice', label: 'Ít đá' },
  { value: 'normal-ice', label: 'Đá thường' },
];

export function ProductDetailModal({
  product,
  toppings,
  onClose,
  onAdded,
  validationContext,
  onAdd,
}: Props): JSX.Element {
  const addToCart = useCart((s) => s.add);
  const navigate = useNavigate();
  const guest = useGuestContext();
  const needsTable = !onAdd && !guest?.tableName;
  const { toast } = useToast();

  const availableSizes = useMemo(() => {
    if (!product) return [] as string[];
    if (product.allowedOptions.sizes?.length > 0) return product.allowedOptions.sizes;
    return product.variants.map((v) => v.name);
  }, [product]);

  const initialVariant = useMemo(() => {
    if (!product) return null;
    if (product.variants.length === 0) return null;
    return (
      product.variants.find(
        (v) => v.isAvailable !== false && product.allowedOptions.sizes.includes(v.name),
      ) ?? null
    );
  }, [product]);

  const [variantId, setVariantId] = useState<string | null>(initialVariant?._id ?? null);
  const [sugar, setSugar] = useState<string>('50%');
  const [ice, setIce] = useState<string>('normal-ice');
  const [toppingIds, setToppingIds] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [validating, setValidating] = useState(false);

  useEffect(() => {
    if (product) {
      setVariantId(initialVariant?._id ?? null);
      setSugar(
        product.allowedOptions.sugarLevels.includes('50%')
          ? '50%'
          : (product.allowedOptions.sugarLevels[0] ?? ''),
      );
      setIce(
        product.allowedOptions.iceLevels.includes('normal-ice')
          ? 'normal-ice'
          : (product.allowedOptions.iceLevels[0] ?? ''),
      );
      setToppingIds([]);
      setNote('');
      setQuantity(1);
    }
  }, [product, initialVariant]);

  if (!product) {
    return <></>;
  }

  const variant = product.variants.find((v) => v._id === variantId) ?? null;
  const unitPrice =
    (variant?.price ?? product.basePrice) +
    toppingIds.reduce((sum, id) => sum + (toppings.find((t) => t._id === id)?.price ?? 0), 0);
  const visibleToppings = toppings.filter(
    (t) => t.isAvailable !== false && (product.allowedOptions.toppingIds ?? []).includes(t._id),
  );
  const sugarOptions = (
    product.allowedOptions.sugarLevels?.length > 0
      ? product.allowedOptions.sugarLevels
      : SUGAR_LEVELS
  ).map((s) => ({ value: s, label: s }));
  const iceOptions =
    product.allowedOptions.iceLevels?.length > 0
      ? product.allowedOptions.iceLevels.map((v) => ({
          value: v,
          label: ICE_LEVELS.find((i) => i.value === v)?.label ?? v,
        }))
      : ICE_LEVELS;

  function toggleTopping(id: string): void {
    setToppingIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleAdd(): Promise<void> {
    if (needsTable) {
      navigate('/t');
      return;
    }
    if (validationContext) {
      setValidating(true);
      try {
        const validation = await unwrap<{ valid: boolean; total: number; violations: string[] }>(
          await api.post('/ai/recommendations/validate', {
            productId: product!._id,
            variantId: variant?._id ?? null,
            toppingIds,
            constraints: validationContext,
          }),
        );
        if (!validation.valid) {
          toast({
            title: 'Cấu hình không còn đúng yêu cầu AI',
            description: validation.violations.join(' '),
            tone: 'danger',
          });
          return;
        }
      } catch (error) {
        toast({
          title: 'Không kiểm tra được cấu hình',
          description: getErrorMessage(error),
          tone: 'danger',
        });
        return;
      } finally {
        setValidating(false);
      }
    }
    const item: Omit<CartItem, 'clientId'> = {
      productId: product!._id,
      variantId: variant?._id ?? null,
      sizeName: variant?.name ?? null,
      sugarLevel: sugar,
      iceLevel: ice,
      toppingIds,
      note,
      quantity,
      unitPrice,
      name: product!.name,
      variantName: variant?.name ?? '',
      image: product!.image,
    };
    if (onAdd) {
      if (onAdd(item) === false) return;
    } else {
      addToCart(item);
    }
    toast({
      title: 'Đã thêm vào giỏ',
      description: `${quantity} x ${product!.name}`,
      tone: 'success',
    });
    onAdded();
  }

  return (
    <Modal
      open={!!product}
      onOpenChange={(o) => !o && onClose()}
      title={product.name}
      description={product.description}
      className="g-sheet product-sheet"
    >
      <MenuPhoto
        source={product.image}
        eager
        className="h-44 w-full rounded-2xl bg-muted object-cover"
      />
      {!product.isAvailable ? (
        <Badge tone="danger" className="mt-3">
          Món đang tạm hết
        </Badge>
      ) : null}

      {availableSizes.length > 0 ? (
        <Section title="Size">
          <div role="radiogroup" aria-label="Size" className="flex flex-wrap gap-2">
            {product.variants.map((v) => {
              const disabled =
                v.isAvailable === false || !product.allowedOptions.sizes.includes(v.name);
              const selected = variantId === v._id;
              return (
                <button
                  key={v._id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={disabled}
                  className={cn(
                    'max-w-[10rem] flex-1 basis-24 rounded-2xl border px-2 py-2.5 text-center transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                    selected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-foreground/15 bg-card hover:bg-muted',
                    disabled && 'cursor-not-allowed opacity-50 hover:bg-card',
                  )}
                  onClick={() => setVariantId(v._id)}
                >
                  <span className="block font-semibold">{v.name}</span>
                  <span
                    className={cn(
                      'block text-xs tabular-nums',
                      selected ? 'opacity-90' : 'text-muted-foreground',
                    )}
                  >
                    {disabled ? 'Hết' : vnd(v.price)}
                  </span>
                </button>
              );
            })}
          </div>
        </Section>
      ) : null}

      <Section title="Đường">
        <Segmented label="Đường" options={sugarOptions} value={sugar} onChange={setSugar} />
      </Section>

      <Section title="Đá">
        <Segmented label="Đá" options={iceOptions} value={ice} onChange={setIce} />
      </Section>

      {visibleToppings.length > 0 ? (
        <Section title="Topping" hint="Chọn được nhiều loại">
          <ul className="divide-y divide-foreground/10 overflow-hidden rounded-2xl border border-foreground/10 bg-card">
            {visibleToppings.map((t) => (
              <li key={t._id}>
                <label className="flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2 focus-within:bg-muted">
                  <input
                    type="checkbox"
                    checked={toppingIds.includes(t._id)}
                    onChange={() => toggleTopping(t._id)}
                    className="h-5 w-5 accent-[rgb(var(--c-primary))]"
                  />
                  <span className="flex-1">{t.name}</span>
                  <span className="text-sm tabular-nums text-muted-foreground">
                    +{vnd(t.price)}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Ghi chú">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={280}
          rows={2}
          aria-label="Ghi chú"
          placeholder="Ví dụ: ít ngọt hơn, đổi sang sữa hạnh nhân..."
          className="w-full rounded-2xl border border-foreground/15 bg-card p-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </Section>

      <div className="product-sheet-footer sticky bottom-0 -mx-5 -mb-5 mt-6 flex items-center gap-3 border-t border-foreground/10 bg-card px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
        <QtyStepper value={quantity} onChange={setQuantity} />
        <Button
          size="lg"
          className="flex-1 justify-between whitespace-nowrap px-4 text-[0.9375rem]"
          onClick={() => void handleAdd()}
          disabled={
            validating ||
            !product.isAvailable ||
            !sugar ||
            !ice ||
            (product.variants.length > 0 && !variant)
          }
        >
          {validating ? (
            'Đang kiểm tra cấu hình…'
          ) : (
            <>
              <span>{needsTable ? 'Quét QR để đặt' : 'Thêm vào giỏ'}</span>
              <span className="tabular-nums">{vnd(unitPrice * quantity)}</span>
            </>
          )}
        </Button>
      </div>
    </Modal>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="mt-5">
      <p className="mb-2 flex items-baseline gap-2 text-sm font-semibold">
        {title}
        {hint ? <span className="text-xs font-normal text-muted-foreground">{hint}</span> : null}
      </p>
      {children}
    </div>
  );
}

function Segmented({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-2xl bg-muted p-1">
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            className={cn(
              'h-10 flex-1 rounded-xl px-1 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              selected
                ? 'bg-primary/15 font-semibold text-primary shadow-soft'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
