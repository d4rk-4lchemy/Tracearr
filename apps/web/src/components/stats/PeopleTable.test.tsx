import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { PersonRow } from '@tracearr/shared';
import { TooltipProvider } from '@/components/ui/tooltip';
import { PeopleTable } from './PeopleTable';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function person(overrides: Partial<PersonRow> & { username: string }): PersonRow {
  return {
    userId: `u-${overrides.username}`,
    serverUserId: `su-${overrides.username}`,
    identityName: overrides.username,
    thumbUrl: null,
    serverId: 'server-1',
    trustScore: null,
    plays: 10,
    watchMs: 5_400_000,
    bytes: 2_000_000_000,
    directPlayRate: 90,
    transcodes: 1,
    transcodeShare: 10,
    requests: 4,
    requestsWatched: 2,
    lastPlayAt: null,
    trend: [0, 1, 2, 3, 4, 5, 6],
    ...overrides,
  };
}

function renderTable(rows: PersonRow[], page = 1) {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <PeopleTable rows={rows} rank="plays" page={page} pageCount={3} onPageChange={vi.fn()} />
      </TooltipProvider>
    </MemoryRouter>
  );
}

function cells(rowIndex: number) {
  const body = screen.getAllByRole('rowgroup')[1]!;
  return within(within(body).getAllByRole('row')[rowIndex]!).getAllByRole('cell');
}

describe('PeopleTable', () => {
  it('tones the direct share at 80 and 50', () => {
    renderTable([
      person({ username: 'high', directPlayRate: 80 }),
      person({ username: 'mid', directPlayRate: 79 }),
      person({ username: 'edge', directPlayRate: 50 }),
      person({ username: 'low', directPlayRate: 49 }),
    ]);

    expect(screen.getByText('80%')).toHaveClass('text-success');
    expect(screen.getByText('79%')).toHaveClass('text-warning');
    expect(screen.getByText('50%')).toHaveClass('text-warning');
    expect(screen.getByText('49%')).toHaveClass('text-destructive');
  });

  it('tones the rounded share the cell shows', () => {
    renderTable([
      person({ username: 'up', directPlayRate: 79.6 }),
      person({ username: 'down', directPlayRate: 49.5 }),
    ]);

    expect(screen.getByText('80%')).toHaveClass('text-success');
    expect(screen.getByText('50%')).toHaveClass('text-warning');
  });

  it('links the person to their user page and numbers ranks across pages', () => {
    renderTable([person({ username: 'alice' })], 2);

    expect(within(cells(0)[1]!).getByRole('link', { name: 'alice' })).toHaveAttribute(
      'href',
      '/users/su-alice'
    );
    expect(cells(0)[0]).toHaveTextContent('21');
  });

  it('pairs requests with watched and leaves a dash when there are none', () => {
    renderTable([
      person({ username: 'alice' }),
      person({ username: 'bob', requests: 0, requestsWatched: 0 }),
    ]);

    expect(cells(0)[6]).toHaveTextContent('4 → 2');
    expect(cells(1)[6]).toHaveTextContent('—');
  });
});
