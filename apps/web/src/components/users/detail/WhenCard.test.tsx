import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WhenCard } from './WhenCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('highcharts', () => ({ default: {} }));
vi.mock('highcharts-react-official', () => ({ HighchartsReact: () => null }));

describe('WhenCard', () => {
  it('puts the hour strip with both peaks under the weekday chart', () => {
    render(
      <WhenCard
        stats={{
          playsByDow: [{ day: 1, name: 'Mon', count: 2 }],
          playsByHour: [{ hour: 20, count: 4 }],
          personPeakHour: 20,
          serverPeakHour: 18,
        }}
      />
    );

    expect(
      screen.getByRole('list', { name: 'pages:userDetail.overview.byHour' })
    ).toBeInTheDocument();
    expect(screen.getByText(/pages:userDetail\.overview\.serverPeak/)).toBeInTheDocument();
  });
});
