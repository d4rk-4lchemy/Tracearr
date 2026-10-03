import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ServerHealthBanner } from './ServerHealthBanner';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockUseSocket = vi.fn();
vi.mock('@/hooks/useSocket', () => ({ useSocket: () => mockUseSocket() }));

describe('ServerHealthBanner', () => {
  it('says the token was rejected for a single unauthorized server', () => {
    mockUseSocket.mockReturnValue({
      unhealthyServers: [
        { serverId: 's1', serverName: 'Plex', since: new Date(), reason: 'unauthorized' },
      ],
    });
    render(<ServerHealthBanner />);
    expect(screen.getByText('serverHealth.tokenRejected')).toBeInTheDocument();
  });

  it('keeps the unreachable copy when the server gave no reason', () => {
    mockUseSocket.mockReturnValue({
      unhealthyServers: [{ serverId: 's1', serverName: 'Plex', since: new Date() }],
    });
    render(<ServerHealthBanner />);
    expect(screen.getByText('serverHealth.unreachable')).toBeInTheDocument();
  });
});
