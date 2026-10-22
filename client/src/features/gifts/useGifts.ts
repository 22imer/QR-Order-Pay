import { useQuery } from '@tanstack/react-query';
import type { GiftView } from '@may-cafe/contracts';
import { api, unwrap } from '../../lib/api';

export interface GiftFeed {
  items: GiftView[];
  total: number;
  page: number;
  incomingCount: number;
}
export function useGifts(owner: string | null, page = 1) {
  return useQuery({
    queryKey: ['gifts', owner, page],
    enabled: !!owner,
    queryFn: async () => unwrap<GiftFeed>(await api.get('/gifts', { params: { page } })),
    refetchInterval: 10000,
  });
}
