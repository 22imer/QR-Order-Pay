import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  IngredientDto,
  RecipeDto,
  RecipeSaveInput,
  StockMovementDto,
  StockMovementInput,
} from '@may-cafe/contracts';
import {
  ingredientCreateSchema,
  ingredientUpdateSchema,
  recipeSaveSchema,
  stockMovementRequestSchema,
} from '@may-cafe/contracts';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Skeleton } from '../../components/ui/Skeleton';
import { ErrorState } from '../../components/ui/EmptyState';
import { useToast } from '../../components/ui/useToast';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';
import { api, generateIdempotencyKey, getAxiosError, getErrorMessage, unwrap } from '../../lib/api';

interface Target {
  id: string;
  name: string;
  isAvailable: boolean;
  effectiveAvailable: boolean;
  variants?: Array<{ id: string; name: string; isAvailable: boolean; effectiveAvailable: boolean }>;
}
interface Overview {
  ingredients: IngredientDto[];
  recipes: RecipeDto[];
  products: Target[];
  toppings: Target[];
}
interface History {
  items: StockMovementDto[];
  total: number;
  page: number;
  limit: number;
}
const selectClass = 'w-full rounded-xl border border-border bg-background px-3 py-2 text-sm';
const number = (v: number) => v.toLocaleString('vi-VN', { maximumFractionDigits: 3 });
const unitLabel = (unit: string) => (unit === 'unit' ? 'đơn vị' : unit);
const movementLabels: Record<StockMovementDto['type'], string> = {
  RECEIPT: 'Nhập kho',
  ISSUE: 'Xuất khác / hao hụt',
  ADJUSTMENT: 'Kiểm kê',
  RESERVE: 'Giữ cho đơn',
  RELEASE: 'Trả phần giữ',
  CONSUME: 'Xuất pha chế',
};

