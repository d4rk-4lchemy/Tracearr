import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WhereCard } from './WhereCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('WhereCard', () => {
  it('lists devices and locations for the range and opens the all-time lists', async () => {
    render(
      <WhereCard
        devices={[
          {
            device: 'Apple TV',
            platform: 'tvOS',
            sessions: 4,
            directPlayRate: 75,
            lastSeenAt: null,
          },
        ]}
        locations={[
          {
            city: 'Denver',
            region: 'Colorado',
            country: 'US',
            sessions: 3,
            isLocal: false,
            lastSeenAt: null,
          },
        ]}
        localShare={12.5}
        allDevices={[]}
        allLocations={[
          {
            city: 'Denver',
            region: 'Colorado',
            country: 'US',
            isLocal: false,
            lat: null,
            lon: null,
            sessionCount: 3,
            lastSeenAt: new Date(),
            ipAddresses: [],
          },
        ]}
        totalSessions={3}
      />
    );

    expect(screen.getByText('Apple TV')).toBeInTheDocument();
    expect(screen.getByText(/Denver/)).toBeInTheDocument();
    expect(screen.getByText('pages:userDetail.overview.localShare')).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: 'pages:userDetail.overview.viewAllDevices' })
    );
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});
