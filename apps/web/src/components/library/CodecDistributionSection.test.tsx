import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { CodecDistributionSection } from './CodecDistributionSection';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockUseLibraryCodecs = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/queries', () => ({ useLibraryCodecs: mockUseLibraryCodecs }));
vi.mock('@/components/server', () => ({ PerServerCardGrid: () => null }));
vi.mock('@/components/charts', () => ({
  TopListChart: ({ valueLabel }: { valueLabel?: string }) => (
    <div data-testid="top-list-chart">{valueLabel}</div>
  ),
}));

const breakdown = { codecs: [{ codec: 'h264', count: 4, percentage: 100 }], total: 4 };

function renderSection() {
  return render(
    <MemoryRouter>
      <CodecDistributionSection serverId="srv-1" />
    </MemoryRouter>
  );
}

describe('CodecDistributionSection', () => {
  beforeEach(() => {
    mockUseLibraryCodecs.mockReturnValue({
      isLoading: false,
      data: { video: breakdown, audio: breakdown, channels: breakdown, music: breakdown },
    });
  });

  it('titles the card, tabs and charts from translations', () => {
    renderSection();

    expect(screen.getByText('library.quality.codec.title')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /library\.quality\.codec\.moviesAndTv/ })).toBeVisible();
    expect(screen.getByRole('tab', { name: /common:media\.music/ })).toBeVisible();
    expect(screen.getByText('library.quality.codec.videoCodecs')).toBeInTheDocument();
    expect(screen.getByText('library.quality.codec.audioCodecs')).toBeInTheDocument();
    expect(screen.getByText('library.quality.codec.audioChannels')).toBeInTheDocument();
    expect(screen.getAllByTestId('top-list-chart')[0]).toHaveTextContent('common:labels.items');
  });

  it('explains an empty library from translations', () => {
    const empty = { codecs: [], total: 0 };
    mockUseLibraryCodecs.mockReturnValue({
      isLoading: false,
      data: { video: empty, audio: empty, channels: empty, music: empty },
    });
    renderSection();

    expect(screen.getByText('library.quality.codec.noVideo.title')).toBeInTheDocument();
    expect(screen.getByText('library.quality.codec.noVideo.description')).toBeInTheDocument();
  });
});
