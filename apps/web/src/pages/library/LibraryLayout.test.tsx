import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { LibraryLayout } from './LibraryLayout';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const auth = vi.hoisted(() => ({ role: 'owner' }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { role: auth.role } }) }));

vi.mock('@/hooks/useTimeRange', () => ({
  useTimeRange: () => ({ value: { period: 'month' }, setValue: vi.fn(), apiParams: {} }),
}));

vi.mock('@/components/ui/time-range-picker', () => ({
  TimeRangePicker: () => <div>range picker</div>,
}));

function renderLayout(path = '/library') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="library" element={<LibraryLayout />}>
          <Route index element={<p>overview page</p>} />
          <Route path="genres" element={<p>genres page</p>} />
          <Route path="quality" element={<p>quality page</p>} />
          <Route path="storage" element={<p>storage page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

function tabNames() {
  const nav = screen.getByRole('navigation', { name: 'pages:library.title' });
  return within(nav)
    .getAllByRole('link')
    .map((link) => link.textContent);
}

describe('LibraryLayout', () => {
  beforeEach(() => {
    auth.role = 'owner';
  });

  it('renders Overview and Genres as a two-tab bar for a member, with no range picker', () => {
    auth.role = 'member';
    renderLayout();

    expect(tabNames()).toEqual(['nav:overview', 'nav:mediaGenres']);
    expect(screen.queryByText('range picker')).toBeNull();
    expect(screen.getByText('overview page')).toBeInTheDocument();
  });

  it('renders five tabs and the picker for staff', () => {
    renderLayout();

    expect(screen.getByRole('heading', { level: 1, name: 'pages:library.title' })).toHaveClass(
      'sr-only'
    );
    expect(tabNames()).toEqual([
      'nav:overview',
      'nav:mediaGenres',
      'nav:quality',
      'nav:storage',
      'nav:watch',
    ]);
    expect(screen.getByRole('banner')).toContainElement(screen.getByText('range picker'));
  });

  it('shows the media type control on Genres and Quality with their own options, nowhere else', () => {
    const radioNames = () => screen.getAllByRole('radio').map((radio) => radio.textContent);
    const genres = renderLayout('/library/genres');
    expect(screen.getByText('genres page')).toBeInTheDocument();
    expect(screen.getByText('range picker')).toBeInTheDocument();
    expect(radioNames()).toEqual([
      'common:media.movie_plural',
      'common:media.tvShows',
      'common:media.artist_plural',
    ]);
    genres.unmount();

    const quality = renderLayout('/library/quality?type=artist');
    expect(radioNames()).toEqual([
      'pages:library.quality.all',
      'common:media.movie_plural',
      'common:media.tvShows',
    ]);
    expect(screen.getByRole('radio', { name: 'pages:library.quality.all' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    quality.unmount();

    renderLayout('/library/storage');
    expect(screen.getByText('range picker')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('shows a member the picker on Genres but not on Overview', () => {
    auth.role = 'member';
    const { unmount } = renderLayout('/library/genres');
    expect(screen.getByText('range picker')).toBeInTheDocument();
    unmount();

    renderLayout('/library');
    expect(screen.queryByText('range picker')).toBeNull();
  });

  it('carries the media type and the range on every tab link', () => {
    renderLayout('/library/genres?type=show&period=week&genre=Drama');

    const nav = screen.getByRole('navigation', { name: 'pages:library.title' });
    expect(within(nav).getByRole('link', { name: 'nav:storage' })).toHaveAttribute(
      'href',
      '/library/storage?period=week&type=show'
    );
  });
});
