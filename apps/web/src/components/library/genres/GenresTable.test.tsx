import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GenreRow } from '@tracearr/shared';
import { GenresTable } from './GenresTable';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const ROWS: GenreRow[] = [
  {
    genre: 'Thriller',
    itemCount: 32,
    sizeBytes: 120 * 1024 ** 3,
    plays: 18,
    priorPlays: 12,
    watchTimeMs: 26 * 3_600_000,
    finishedRate: 72,
    topViewer: {
      userId: 'u-1',
      serverUserId: 'su-1',
      name: 'Priya',
      thumbUrl: null,
      serverId: 'srv-1',
      share: 55.6,
    },
    neverPlayed: { count: 4, bytes: 14 * 1024 ** 3 },
    trend: [2, 3, 1, 4, 2, 3, 3],
  },
  {
    genre: 'Western',
    itemCount: 6,
    sizeBytes: 20 * 1024 ** 3,
    plays: 0,
    priorPlays: null,
    watchTimeMs: 0,
    finishedRate: null,
    topViewer: null,
    neverPlayed: { count: 0, bytes: 0 },
    trend: [0, 0, 0, 0, 0, 0, 0],
  },
];

function cells(name: string) {
  const row = screen.getByText(name).closest('tr');
  return row
    ? within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent)
    : [];
}

describe('GenresTable', () => {
  it('renders every column and a dash where a genre has no baseline', () => {
    render(<GenresTable rows={ROWS} onSelect={vi.fn()} />);

    expect(cells('Thriller')).toEqual([
      'Thriller',
      '32',
      '120 GB',
      '18',
      '+50%',
      '1d 2h',
      '72%',
      'Priya · 56%',
      '4 · 14 GB',
    ]);
    expect(cells('Western')).toEqual(['Western', '6', '20 GB', '0', '—', '0m', '—', '—', '0']);
  });

  it('opens a genre on row click', async () => {
    const onSelect = vi.fn();
    render(<GenresTable rows={ROWS} onSelect={onSelect} />);

    await userEvent.click(screen.getByText('Western'));
    expect(onSelect).toHaveBeenCalledWith('Western');
  });
});
