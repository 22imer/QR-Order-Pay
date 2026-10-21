import { createContext, type MutableRefObject } from 'react';
import type { CartItem } from '../../store/cart';

export interface PickupDraft {
  identity: string;
  name: string;
  phone: string;
  type: 'TAKEAWAY' | 'PICKUP';
  when: string;
  items: CartItem[];
  voucher: string;
  redeem: number;
}

// Normal drafts survive navigation inside the pickup shell. Uncertain submits
// still use the existing durable, immutable pending-request recovery.
export const PickupDraftContext = createContext<MutableRefObject<PickupDraft | null> | null>(null);
