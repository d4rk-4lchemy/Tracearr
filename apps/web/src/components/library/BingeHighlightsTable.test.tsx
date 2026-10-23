import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { BingeShow } from '@tracearr/shared';
import { BingeHighlightsTable } from './BingeHighlightsTable';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/components/server', () => ({ ServerBadge: () => null }));

const show: BingeShow = {
  showMediaId: 'show-1',
  showTitle: 'Severance',
  primaryServerId: 'srv-1',
  thumbPath: null,
  totalEpisodeWatches: 9,
  consecutiveEpisodes: 6,
  consecutivePct: 66.6,
  avgGapMinutes: 4,
  bingeScore: 72,
  maxEpisodesInOneDay: 5,
  serverIds: ['srv-1'],
};

describe('BingeHighlightsTable', () => {
  it('labels its columns from translations, with Servers only on multi-server', () => {
    const { rerender } = render(<BingeHighlightsTable data={[show]} />);
    for (const key of [
      'library.watch.binge.columns.show',
      'common:media.episode_plural',
      'library.watch.binge.columns.consecutive',
      'library.watch.binge.columns.bingeScore',
      'library.watch.binge.columns.maxPerDay',
    ]) {
      expect(screen.getByRole('columnheader', { name: key })).toBeInTheDocument();
    }
    expect(screen.queryByText('library.watch.binge.columns.servers')).not.toBeInTheDocument();

    rerender(<BingeHighlightsTable data={[show]} isMultiServer />);
    expect(screen.getByText('library.watch.binge.columns.servers')).toBeInTheDocument();
  });

  it('shows the loading and empty states from translations', () => {
    const { rerender } = render(<BingeHighlightsTable data={undefined} isLoading />);
    expect(screen.getByText('common:states.loading')).toBeInTheDocument();

    rerender(<BingeHighlightsTable data={[]} />);
    expect(screen.getByText('library.watch.binge.empty.title')).toBeInTheDocument();
    expect(screen.getByText('library.watch.binge.empty.description')).toBeInTheDocument();
  });

  it('shows the binge score as a number with no tier label', () => {
    render(<BingeHighlightsTable data={[show]} />);
    expect(screen.getByText('72')).toBeInTheDocument();
    expect(screen.queryByText(/Highly Addictive|Bingeable|tiers/)).not.toBeInTheDocument();
  });

  it('keeps two shows with the same title as separate rows', () => {
    render(
      <BingeHighlightsTable
        data={[
          { ...show, bingeScore: 72 },
          { ...show, showMediaId: 'show-2', bingeScore: 41 },
        ]}
      />
    );
    expect(screen.getAllByText('Severance')).toHaveLength(2);
  });
});
