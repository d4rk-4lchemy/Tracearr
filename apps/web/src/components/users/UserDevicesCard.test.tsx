import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { UserDevice } from '@tracearr/shared';
import { UserDevicesCard } from './UserDevicesCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
}));

const device = (overrides: Partial<UserDevice>): UserDevice => ({
  deviceId: 'dev-1',
  playerName: 'Living room',
  product: 'Plex',
  device: null,
  platform: 'Roku',
  sessionCount: 4,
  downloadCount: 0,
  lastSeenAt: new Date('2026-10-19T10:00:00.000Z'),
  locations: [],
  ...overrides,
});

describe('UserDevicesCard', () => {
  it('shows a download count beside the stream count only above zero', () => {
    render(
      <UserDevicesCard
        devices={[
          device({ downloadCount: 2 }),
          device({ deviceId: 'dev-2', playerName: 'Phone', downloadCount: 0 }),
        ]}
        totalSessions={8}
      />
    );

    expect(screen.getAllByText(/common:count.download/)).toHaveLength(1);
    expect(screen.getByText(/common:count.download/)).toHaveTextContent('"count":2');
  });
});
