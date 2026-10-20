import { useViolations } from './useViolations';

export function usePendingViolationsCount(enabled: boolean): number {
  const { data } = useViolations({ acknowledged: false, pageSize: 1, enabled });
  return data?.meta.total ?? 0;
}
