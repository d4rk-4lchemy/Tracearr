import { useMemo } from 'react';
import type { DescribeRefs } from '@/lib/automations';
import { useDestinations } from '@/hooks/queries/useDestinations';
import { useAutomationFilterOptions } from '@/hooks/queries/useHistory';
import { useServer } from '@/hooks/useServer';

/** The names an automation's stored ids read as, for every place that shows one. */
export function useDescribeRefs(): DescribeRefs {
  const { servers } = useServer();
  const { data: filterOptions } = useAutomationFilterOptions();
  const { data: destinations } = useDestinations();

  return useMemo(
    () => ({
      servers: Object.fromEntries(servers.map((server) => [server.id, server.name])),
      users: Object.fromEntries(
        (filterOptions?.users ?? []).map((user) => [user.id, user.identityName || user.username])
      ),
      countries: Object.fromEntries(
        (filterOptions?.countries ?? []).map((country) => [country.code, country.name])
      ),
      destinations: Object.fromEntries(
        (destinations ?? []).map((destination) => [destination.id, destination.name])
      ),
    }),
    [servers, filterOptions, destinations]
  );
}
