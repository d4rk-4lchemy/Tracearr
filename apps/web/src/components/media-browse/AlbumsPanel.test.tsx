import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { initI18n } from '@tracearr/translations';
import type { MediaChildEntry } from '@tracearr/shared';
import { AlbumsPanel } from './AlbumsPanel';

beforeAll(async () => {
  await initI18n({ lng: 'en' });
});

function album(overrides: Partial<MediaChildEntry> = {}): MediaChildEntry {
  return {
    id: 'album-1',
    mediaType: 'album',
    title: 'Discovery',
    seasonNumber: null,
    episodeCount: null,
    episodeNumber: null,
    imdbId: null,
    tmdbId: null,
    tvdbId: null,
    showMediaId: null,
    genres: ['Electronic'],
    year: 2001,
    thumbPath: '/library/metadata/77/thumb/1700000000',
    serverId: 'srv-plex',
    addedAt: '2026-09-30T18:12:00.000Z',
    trackCount: 14,
    ...overrides,
  };
}

describe('AlbumsPanel', () => {
  it('lists each album with its year, track count and square art', () => {
    const { container } = render(
      <AlbumsPanel
        albums={[album(), album({ id: 'album-2', title: 'Homework', year: 1997, trackCount: 1 })]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        onSelect={vi.fn()}
      />
    );

    expect(screen.getByRole('heading', { name: 'Albums' })).toBeInTheDocument();
    expect(screen.getByText('Discovery')).toBeInTheDocument();
    expect(screen.getByText('2001 · 14 tracks')).toBeInTheDocument();
    expect(screen.getByText('1997 · 1 track')).toBeInTheDocument();
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toContain('server=srv-plex');
    expect(img?.getAttribute('src')).toContain('width=360&height=360');
    expect(img?.closest('.aspect-square')).not.toBeNull();
  });

  it('shows the same album once per server that holds it', () => {
    render(
      <AlbumsPanel
        albums={[album(), album({ serverId: 'srv-jf' })]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        onSelect={vi.fn()}
      />
    );

    expect(screen.getAllByText('Discovery')).toHaveLength(2);
  });

  it('shows the initials tile when an album has no art', () => {
    const { container } = render(
      <AlbumsPanel
        albums={[album({ thumbPath: null })]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        onSelect={vi.fn()}
      />
    );

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('Di').closest('.aspect-square')).not.toBeNull();
  });

  it('swaps to the initials tile when the art fails to load', () => {
    const { container } = render(
      <AlbumsPanel
        albums={[album()]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        onSelect={vi.fn()}
      />
    );

    fireEvent.error(container.querySelector('img')!);

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('Di')).toBeInTheDocument();
  });

  it('opens an album when its tile is clicked', () => {
    const onSelect = vi.fn();
    render(
      <AlbumsPanel
        albums={[album(), album({ id: 'album-2', title: 'Homework', year: 1997 })]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        onSelect={onSelect}
      />
    );

    screen.getByRole('button', { name: /Homework/ }).click();
    expect(onSelect).toHaveBeenCalledWith('album-2');
  });

  it('says so when the artist has no albums', () => {
    render(
      <AlbumsPanel
        albums={[]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByText('No data available')).toBeInTheDocument();
  });

  it('shows an inline error with retry on failure', () => {
    const onRetry = vi.fn();
    render(
      <AlbumsPanel
        albums={undefined}
        isLoading={false}
        isError
        onRetry={onRetry}
        onSelect={vi.fn()}
      />
    );
    screen.getByRole('button', { name: /try again/i }).click();
    expect(onRetry).toHaveBeenCalled();
  });
});
