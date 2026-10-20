import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { LibraryLayout } from './LibraryLayout';
import { LibraryQuality } from './Quality';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockUseLibraryQuality = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/queries', () => ({
  useLibraryQuality: mockUseLibraryQuality,
  useLibraryStatus: () => ({ byServer: new Map(), isLoading: false }),
}));

vi.mock('@/hooks/useServer', () => ({
  useServer: () => ({
    mediaLibraryServers: [{ id: 'srv-1' }],
    mediaLibraryServerIds: ['srv-1'],
    selectedServers: [{ id: 'srv-1' }],
    selectedServerIds: ['srv-1'],
    isMultiServer: false,
  }),
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { role: 'owner' } }) }));
vi.mock('@/components/ui/time-range-picker', () => ({ TimeRangePicker: () => null }));

vi.mock('@/components/library', () => ({
  ErrorState: () => null,
  LibraryEmptyState: () => null,
  CodecDistributionSection: () => null,
  ResolutionDistributionSection: () => null,
}));
vi.mock('@/components/charts', () => ({ QualityTimelineChart: () => null }));
vi.mock('@/components/server', () => ({ PerServerCardGrid: () => null }));

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="library" element={<LibraryLayout />}>
          <Route path="quality" element={<LibraryQuality />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('LibraryQuality', () => {
  beforeEach(() => {
    mockUseLibraryQuality.mockReturnValue({ data: undefined, isLoading: false, isError: false });
  });

  it('asks for a preset by its period token alone', () => {
    renderAt('/library/quality?period=week');
    expect(mockUseLibraryQuality).toHaveBeenLastCalledWith(
      'srv-1',
      '7d',
      'all',
      true,
      undefined,
      undefined
    );
  });

  it('passes a custom range to the query as its start and end', () => {
    renderAt('/library/quality?period=custom&from=2026-03-02&to=2026-03-05');
    expect(mockUseLibraryQuality).toHaveBeenLastCalledWith(
      'srv-1',
      '30d',
      'all',
      true,
      '2026-03-02T00:00:00.000Z',
      '2026-03-06T00:00:00.000Z'
    );
  });

  it('offers All, Movies and TV Shows and asks for movies once Movies is picked', async () => {
    renderAt('/library/quality');
    expect(screen.getAllByRole('radio').map((radio) => radio.textContent)).toEqual([
      'pages:library.quality.all',
      'common:media.movie_plural',
      'common:media.tvShows',
    ]);

    await userEvent.click(screen.getByRole('radio', { name: 'common:media.movie_plural' }));

    expect(mockUseLibraryQuality).toHaveBeenLastCalledWith(
      'srv-1',
      '30d',
      'movie',
      true,
      undefined,
      undefined
    );
  });

  it('reads the type from the URL and treats artists as all', () => {
    const show = renderAt('/library/quality?type=show');
    expect(mockUseLibraryQuality).toHaveBeenLastCalledWith(
      'srv-1',
      '30d',
      'show',
      true,
      undefined,
      undefined
    );
    show.unmount();

    renderAt('/library/quality?type=artist');
    expect(mockUseLibraryQuality).toHaveBeenLastCalledWith(
      'srv-1',
      '30d',
      'all',
      true,
      undefined,
      undefined
    );
  });
});
