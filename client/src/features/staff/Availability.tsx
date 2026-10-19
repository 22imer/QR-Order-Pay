import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ErrorState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';
import { useToast } from '../../components/ui/useToast';
import { api, getErrorMessage, unwrap } from '../../lib/api';
import { useSocketEvent } from '../../lib/socket';

interface Product {
  _id: string;
  name: string;
  isAvailable: boolean;
  effectiveAvailable?: boolean;
  isArchived: boolean;
  variants: Array<{
    _id: string;
    name: string;
    isAvailable: boolean;
    effectiveAvailable?: boolean;
  }>;
}
interface Topping {
  _id: string;
  name: string;
  isAvailable: boolean;
  effectiveAvailable?: boolean;
  isArchived: boolean;
}

export function StaffAvailability(): JSX.Element {
  useDocumentTitle('Tình trạng món');
  const qc = useQueryClient();
  const { toast } = useToast();
  useSocketEvent('menu.availabilityChanged', () => {
    void qc.invalidateQueries({ queryKey: ['staff-availability'] });
  });
  useSocketEvent('connect', () => {
    void qc.invalidateQueries({ queryKey: ['staff-availability'] });
  });
  const query = useQuery({
    queryKey: ['staff-availability'],
    queryFn: async () =>
      unwrap<{ products: Product[]; toppings: Topping[] }>(
        await api.get('/staff/catalog/availability'),
      ),
    refetchInterval: 10000,
  });
  const change = useMutation({
    mutationFn: ({ url, isAvailable }: { url: string; isAvailable: boolean }) =>
      api.patch(url, { isAvailable }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['staff-availability'] });
      toast({ title: 'Đã cập nhật tình trạng bán', tone: 'success' });
    },
    onError: (error) =>
      toast({ title: 'Không thể cập nhật', description: getErrorMessage(error), tone: 'danger' }),
  });
  if (query.isLoading) return <Skeleton className="h-80" />;
  if (query.isError)
    return <ErrorState message={getErrorMessage(query.error)} onRetry={() => query.refetch()} />;
  const products = query.data?.products.filter((item) => !item.isArchived) ?? [];
  const toppings = query.data?.toppings.filter((item) => !item.isArchived) ?? [];
  const toggle = (url: string, current: boolean) => change.mutate({ url, isAvailable: !current });
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-semibold">Tình trạng món</h1>
        <p className="text-sm text-muted-foreground">
          Nhân viên chỉ có thể bật/tắt bán; giá và nội dung menu vẫn do quản trị viên quản lý.
        </p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="font-display font-semibold">Món và size</h2>
          <div className="mt-3 divide-y divide-foreground/10">
            {products.map((product) => (
              <div key={product._id} className="py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{product.name}</span>
                  {product.isAvailable && product.effectiveAvailable === false && (
                    <Badge tone="danger">Thiếu nguyên liệu hoặc size tạm hết</Badge>
                  )}
                  <AvailabilityButton
                    value={product.isAvailable}
                    busy={change.isPending}
                    onClick={() =>
                      toggle(
                        `/staff/catalog/products/${product._id}/availability`,
                        product.isAvailable,
                      )
                    }
                  />
                </div>
                {product.variants.length > 0 ? (
                  <div className="ml-4 mt-2 space-y-2">
                    {product.variants.map((variant) => (
                      <div
                        key={variant._id}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span>{variant.name}</span>
                        {variant.isAvailable && variant.effectiveAvailable === false && (
                          <Badge tone="danger">Thiếu nguyên liệu</Badge>
                        )}
                        <AvailabilityButton
                          value={variant.isAvailable}
                          busy={change.isPending}
                          onClick={() =>
                            toggle(
                              `/staff/catalog/products/${product._id}/variants/${variant._id}/availability`,
                              variant.isAvailable,
                            )
                          }
                        />
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-4">
          <h2 className="font-display font-semibold">Topping</h2>
          <div className="mt-3 divide-y divide-foreground/10">
            {toppings.map((topping) => (
              <div key={topping._id} className="flex items-center justify-between gap-2 py-3">
                <span>{topping.name}</span>
                {topping.isAvailable && topping.effectiveAvailable === false && (
                  <Badge tone="danger">Thiếu nguyên liệu</Badge>
                )}
                <AvailabilityButton
                  value={topping.isAvailable}
                  busy={change.isPending}
                  onClick={() =>
                    toggle(
                      `/staff/catalog/toppings/${topping._id}/availability`,
                      topping.isAvailable,
                    )
                  }
                />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function AvailabilityButton({
  value,
  busy,
  onClick,
}: {
  value: boolean;
  busy: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <Button variant="outline" size="sm" disabled={busy} onClick={onClick}>
      <Badge tone={value ? 'success' : 'danger'}>{value ? 'Đang bán' : 'Tạm hết'}</Badge>
    </Button>
  );
}
