import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { GenreRow } from '@tracearr/shared';
import { GenreTrends } from './GenreTrends';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
}));

function row(index: number, priorPlays: number | null): GenreRow {
  return {
    genre: `Genre ${index}`,
    itemCount: 10,
    sizeBytes: 0,
    plays: 90 - index * 10,
    priorPlays,
    watchTimeMs: 0,
    finishedRate: null,
    topViewer: null,
    neverPlayed: { count: 0, bytes: 0 },
    trend: [1, 2, 3, 2, 1, 2, 3],
  };
}

describe('GenreTrends', () => {
  it('shows the eight busiest genres with their plays and change on the prior range', () => {
    const rows = Array.from({ length: 9 }, (_, index) =>
      row(index, index === 0 ? 45 : index === 1 ? null : 140)
    );
    render(<GenreTrends rows={rows} />);

    const cells = screen.getAllByRole('listitem');
    expect(cells).toHaveLength(8);
    expect(screen.queryByText('Genre 8')).toBeNull();
    expect(cells[0]).toHaveTextContent('Genre 0common:count.play:{"count":90}+100%');
    expect(cells[1]).toHaveTextContent('Genre 1common:count.play:{"count":80}—');
    expect(cells[2]).toHaveTextContent('-50%');
  });
});
