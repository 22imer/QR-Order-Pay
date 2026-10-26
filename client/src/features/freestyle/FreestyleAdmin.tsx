import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  freestyleSaveSchema,
  type FreestyleSettings,
  type IngredientDto,
} from '@may-cafe/contracts';
import { api, unwrap, getErrorMessage, getAxiosError, generateRequestId } from '../../lib/api';
import { useAuth } from '../auth/useAuth';
import { useSocketEvent } from '../../lib/socket';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';
type Save = { requestId: string; expectedVersion: number; settings: FreestyleSettings };
type Data = { settings: FreestyleSettings; version: number; ingredients: IngredientDto[] };
const inputClass = 'mt-1 block w-full rounded-xl border bg-background p-2';
export function FreestyleAdmin(): JSX.Element {
  useDocumentTitle('Cấu hình Freestyle');
  const { user } = useAuth();
  return <Editor key={user?.id} owner={user?.id ?? ''} />;
}
function Editor({ owner }: { owner: string }): JSX.Element {
  const storage = `mc-freestyle-save:${owner}`,
    qc = useQueryClient();
  const [pending, setPending] = useState<Save | null>(() => {
    try {
      const p = freestyleSaveSchema.safeParse(
        JSON.parse(sessionStorage.getItem(storage) ?? 'null'),
      );
      return p.success ? p.data : null;
    } catch {
      return null;
    }
  });
  const [draft, setDraft] = useState<FreestyleSettings | null>(pending?.settings ?? null),
    [version, setVersion] = useState(pending?.expectedVersion ?? 0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const feed = useQuery({
    queryKey: ['freestyle-admin'],
    queryFn: async () => unwrap<Data>(await api.get('/admin/freestyle')),
  });
  useEffect(() => {
    if (!draft && feed.data) {
      setDraft(structuredClone(feed.data.settings));
      setVersion(feed.data.version);
    }
  }, [draft, feed.data]);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['freestyle-admin'] });
  };
  useSocketEvent('menu.availabilityChanged', refresh);
  useSocketEvent('connect', refresh);
  async function save(retry = false) {
    if (busy || !draft || (!retry && pending)) return;
    setBusy(true);
    setError('');
    try {
      const body =
        retry && pending
          ? pending
          : freestyleSaveSchema.parse({
              requestId: generateRequestId(),
              expectedVersion: version,
              settings: draft,
            });
      sessionStorage.setItem(storage, JSON.stringify(body));
      setPending(body);
      const result = unwrap<{ settings: FreestyleSettings; version: number }>(
        await api.put('/admin/freestyle', body),
      );
      sessionStorage.removeItem(storage);
      setPending(null);
      setDraft(structuredClone(result.settings));
      setVersion(result.version);
      refresh();
    } catch (err) {
      const status = getAxiosError(err)?.response?.status;
      if (status && status < 500) {
        sessionStorage.removeItem(storage);
        setPending(null);
      }
      setError(
        err instanceof Error && err.name === 'ZodError'
          ? 'Kiểm tra tên, hướng dẫn, định lượng và vị được phép. Khi bật cần giá từ 1.000đ và một nền/vị hợp lệ.'
          : getErrorMessage(err),
      );
    } finally {
      setBusy(false);
    }
  }
  const locked = busy || !!pending;
  async function reload() {
    setBusy(true);
    setError('');
    try {
      const result = await feed.refetch({ throwOnError: true });
      if (result.data) {
        setDraft(structuredClone(result.data.settings));
        setVersion(result.data.version);
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  const update = (patch: Partial<FreestyleSettings>) => {
    if (draft) setDraft({ ...draft, ...patch });
  };
  function addPart(kind: 'bases' | 'flavors') {
    if (!draft) return;
    const p = {
      id: generateRequestId(),
      name: '',
      components: [],
      instructions: '',
      caffeine: null,
      dairy: null,
      tags: [],
      enabled: true,
    };
    if (kind === 'bases')
      update({ bases: [...draft.bases, { ...p, allowedFlavorIds: [], maxFlavors: 1 }] });
    else update({ flavors: [...draft.flavors, { ...p, conflictsWith: [] }] });
  }
  function remove(kind: 'bases' | 'flavors', id: string) {
    if (!draft) return;
    if (kind === 'bases') update({ bases: draft.bases.filter((p) => p.id !== id) });
    else
      update({
        flavors: draft.flavors
          .filter((p) => p.id !== id)
          .map((p) => ({ ...p, conflictsWith: p.conflictsWith.filter((i) => i !== id) })),
        bases: draft.bases.map((p) => ({
          ...p,
          allowedFlavorIds: p.allowedFlavorIds.filter((i) => i !== id),
        })),
      });
  }
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-3xl font-semibold">Cấu hình Freestyle</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Duyệt nền, vị, thành phần và hướng dẫn trước khi mở bán. AI chỉ chọn tổ hợp; giá và định
          lượng do quán quyết định.
        </p>
      </header>
      {feed.isPending && <p role="status">Đang tải cấu hình…</p>}
      {feed.isError && <p role="alert">{getErrorMessage(feed.error)}</p>}
      {error && <p role="alert">{error}</p>}
      {pending && (
        <Card className="space-y-2 p-4">
          <p>Chưa xác nhận lần lưu. Thử lại đúng yêu cầu để tránh ghi đè.</p>
          <Button disabled={busy} onClick={() => void save(true)}>
            Thử lại lưu Freestyle
          </Button>
        </Card>
      )}
      {draft && (
        <>
          <fieldset disabled={locked} className="min-w-0 space-y-5">
            <Card className="grid gap-3 p-5 sm:grid-cols-2">
              <label>
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) => update({ enabled: e.target.checked })}
                />{' '}
                Bật Freestyle
              </label>
              <label>
                Giá cố định / cốc (đ)
                <input
                  aria-label="Giá Freestyle"
                  className={inputClass}
                  type="number"
                  min="0"
                  max="1000000"
                  step="1000"
                  value={draft.price}
                  onChange={(e) => update({ price: Number(e.target.value) })}
                />
              </label>
              <label>
                Tên size
                <input
                  aria-label="Tên size Freestyle"
                  className={inputClass}
                  maxLength={80}
                  value={draft.sizeName}
                  onChange={(e) => update({ sizeName: e.target.value })}
                />
              </label>
              <label>
                Dung tích (ml)
                <input
                  aria-label="Dung tích Freestyle"
                  className={inputClass}
                  type="number"
                  min="250"
                  max="700"
                  value={draft.sizeMl}
                  onChange={(e) => update({ sizeMl: Number(e.target.value) })}
                />
              </label>
              <p className="text-sm text-muted-foreground sm:col-span-2">
                Một size, không thêm topping ngoài đề xuất. Đường/đá phải nằm trong công thức/hướng
                dẫn đã duyệt. Đổi cấu hình sẽ yêu cầu tạo lại đề xuất chưa đặt.
              </p>
            </Card>
            {(['flavors', 'bases'] as const).map((kind) => (
              <section
                key={kind}
                className="space-y-4"
                aria-label={kind === 'bases' ? 'Nền được duyệt' : 'Vị được duyệt'}
              >
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-2xl font-semibold">{kind === 'bases' ? 'Nền' : 'Vị'}</h2>
                  <Button
                    variant="outline"
                    disabled={draft[kind].length >= (kind === 'bases' ? 6 : 12)}
                    onClick={() => addPart(kind)}
                  >
                    {kind === 'bases' ? 'Thêm nền' : 'Thêm vị'}
                  </Button>
                </div>
                {draft[kind].map((p, index) => (
                  <Card key={p.id} className="space-y-3 p-5">
                    <PartFields
                      value={p}
                      number={index + 1}
                      title={kind === 'bases' ? 'nền' : 'vị'}
                      ingredients={feed.data?.ingredients ?? []}
                      onChange={(patch) => {
                        if (kind === 'bases')
                          update({
                            bases: draft.bases.map((b) => (b.id === p.id ? { ...b, ...patch } : b)),
                          });
                        else
                          update({
                            flavors: draft.flavors.map((f) =>
                              f.id === p.id ? { ...f, ...patch } : f,
                            ),
                          });
                      }}
                    />
                    {kind === 'bases' && 'allowedFlavorIds' in p ? (
                      <div className="space-y-2">
                        <p className="font-medium">Vị được phép pha với nền này</p>
                        <div className="flex flex-wrap gap-3">
                          {draft.flavors.map((f) => (
                            <label key={f.id}>
                              <input
                                type="checkbox"
                                checked={p.allowedFlavorIds.includes(f.id)}
                                onChange={(e) =>
                                  update({
                                    bases: draft.bases.map((b) =>
                                      b.id === p.id
                                        ? {
                                            ...b,
                                            allowedFlavorIds: e.target.checked
                                              ? [...b.allowedFlavorIds, f.id]
                                              : b.allowedFlavorIds.filter((id) => id !== f.id),
                                          }
                                        : b,
                                    ),
                                  })
                                }
                              />{' '}
                              {f.name || 'Vị chưa đặt tên'}
                            </label>
                          ))}
                        </div>
                        <label>
                          Số vị tối đa
                          <select
                            aria-label={`Số vị tối đa nền ${index + 1}`}
                            className={inputClass}
                            value={p.maxFlavors}
                            onChange={(e) =>
                              update({
                                bases: draft.bases.map((b) =>
                                  b.id === p.id ? { ...b, maxFlavors: Number(e.target.value) } : b,
                                ),
                              })
                            }
                          >
                            <option value="1">1 vị</option>
                            <option value="2">2 vị</option>
                          </select>
                        </label>
                      </div>
                    ) : null}
                    {kind === 'flavors' && 'conflictsWith' in p ? (
                      <div>
                        <p className="font-medium">Không pha chung với</p>
                        <div className="flex flex-wrap gap-3">
                          {draft.flavors
                            .filter((f) => f.id !== p.id)
                            .map((f) => (
                              <label key={f.id}>
                                <input
                                  type="checkbox"
                                  checked={p.conflictsWith.includes(f.id)}
                                  onChange={(e) =>
                                    update({
                                      flavors: draft.flavors.map((v) =>
                                        v.id === p.id
                                          ? {
                                              ...v,
                                              conflictsWith: e.target.checked
                                                ? [...v.conflictsWith, f.id]
                                                : v.conflictsWith.filter((id) => id !== f.id),
                                            }
                                          : v,
                                      ),
                                    })
                                  }
                                />{' '}
                                {f.name || 'Vị chưa đặt tên'}
                              </label>
                            ))}
                        </div>
                      </div>
                    ) : null}
                    <Button variant="outline" onClick={() => remove(kind, p.id)}>
                      {kind === 'bases' ? 'Bỏ nền' : 'Bỏ vị'} {index + 1}
                    </Button>
                  </Card>
                ))}
              </section>
            ))}
          </fieldset>
          <div className="flex flex-wrap gap-3">
            <Button disabled={locked} onClick={() => void save()}>
              Lưu cấu hình Freestyle
            </Button>
            <Button variant="outline" disabled={locked} onClick={() => void reload()}>
              Tải lại bản đã lưu
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Tối đa 6 nền/12 vị, mỗi nền chọn 1–2 vị được phép; quy tắc xung khắc áp dụng cả hai
            chiều. Mỗi công thức tối đa 250 g, 5 phần và tổng ml không vượt dung tích. Kiểm tra khả
            năng pha thực tế trước khi bật.
          </p>
        </>
      )}
    </div>
  );
}
type Part = FreestyleSettings['flavors'][number];
function PartFields({
  value,
  number,
  title,
  ingredients,
  onChange,
}: {
  value: Omit<Part, 'conflictsWith'>;
  number: number;
  title: string;
  ingredients: IngredientDto[];
  onChange: (patch: Partial<Omit<Part, 'conflictsWith'>>) => void;
}): JSX.Element {
  const [tagsText, setTagsText] = useState(value.tags.join(', '));
  useEffect(() => {
    setTagsText(value.tags.join(', '));
  }, [value.tags]);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          Tên {title} {number}
          <input
            aria-label={`Tên ${title} ${number}`}
            className={inputClass}
            maxLength={80}
            value={value.name}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={value.enabled}
            onChange={(e) => onChange({ enabled: e.target.checked })}
          />{' '}
          Dùng {title} này
        </label>
        {(['caffeine', 'dairy'] as const).map((key) => (
          <label key={key}>
            {key === 'caffeine' ? 'Caffeine' : 'Sữa'}
            <select
              aria-label={`${key} ${title} ${number}`}
              className={inputClass}
              value={value[key] === null ? 'unknown' : value[key] ? 'yes' : 'no'}
              onChange={(e) =>
                onChange({ [key]: e.target.value === 'unknown' ? null : e.target.value === 'yes' })
              }
            >
              <option value="unknown">Chưa xác nhận</option>
              <option value="no">Không có</option>
              <option value="yes">Có</option>
            </select>
          </label>
        ))}
        <label className="sm:col-span-2">
          Từ khóa khẩu vị
          <input
            aria-label={`Từ khóa ${title} ${number}`}
            className={inputClass}
            placeholder="trái cây, ít ngọt"
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            onBlur={() =>
              onChange({
                tags: tagsText
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
        </label>
        <label className="sm:col-span-2">
          Hướng dẫn pha
          <textarea
            aria-label={`Hướng dẫn ${title} ${number}`}
            className={inputClass}
            maxLength={300}
            value={value.instructions}
            onChange={(e) => onChange({ instructions: e.target.value })}
          />
        </label>
      </div>
      <p className="font-medium">Nguyên liệu và định lượng / cốc</p>
      {value.components.map((c, index) => (
        <div key={index} className="flex flex-wrap gap-2">
          <select
            aria-label={`Nguyên liệu ${title} ${number} dòng ${index + 1}`}
            className="min-w-0 flex-1 rounded-lg border bg-background p-2"
            value={c.ingredientId}
            onChange={(e) => {
              const i = ingredients.find((i) => i.id === e.target.value);
              onChange({
                components: value.components.map((v, n) =>
                  n === index ? { ...v, ingredientId: e.target.value, unit: i?.unit ?? 'ml' } : v,
                ),
              });
            }}
          >
            <option value="">Chọn nguyên liệu</option>
            {ingredients.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} ({i.unit}){i.isActive ? '' : ' · Ngừng dùng'}
              </option>
            ))}
          </select>
          <input
            aria-label={`Định lượng ${title} ${number} dòng ${index + 1}`}
            className="w-24 rounded-lg border bg-background p-2"
            type="number"
            min="0.001"
            max={c.unit === 'unit' ? 5 : c.unit === 'g' ? 200 : 500}
            step="0.001"
            value={c.quantity}
            onChange={(e) =>
              onChange({
                components: value.components.map((v, n) =>
                  n === index ? { ...v, quantity: Number(e.target.value) } : v,
                ),
              })
            }
          />
          <span className="self-center">{c.unit}</span>
          <Button
            variant="outline"
            onClick={() => onChange({ components: value.components.filter((_, n) => n !== index) })}
          >
            Bỏ dòng {index + 1}
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        disabled={value.components.length >= 8}
        onClick={() =>
          onChange({
            components: [...value.components, { ingredientId: '', unit: 'ml', quantity: 1 }],
          })
        }
      >
        Thêm nguyên liệu {title} {number}
      </Button>
    </div>
  );
}
