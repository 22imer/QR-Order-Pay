import { useOutletContext } from 'react-router-dom';

export interface GuestContext {
  tableName: string | null;
}

export function useGuestContext(): GuestContext | null {
  return useOutletContext<GuestContext | undefined>() ?? null;
}
