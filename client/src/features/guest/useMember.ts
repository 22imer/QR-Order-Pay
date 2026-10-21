import { useQuery } from '@tanstack/react-query';
import type { MemberDto } from '@may-cafe/contracts';
import { api, unwrap } from '../../lib/api';
export function useMember(enabled = true) {
  return useQuery({
    queryKey: ['member'],
    enabled,
    queryFn: async () => unwrap<{ member: MemberDto | null }>(await api.get('/members/me')),
    staleTime: 0,
    refetchInterval: 30000,
    retry: false,
  });
}
