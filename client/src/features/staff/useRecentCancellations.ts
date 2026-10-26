import { useQuery } from '@tanstack/react-query';
import type { StaffOrder } from '@may-cafe/contracts';
import { api, unwrap } from '../../lib/api';

export function useRecentCancellations() {
  return useQuery({
    queryKey: ['staff-cancelled-orders'],
    queryFn: async () =>
      unwrap<{ items: StaffOrder[] }>(
        await api.get('/staff/orders', { params: { status: 'CANCELLED' } }),
      ),
    refetchInterval: 8_000,
  });
}
