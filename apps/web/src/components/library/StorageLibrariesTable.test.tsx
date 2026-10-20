import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { StorageLibrariesTable, type StorageLibraryTableRow } from './StorageLibrariesTable';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const GB = 1024 ** 3;

function row(overrides: Partial<StorageLibraryTableRow>): StorageLibraryTableRow {
  return {
    serverId: 'srv-1',
    serverName: 'Den',
    libraryId: '1',
    name: 'Movies',
    mediaType: 'movie',
    itemCount: 812,
    sizeBytes: 500 * GB,
    ...overrides,
  };
}

const ROWS = [
  row({ libraryId: '3', name: 'Music', mediaType: 'artist', itemCount: 456, sizeBytes: 100 * GB }),
  row({}),
  row({ libraryId: '2', name: 'TV Shows', mediaType: 'show', itemCount: 64, sizeBytes: 400 * GB }),
];

function cells(name: string) {
  const tr = screen.getByText(name).closest('tr');
  return tr
    ? within(tr)
        .getAllByRole('cell')
        .map((cell) => cell.textContent)
    : [];
}

describe('StorageLibrariesTable', () => {
  it('lists libraries largest first with shares of the total that add up to 100', () => {
    render(<StorageLibrariesTable rows={ROWS} />);

    const names = screen
      .getAllByRole('row')
      .slice(1)
      .map((tr) => within(tr).getAllByRole('cell')[0]?.textContent);
    expect(names).toEqual(['Movies', 'TV Shows', 'Music']);
    expect(cells('Movies')).toEqual([
      'Movies',
      'common:media.movie_plural',
      '812',
      '500 GB',
      '50.0%',
    ]);
    expect(cells('TV Shows')).toEqual([
      'TV Shows',
      'common:media.tvShows',
      '64',
      '400 GB',
      '40.0%',
    ]);
    expect(cells('Music')).toEqual(['Music', 'common:media.music', '456', '100 GB', '10.0%']);
    expect(screen.queryByText('common:labels.server')).not.toBeInTheDocument();
  });

  it('adds the server column when the libraries come from more than one server', () => {
    render(
      <StorageLibrariesTable
        rows={[row({}), row({ serverId: 'srv-2', serverName: 'Loft', mediaType: 'movies' })]}
      />
    );

    expect(screen.getByText('common:labels.server')).toBeInTheDocument();
    expect(screen.getByText('Loft')).toBeInTheDocument();
    expect(screen.getAllByText('common:media.movie_plural')).toHaveLength(2);
  });

  it('shows a server-native type it does not know as sent', () => {
    render(<StorageLibrariesTable rows={[row({ mediaType: 'photo' })]} />);

    expect(cells('Movies')[1]).toBe('photo');
  });
});
