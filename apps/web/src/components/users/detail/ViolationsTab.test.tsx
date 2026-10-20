import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ViolationsTab } from './ViolationsTab';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/hooks/queries', () => ({ useViolations: vi.fn(), useUserTerminations: vi.fn() }));

import { useUserTerminations, useViolations } from '@/hooks/queries';

describe('ViolationsTab', () => {
  it('reads one account when narrowed to it and links each violation to its page', () => {
    vi.mocked(useViolations).mockReturnValue({
      data: {
        data: [
          {
            id: 'v-9',
            rule: { id: 'r-1', name: 'Concurrent streams', type: null },
            severity: 'warning',
            createdAt: '2026-10-01T00:00:00.000Z',
            acknowledgedAt: '2026-10-02T00:00:00.000Z',
          },
        ],
        meta: { total: 1 },
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useViolations>);
    vi.mocked(useUserTerminations).mockReturnValue({
      data: { data: [], total: 0 },
      isLoading: false,
    } as unknown as ReturnType<typeof useUserTerminations>);

    render(
      <MemoryRouter>
        <ViolationsTab
          serverUserId="su-2"
          identityUserId="u-1"
          isSpecificServerScope
          scope={undefined}
          showServer={false}
        />
      </MemoryRouter>
    );

    expect(vi.mocked(useViolations)).toHaveBeenCalledWith({
      serverUserId: 'su-2',
      page: 1,
      pageSize: 10,
    });
    expect(screen.getByRole('link', { name: 'Concurrent streams' })).toHaveAttribute(
      'href',
      '/violations/v-9'
    );
    expect(screen.getByText('common:states.acknowledged')).toBeInTheDocument();
    expect(screen.getByText('pages:userDetail.noTerminationsFound')).toBeInTheDocument();
  });
});
