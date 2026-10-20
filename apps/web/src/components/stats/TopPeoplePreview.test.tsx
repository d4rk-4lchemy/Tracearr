import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { PersonRow } from '@tracearr/shared';
import { TopPeoplePreview } from './TopPeoplePreview';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function person(username: string, overrides: Partial<PersonRow> = {}): PersonRow {
  return {
    userId: `u-${username}`,
    serverUserId: `su-${username}`,
    username,
    identityName: username,
    thumbUrl: null,
    serverId: 'server-1',
    trustScore: null,
    plays: 10,
    watchMs: 5_400_000,
    bytes: 2_000_000_000,
    directPlayRate: 90,
    transcodes: 1,
    transcodeShare: 10,
    requests: 0,
    requestsWatched: 0,
    lastPlayAt: null,
    trend: [0, 0, 0, 0, 0, 0, 0],
    ...overrides,
  };
}

function renderPreview(rows: PersonRow[]) {
  return render(
    <MemoryRouter>
      <TopPeoplePreview
        rows={rows}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
        rankHref="/stats/people?rank=data&period=week"
        title="Top title"
        caption="Top caption"
      />
    </MemoryRouter>
  );
}

function bodyRows() {
  const body = screen.getAllByRole('rowgroup')[1];
  if (!body) throw new Error('no table body');
  return within(body).getAllByRole('row');
}

describe('TopPeoplePreview', () => {
  it('shows at most five people', () => {
    renderPreview(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name) => person(name)));

    expect(bodyRows()).toHaveLength(5);
    expect(screen.queryByText('f')).not.toBeInTheDocument();
  });

  it('links each person to their user page', () => {
    renderPreview([person('alice')]);

    expect(screen.getByRole('link', { name: 'alice' })).toHaveAttribute('href', '/users/su-alice');
  });

  it('links to the full ranking', () => {
    renderPreview([person('alice')]);

    expect(screen.getByText('Top title')).toBeInTheDocument();
    expect(screen.getByText('Top caption')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /statsUsers.openPeople/ })).toHaveAttribute(
      'href',
      '/stats/people?rank=data&period=week'
    );
  });

  it('shows the empty state when nobody played in the range', () => {
    renderPreview([person('idle', { plays: 0, bytes: 0, directPlayRate: null })]);

    expect(screen.getByText('common:empty.noUserData')).toBeInTheDocument();
    expect(screen.queryByText('idle')).not.toBeInTheDocument();
  });
});
