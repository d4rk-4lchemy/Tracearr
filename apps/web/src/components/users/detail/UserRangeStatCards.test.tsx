import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserRangeStats } from '@tracearr/shared';
import { UserRangeStatCards } from './UserRangeStatCards';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const stats = {
  plays: 90,
  priorPlays: 100,
  watchMs: 7_200_000,
  finishedRate: 62.4,
  abandonedRate: 12,
  directPlayRate: 80,
  transcodes: 3,
  bytes: 2048,
  avgBitrateKbps: 4500,
  activeDays: 4,
  daysInRange: 30,
  currentStreak: 0,
} as UserRangeStats;

describe('UserRangeStatCards', () => {
  it('pairs plays with the prior range and rounds the rates', () => {
    render(<UserRangeStatCards stats={stats} />);

    expect(screen.getByText('-10%')).toBeInTheDocument();
    expect(screen.getByText('62%')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('pages:userDetail.cards.ofDays')).toBeInTheDocument();
    expect(screen.queryByText(/cards\.streak/)).not.toBeInTheDocument();
  });

  it('leaves the delta and day count out when there is nothing to compare', () => {
    render(<UserRangeStatCards stats={{ ...stats, priorPlays: null, daysInRange: null }} />);

    expect(screen.queryByText('pages:userDetail.cards.vsPrior')).not.toBeInTheDocument();
    expect(screen.queryByText('pages:userDetail.cards.ofDays')).not.toBeInTheDocument();
  });

  it('shows an error with a retry instead of loading forever when the request fails', async () => {
    const onRetry = vi.fn();
    render(
      <UserRangeStatCards stats={undefined} error={new Error('Request failed')} onRetry={onRetry} />
    );

    expect(screen.getByText('Request failed')).toBeInTheDocument();
    expect(screen.queryByTestId('range-stat-cards')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /actions.tryAgain/ }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
