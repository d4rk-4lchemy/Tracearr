import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { HistoryFilterOptions } from '@tracearr/shared';
import { HistoryFiltersBar, DEFAULT_COLUMN_VISIBILITY } from './HistoryFilters';
import type { HistoryFilters } from '@/hooks/queries/useHistory';

const mergedPerson = {
  id: 'su-representative',
  username: 'alice_plex',
  thumbUrl: null,
  serverId: 'server-1',
  identityName: 'Alice',
  serverUserIds: ['su-representative', 'su-secondary'],
};

const soloPerson = {
  id: 'su-bob',
  username: 'bob',
  thumbUrl: null,
  serverId: 'server-1',
  identityName: null,
  serverUserIds: ['su-bob'],
};

const filterOptions: HistoryFilterOptions = {
  platforms: [],
  products: [],
  devices: [],
  countries: [],
  cities: [],
  users: [mergedPerson, soloPerson],
};

function renderBar(
  filters: HistoryFilters,
  overrides: Partial<HistoryFilters> = {},
  isFetching?: boolean
) {
  const onFiltersChange = vi.fn();
  const view = render(
    <HistoryFiltersBar
      filters={{ ...filters, ...overrides }}
      onFiltersChange={onFiltersChange}
      filterOptions={filterOptions}
      columnVisibility={DEFAULT_COLUMN_VISIBILITY}
      onColumnVisibilityChange={vi.fn()}
      isFetching={isFetching}
    />
  );
  return { onFiltersChange, container: view.container };
}

describe('HistoryFiltersBar', () => {
  it('shows one chip for a merged person even though both of their account ids are selected', () => {
    renderBar({ serverUserIds: ['su-representative', 'su-secondary'] });

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByText('Unknown')).not.toBeInTheDocument();
  });

  it('toggling the merged person on adds both of their account ids to the filter', async () => {
    const { onFiltersChange } = renderBar({});

    await userEvent.click(screen.getByRole('button', { name: /filters/i }));
    await waitFor(() => expect(screen.getByText('Users')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Users'));
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Alice'));

    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({
        serverUserIds: expect.arrayContaining(['su-representative', 'su-secondary']),
      })
    );
    const calls = onFiltersChange.mock.calls;
    const lastCall = calls[calls.length - 1]?.[0] as HistoryFilters;
    expect(lastCall.serverUserIds).toHaveLength(2);
  });

  it('toggling an already-selected merged person off removes both of their account ids', async () => {
    const { onFiltersChange } = renderBar({
      serverUserIds: ['su-representative', 'su-secondary', 'su-bob'],
    });

    await userEvent.click(screen.getByRole('button', { name: /filters/i }));
    await waitFor(() => expect(screen.getByText('Users')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Users'));
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Alice'));

    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ serverUserIds: ['su-bob'] })
    );
  });

  it('shows the refresh indicator while a background fetch is in flight', () => {
    const { container } = renderBar({}, {}, true);

    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('hides the refresh indicator once no fetch is in flight', () => {
    const { container } = renderBar({}, {}, false);

    expect(container.querySelector('.animate-spin')).not.toBeInTheDocument();
  });
});
