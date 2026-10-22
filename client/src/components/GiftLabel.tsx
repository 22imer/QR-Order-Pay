import type { GiftDelivery } from '@may-cafe/contracts';
export function GiftLabel({ gift }: { gift?: GiftDelivery | null }): JSX.Element | null {
  if (!gift) return null;
  return (
    <div className="rounded-xl border border-primary/30 p-2 text-sm">
      <p className="font-semibold">
        Quà → {gift.recipientTableCode} · {gift.recipientTableName}
      </p>
      {gift.message && <p className="break-words">“{gift.message}”</p>}
    </div>
  );
}
