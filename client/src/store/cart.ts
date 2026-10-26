import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { FreestyleView } from '@may-cafe/contracts';

export interface CartItem {
  freestyleToken?: string;
  freestyle?: FreestyleView;
  cupPhotoId?: string;
  clientId: string;
  productId: string;
  variantId: string | null;
  sizeName: string | null;
  sugarLevel: string;
  iceLevel: string;
  toppingIds: string[];
  note: string;
  quantity: number;
  unitPrice: number;
  name: string;
  variantName: string;
  image: string;
}

interface CartState {
  tableSessionId: string | null;
  participantId: string | null;
  items: CartItem[];
  setSession: (tableSessionId: string, participantId: string) => void;
  clear: () => void;
  add: (item: Omit<CartItem, 'clientId'>) => void;
  update: (clientId: string, patch: Partial<CartItem>) => void;
  remove: (clientId: string) => void;
  resetSession: () => void;
}

function generateClientId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      tableSessionId: null,
      participantId: null,
      items: [],
      setSession(tableSessionId, participantId) {
        if (get().tableSessionId !== tableSessionId || get().participantId !== participantId) {
          set({ tableSessionId, participantId, items: [] });
        } else {
          set({ tableSessionId, participantId });
        }
      },
      clear() {
        set({ items: [] });
      },
      add(item) {
        const clientId = generateClientId();
        set({ items: [...get().items, { ...item, clientId }] });
      },
      update(clientId, patch) {
        set({
          items: get().items.map((it) => (it.clientId === clientId ? { ...it, ...patch } : it)),
        });
      },
      remove(clientId) {
        set({ items: get().items.filter((it) => it.clientId !== clientId) });
      },
      resetSession() {
        set({ tableSessionId: null, participantId: null, items: [] });
      },
    }),
    {
      name: 'mc-cart',
      partialize: (state) => ({
        items: state.items,
        tableSessionId: state.tableSessionId,
        participantId: state.participantId,
      }),
    },
  ),
);

export function cartTotals(items: CartItem[]): { count: number; subtotal: number } {
  let count = 0;
  let subtotal = 0;
  for (const it of items) {
    count += it.quantity;
    subtotal += it.unitPrice * it.quantity;
  }
  return { count, subtotal };
}
