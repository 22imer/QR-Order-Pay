import { vnd } from '../lib/api';
export function BenefitBreakdown({
  order,
}: {
  order: {
    voucherCode?: string;
    voucherDiscount?: number;
    pointsDiscount?: number;
    redeemedPoints?: number;
  };
}): JSX.Element | null {
  if (!order.voucherDiscount && !order.pointsDiscount) return null;
  return (
    <div className="space-y-1 py-2 text-sm">
      {order.voucherDiscount ? (
        <p className="flex justify-between gap-3">
          <span>Voucher {order.voucherCode}</span>
          <span>−{vnd(order.voucherDiscount)}</span>
        </p>
      ) : null}
      {order.pointsDiscount ? (
        <p className="flex justify-between gap-3">
          <span>Đổi {order.redeemedPoints} điểm</span>
          <span>−{vnd(order.pointsDiscount)}</span>
        </p>
      ) : null}
    </div>
  );
}
