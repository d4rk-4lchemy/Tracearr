import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GenreRow } from '@tracearr/shared';
import { ShareBars } from './ShareBars';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
}));

function row(genre: string, itemCount: number, plays: number): GenreRow {
  return {
    genre,
    itemCount,
    sizeBytes: 0,
    plays,
    priorPlays: null,
    watchTimeMs: 0,
    finishedRate: null,
    topViewer: null,
    neverPlayed: { count: 0, bytes: 0 },
    trend: [],
  };
}

const TOTALS = { items: 200, plays: 400, priorPlays: null };

function genreOrder(container: HTMLElement) {
  return Array.from(container.querySelectorAll('li[data-genre]')).map((li) =>
    li.getAttribute('data-genre')
  );
}

describe('ShareBars', () => {
  it('pairs each genre item share with its play share and sorts by plays or by gap', async () => {
    const rows = [row('Drama', 100, 120), row('Horror', 10, 160), row('Documentary', 60, 20)];
    const { container } = render(<ShareBars rows={rows} totals={TOTALS} />);

    expect(genreOrder(container)).toEqual(['Horror', 'Drama', 'Documentary']);
    const horror = container.querySelector('li[data-genre="Horror"]');
    expect(horror).toHaveTextContent('5.0%');
    expect(horror).toHaveTextContent('40.0%');

    await userEvent.click(screen.getByRole('radio', { name: 'pages:media.genres.share.sortGap' }));
    expect(genreOrder(container)).toEqual(['Horror', 'Documentary', 'Drama']);
  });

  it('shows twelve genres until expanded', async () => {
    const rows = Array.from({ length: 15 }, (_, index) => row(`Genre ${index}`, 10, 15 - index));
    const { container } = render(<ShareBars rows={rows} totals={TOTALS} />);

    expect(genreOrder(container)).toHaveLength(12);
    await userEvent.click(
      screen.getByRole('button', { name: 'pages:media.genres.share.showAll:{"count":15}' })
    );
    expect(genreOrder(container)).toHaveLength(15);
    await userEvent.click(screen.getByRole('button', { name: 'common:actions.showLess' }));
    expect(genreOrder(container)).toHaveLength(12);
  });
});