export function AdminInventory(): JSX.Element {
  useDocumentTitle('Kho & công thức');
  const qc = useQueryClient();
  const [tab, setTab] = useState<'ingredients' | 'recipes' | 'history'>('ingredients');
  const [ingredientForm, setIngredientForm] = useState<IngredientDto | 'new' | null>(null);
  const [moving, setMoving] = useState<IngredientDto | null>(null);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('');
  const query = useQuery({
    queryKey: ['admin-inventory'],
    queryFn: async () => unwrap<Overview>(await api.get('/admin/inventory')),
    refetchInterval: 10000,
  });
  const history = useQuery({
    queryKey: ['inventory-history', page, filter],
    enabled: tab === 'history',
    queryFn: async () =>
      unwrap<History>(
        await api.get('/admin/inventory/movements', {
          params: { page, ...(filter ? { ingredientId: filter } : {}) },
        }),
      ),
    refetchInterval: 10000,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin-inventory'] });
    void qc.invalidateQueries({ queryKey: ['inventory-history'] });
    void qc.invalidateQueries({ queryKey: ['staff-availability'] });
  };
  if (query.isLoading) return <Skeleton className="h-80" />;
  if (query.isError)
    return <ErrorState message={getErrorMessage(query.error)} onRetry={() => query.refetch()} />;
  const data = query.data!;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Kho & công thức</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Giữ nguyên liệu khi đặt đơn, xuất kho khi bắt đầu pha chế; hủy trước pha chế trả lại
            phần giữ.
          </p>
        </div>
        <Button onClick={() => setIngredientForm('new')}>Thêm nguyên liệu</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Nguyên liệu đang dùng</p>
          <strong className="text-2xl">{data.ingredients.filter((i) => i.isActive).length}</strong>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Sắp hết / hết</p>
          <strong className="text-2xl">
            {data.ingredients.filter((i) => i.isActive && i.isLowStock).length}
          </strong>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Công thức đang áp dụng</p>
          <strong className="text-2xl">{data.recipes.filter((r) => r.enabled).length}</strong>
        </Card>
      </div>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Quản lý kho">
        {(
          [
            ['ingredients', 'Nguyên liệu'],
            ['recipes', 'Công thức'],
            ['history', 'Lịch sử kho'],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            role="tab"
            aria-selected={tab === value}
            variant={tab === value ? 'primary' : 'outline'}
            onClick={() => setTab(value)}
          >
            {label}
          </Button>
        ))}
      </div>
      {tab === 'ingredients' && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.ingredients.length === 0 && (
            <Card className="p-5 md:col-span-2">
              <p>
                Chưa có nguyên liệu. Thêm nguyên liệu, nhập tồn đầu và cấu hình công thức cho món.
              </p>
            </Card>
          )}
          {data.ingredients.map((i) => (
            <Card key={i.id} className="min-w-0 space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="break-words font-semibold">{i.name}</h2>
                  <p className="text-xs text-muted-foreground">
                    {i.code} · {unitLabel(i.unit)}
                  </p>
                </div>
                <Badge tone={!i.isActive ? 'neutral' : i.isLowStock ? 'danger' : 'success'}>
                  {!i.isActive ? 'Ngừng dùng' : i.isLowStock ? 'Sắp hết / hết' : 'Đủ tồn'}
                </Badge>
              </div>
              <dl className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <dt className="text-muted-foreground">Tồn thực</dt>
                  <dd>{number(i.onHand)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Đang giữ</dt>
                  <dd>{number(i.reserved)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Có thể dùng</dt>
                  <dd className="font-semibold">{number(i.available)}</dd>
                </div>
              </dl>
              <p className="text-xs text-muted-foreground">
                Ngưỡng cảnh báo: {number(i.lowStockThreshold)} {unitLabel(i.unit)}
              </p>
              <p className="text-xs text-muted-foreground">
                Giá vốn:{' '}
                {i.unitCost === null || i.unitCost === undefined
                  ? 'Chưa nhập'
                  : `${number(i.unitCost)} đ/${unitLabel(i.unit)}`}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={!i.isActive} onClick={() => setMoving(i)}>
                  Nhập / xuất / kiểm kê
                </Button>
                <Button size="sm" variant="outline" onClick={() => setIngredientForm(i)}>
                  Sửa
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      {tab === 'recipes' && <RecipePanel data={data} onSaved={refresh} />}
      {tab === 'history' && (
        <Card className="space-y-4 p-4">
          <Field label="Lọc nguyên liệu">
            <select
              className={selectClass}
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Tất cả nguyên liệu</option>
              {data.ingredients.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </Field>
          {history.isLoading ? (
            <Skeleton className="h-40" />
          ) : history.isError ? (
            <ErrorState
              message={getErrorMessage(history.error)}
              onRetry={() => history.refetch()}
            />
          ) : (
            <>
              {history.data?.items.length === 0 && (
                <p className="text-sm text-muted-foreground">Chưa có biến động kho.</p>
              )}
              <div className="divide-y divide-border">
                {history.data?.items.map((m) => (
                  <div key={m.id} className="space-y-1 py-3 text-sm">
                    <div className="flex flex-wrap justify-between gap-2">
                      <strong>
                        {m.ingredientName} · {movementLabels[m.type]}
                      </strong>
                      <span>
                        {number(m.quantity)} {unitLabel(m.unit)}
                      </span>
                    </div>
                    <p>{m.reason}</p>
                    <p className="text-xs text-muted-foreground">
                      Tồn: {number(m.onHandAfter)} · Đang giữ: {number(m.reservedAfter)} ·{' '}
                      {m.actorName} · {new Date(m.createdAt).toLocaleString('vi-VN')}
                    </p>
                    {m.orderId && (
                      <p className="break-all text-xs text-muted-foreground">Đơn: {m.orderId}</p>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  Trước
                </Button>
                <span className="text-sm">
                  Trang {page} · {history.data?.total ?? 0} biến động
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page * 30 >= (history.data?.total ?? 0)}
                  onClick={() => setPage(page + 1)}
                >
                  Sau
                </Button>
              </div>
            </>
          )}
        </Card>
      )}
      {ingredientForm && (
        <IngredientForm
          key={typeof ingredientForm === 'string' ? 'new' : ingredientForm.id}
          ingredient={ingredientForm === 'new' ? null : ingredientForm}
          onClose={() => setIngredientForm(null)}
          onSaved={refresh}
        />
      )}
      {moving && (
        <MovementForm ingredient={moving} onClose={() => setMoving(null)} onSaved={refresh} />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}
function IngredientForm({
  ingredient,
  onClose,
  onSaved,
}: {
  ingredient: IngredientDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(ingredient?.name ?? '');
  const [code, setCode] = useState('');
  const [unit, setUnit] = useState('g');
  const [threshold, setThreshold] = useState(String(ingredient?.lowStockThreshold ?? 0));
  const [active, setActive] = useState(ingredient?.isActive ?? true);
  const [unitCost, setUnitCost] = useState(
    ingredient?.unitCost === null || ingredient?.unitCost === undefined
      ? ''
      : String(ingredient.unitCost),
  );
  const save = useMutation({
    mutationFn: async () =>
      ingredient
        ? api.patch(
            `/admin/inventory/ingredients/${ingredient.id}`,
            ingredientUpdateSchema.parse({
              name,
              lowStockThreshold: Number(threshold),
              isActive: active,
              expectedVersion: ingredient.version,
              unitCost: unitCost.trim() === '' ? null : Number(unitCost),
            }),
          )
        : api.post(
            '/admin/inventory/ingredients',
            ingredientCreateSchema.parse({
              code,
              name,
              unit,
              lowStockThreshold: Number(threshold),
              unitCost: unitCost.trim() === '' ? null : Number(unitCost),
            }),
          ),
    onSuccess: () => {
      onSaved();
      onClose();
      toast({ title: 'Đã lưu nguyên liệu', tone: 'success' });
    },
    onError: (e) =>
      toast({ title: 'Chưa lưu được', description: getErrorMessage(e), tone: 'danger' }),
  });
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
      title={ingredient ? 'Sửa nguyên liệu' : 'Thêm nguyên liệu'}
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Tên nguyên liệu">
          <Input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {!ingredient && (
          <>
            <Field label="Mã nguyên liệu">
              <Input
                required
                pattern="[A-Za-z0-9_-]{1,32}"
                maxLength={32}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </Field>
            <Field label="Đơn vị cơ sở">
              <select
                className={selectClass}
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              >
                <option value="g">Gram (g)</option>
                <option value="ml">Mililit (ml)</option>
                <option value="unit">Đơn vị / cái</option>
              </select>
            </Field>
            <p className="text-xs text-muted-foreground">
              Mã và đơn vị được giữ cố định. Nguyên liệu mới có tồn bằng 0; dùng Nhập kho để ghi
              nhận tồn đầu.
            </p>
          </>
        )}
        <Field label="Ngưỡng cảnh báo sắp hết">
          <Input
            required
            type="number"
            min="0"
            max="1000000000"
            step="0.001"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
          />
        </Field>
        {ingredient && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Đang dùng
          </label>
        )}
        <Field label={`Giá vốn (đ/${ingredient?.unit ?? unit})`}>
          <Input
            aria-label="Giá vốn nguyên liệu"
            type="number"
            min="0"
            max="10000000"
            step="0.001"
            value={unitCost}
            onChange={(e) => setUnitCost(e.target.value)}
            placeholder="Để trống nếu chưa biết"
          />
        </Field>
        <p className="text-xs text-muted-foreground">
          Giá vốn dự kiến cho một g/ml/đơn vị cơ sở, không phải giá cả bao/gói. Để trống là chưa
          biết; 0 là miễn phí. Chỉ dùng cho ước tính hiện tại, không sửa chi phí đơn cũ.
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>
            Hủy
          </Button>
          <Button disabled={save.isPending} type="submit">
            Lưu nguyên liệu
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function MovementForm({
  ingredient,
  onClose,
  onSaved,
}: {
  ingredient: IngredientDto;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [type, setType] = useState<StockMovementInput['type']>('RECEIPT');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [frozen, setFrozen] = useState<StockMovementInput | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const save = useMutation({
    mutationFn: (payload: StockMovementInput) =>
      api.post(`/admin/inventory/ingredients/${ingredient.id}/movements`, payload),
    onSuccess: () => {
      onSaved();
      onClose();
      toast({ title: 'Đã ghi nhận biến động kho', tone: 'success' });
    },
    onError: (error) => {
      const status = getAxiosError(error)?.response?.status;
      if (status === undefined || status >= 500 || status === 408) setUncertain(true);
      else {
        setFrozen(null);
        setUncertain(false);
        onSaved();
      }
      toast({
        title: 'Chưa xác nhận được thao tác',
        description: getErrorMessage(error),
        tone: 'danger',
      });
    },
  });
  const busy = save.isPending || uncertain;
  function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const payload =
        frozen ??
        stockMovementRequestSchema.parse({
          type,
          quantity: Number(quantity),
          reason,
          expectedVersion: ingredient.version,
          idempotencyKey: generateIdempotencyKey(),
        });
      setFrozen(payload);
      save.mutate(payload);
    } catch {
      toast({ title: 'Kiểm tra số lượng và lý do (ít nhất 3 ký tự)', tone: 'danger' });
    }
  }
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title={`Nhập / xuất: ${ingredient.name}`}
    >
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm">
          Tồn hiện tại: {number(ingredient.onHand)} · Đang giữ: {number(ingredient.reserved)}{' '}
          {unitLabel(ingredient.unit)}
        </p>
        <Field label="Loại thao tác">
          <select
            disabled={busy}
            className={selectClass}
            value={type}
            onChange={(e) => setType(e.target.value as StockMovementInput['type'])}
          >
            <option value="RECEIPT">Nhập kho</option>
            <option value="ISSUE">Xuất khác / hao hụt</option>
            <option value="ADJUSTMENT">Kiểm kê tồn thực tế</option>
          </select>
        </Field>
        <Field label={type === 'ADJUSTMENT' ? 'Tồn thực tế sau kiểm kê' : 'Số lượng'}>
          <Input
            required
            disabled={busy}
            type="number"
            min={type === 'ADJUSTMENT' ? '0' : '0.001'}
            max="1000000000"
            step="0.001"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </Field>
        <Field label="Lý do">
          <Input
            required
            disabled={busy}
            minLength={3}
            maxLength={280}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        {type === 'ADJUSTMENT' && (
          <p className="text-xs text-muted-foreground">
            Nhập tổng tồn đã đếm, bao gồm nguyên liệu đang giữ cho đơn. Không được thấp hơn lượng
            đang giữ.
          </p>
        )}
        {uncertain && (
          <p role="alert" className="text-sm text-danger">
            Chưa rõ server đã ghi nhận hay chưa. Thử lại cùng thao tác để tránh ghi trùng.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            Hủy
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {uncertain ? 'Thử lại cùng thao tác' : 'Ghi nhận'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

type DraftLine = { ingredientId: string; quantity: string };
type DraftVariant = { variantId: string; components: DraftLine[] };
const draftLines = (lines: RecipeSaveInput['components']): DraftLine[] =>
  lines.map((c) => ({ ...c, quantity: String(c.quantity) }));

function RecipePanel({ data, onSaved }: { data: Overview; onSaved: () => void }) {
  const [selection, setSelection] = useState('');
  const [kind, id] = selection.split(':');
  const target = (kind === 'PRODUCT' ? data.products : data.toppings).find((t) => t.id === id);
  const recipe = data.recipes.find((r) => r.targetType === kind && r.targetId === id);
  return (
    <Card className="space-y-4 p-4">
      <p className="text-sm text-muted-foreground">
        Công thức nền áp dụng cho mọi size. Công thức riêng của size thay thế toàn bộ nền. Topping
        có công thức riêng và được cộng thêm khi đặt món. Món chưa bật công thức giữ cách bán hiện
        tại.
      </p>
      <Field label="Món hoặc topping">
        <select
          className={selectClass}
          value={selection}
          onChange={(e) => setSelection(e.target.value)}
        >
          <option value="">Chọn món / topping</option>
          <optgroup label="Món">
            {data.products.map((t) => (
              <option key={t.id} value={`PRODUCT:${t.id}`}>
                {t.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Topping">
            {data.toppings.map((t) => (
              <option key={t.id} value={`TOPPING:${t.id}`}>
                {t.name}
              </option>
            ))}
          </optgroup>
        </select>
      </Field>
      {target && (
        <RecipeEditor
          key={`${selection}:${recipe?.version ?? 0}`}
          target={target}
          kind={kind as 'PRODUCT' | 'TOPPING'}
          recipe={recipe}
          ingredients={data.ingredients}
          onSaved={onSaved}
        />
      )}
    </Card>
  );
}
function RecipeEditor({
  target,
  kind,
  recipe,
  ingredients,
  onSaved,
}: {
  target: Target;
  kind: 'PRODUCT' | 'TOPPING';
  recipe?: RecipeDto;
  ingredients: IngredientDto[];
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(recipe?.enabled ?? false);
  const [lines, setLines] = useState<DraftLine[]>(draftLines(recipe?.components ?? []));
  const [variants, setVariants] = useState<DraftVariant[]>(
    (recipe?.variants ?? []).map((v) => ({
      variantId: v.variantId,
      components: draftLines(v.components),
    })),
  );
  const save = useMutation({
    mutationFn: async () => {
      const convert = (items: DraftLine[]) =>
        items.map((c) => ({ ingredientId: c.ingredientId, quantity: Number(c.quantity) }));
      const parsed = recipeSaveSchema.safeParse({
        enabled,
        components: convert(lines),
        variants: variants.map((v) => ({
          variantId: v.variantId,
          components: convert(v.components),
        })),
        expectedVersion: recipe?.version ?? 0,
      });
      if (!parsed.success)
        throw new Error(parsed.error.issues[0]?.message ?? 'Công thức chưa hợp lệ.');
      return api.put(`/admin/inventory/recipes/${kind}/${target.id}`, parsed.data);
    },
    onSuccess: () => {
      onSaved();
      toast({ title: 'Đã lưu công thức', tone: 'success' });
    },
    onError: (e) =>
      toast({ title: 'Chưa lưu được', description: getErrorMessage(e), tone: 'danger' }),
  });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="flex flex-wrap justify-between gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Áp dụng công thức và kiểm soát kho
        </label>
        <Badge tone={target.effectiveAvailable ? 'success' : 'danger'}>
          {target.effectiveAvailable
            ? 'Có thể bán'
            : target.isAvailable
              ? 'Thiếu nguyên liệu hoặc size tạm hết'
              : 'Đã tạm ngừng bán'}
        </Badge>
      </div>
      <fieldset disabled={save.isPending} className="space-y-4">
        <legend className="mb-2 font-semibold">Công thức nền cho 1 phần</legend>
        <ComponentLines lines={lines} onChange={setLines} ingredients={ingredients} />
        {kind === 'PRODUCT' &&
          target.variants?.map((v) => {
            const custom = variants.find((row) => row.variantId === v.id);
            return (
              <div key={v.id} className="space-y-2 rounded-xl border border-border p-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!!custom}
                    onChange={(e) =>
                      setVariants(
                        e.target.checked
                          ? [
                              ...variants,
                              { variantId: v.id, components: lines.map((l) => ({ ...l })) },
                            ]
                          : variants.filter((row) => row.variantId !== v.id),
                      )
                    }
                  />
                  Công thức riêng size {v.name}
                </label>
                {custom && (
                  <ComponentLines
                    ingredients={ingredients}
                    lines={custom.components}
                    onChange={(components) =>
                      setVariants(
                        variants.map((row) =>
                          row.variantId === v.id ? { ...row, components } : row,
                        ),
                      )
                    }
                  />
                )}
              </div>
            );
          })}
      </fieldset>
      <Button disabled={save.isPending} type="submit">
        Lưu công thức
      </Button>
    </form>
  );
}
function ComponentLines({
  lines,
  onChange,
  ingredients,
}: {
  lines: DraftLine[];
  onChange: (lines: DraftLine[]) => void;
  ingredients: IngredientDto[];
}) {
  return (
    <div className="space-y-2">
      {lines.map((line, index) => (
        <div key={index} className="grid grid-cols-[minmax(0,1fr)_6rem_auto] items-end gap-2">
          <Field label={`Nguyên liệu ${index + 1}`}>
            <select
              required
              className={selectClass}
              value={line.ingredientId}
              onChange={(e) =>
                onChange(
                  lines.map((c, i) => (i === index ? { ...c, ingredientId: e.target.value } : c)),
                )
              }
            >
              <option value="">Chọn nguyên liệu</option>
              {ingredients.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({unitLabel(i.unit)}){i.isActive ? '' : ' · Ngừng dùng'}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`Định lượng ${index + 1}`}>
            <Input
              required
              type="number"
              min="0.001"
              max="1000000000"
              step="0.001"
              value={line.quantity}
              onChange={(e) =>
                onChange(
                  lines.map((c, i) => (i === index ? { ...c, quantity: e.target.value } : c)),
                )
              }
            />
          </Field>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={`Xóa nguyên liệu ${index + 1}`}
            onClick={() => onChange(lines.filter((_, i) => i !== index))}
          >
            ×
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...lines, { ingredientId: '', quantity: '' }])}
      >
        Thêm dòng nguyên liệu
      </Button>
    </div>
  );
}
