import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { RequesterFollowThrough } from '@tracearr/shared';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const auth = vi.hoisted(() => ({ role: 'owner' }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { role: auth.role } }) }));

vi.mock('@/components/requests/RequesterCell', () => ({
  RequesterCell: () => <span>requester</span>,
}));

import { RequesterFollowThroughTable } from './RequesterFollowThroughTable';

function row(watchedByOthers?: number): RequesterFollowThrough {
  return {
    requester: { serverUserId: 'su1', serverId: 's1', username: 'dana', identityName: null },
    requested: 4,
    landed: 3,
    watched: 2,
    medianWaitMs: null,
    ...(watchedByOthers !== undefined && { watchedByOthers }),
  } as RequesterFollowThrough;
}

function renderTable(rows: RequesterFollowThrough[]) {
  return render(
    <MemoryRouter>
      <RequesterFollowThroughTable
        rows={rows}
        total={rows.length}
        page={1}
        pageSize={10}
        onPageChange={vi.fn()}
        sorting={[]}
        onSortingChange={vi.fn()}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
      />
    </MemoryRouter>
  );
}

const header = 'pages:requests.followThrough.watchedByOthers';

describe('RequesterFollowThroughTable', () => {
  it('shows the watched-by-others column to the owner', () => {
    auth.role = 'owner';
    renderTable([row(5)]);

    expect(screen.getByText(header)).toBeInTheDocument();
  });

  it('drops the column for a member when the server sends no counts', () => {
    auth.role = 'member';
    renderTable([row()]);

    expect(screen.queryByText(header)).toBeNull();
  });

  it('keeps it for a member once the owner shows members server activity', () => {
    auth.role = 'member';
    renderTable([row(5)]);

    expect(screen.getByText(header)).toBeInTheDocument();
  });
});
