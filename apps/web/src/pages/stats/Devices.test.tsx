import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { StatsDevices } from './Devices';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/hooks/queries', () => ({
  useDeviceCompatibility: vi.fn(),
  useDeviceCompatibilityMatrix: vi.fn(),
  useDeviceHealth: vi.fn(),
  useTranscodeHotspots: vi.fn(),
}));

vi.mock('@/hooks/useServer', () => ({
  useServer: vi.fn(),
}));

import {
  useDeviceCompatibility,
  useDeviceCompatibilityMatrix,
  useDeviceHealth,
  useTranscodeHotspots,
} from '@/hooks/queries';
import { useServer } from '@/hooks/useServer';

const idle = {
  data: undefined,
  isLoading: true,
  isError: false,
  error: null,
  refetch: vi.fn(),
};

describe('StatsDevices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useServer).mockReturnValue({
      selectedServerIds: ['server-1'],
      selectedServers: [{ id: 'server-1', name: 'Server One', color: '#ff0000' }],
      isMultiServer: false,
    } as unknown as ReturnType<typeof useServer>);
    vi.mocked(useDeviceCompatibility).mockReturnValue(
      idle as unknown as ReturnType<typeof useDeviceCompatibility>
    );
    vi.mocked(useDeviceHealth).mockReturnValue(
      idle as unknown as ReturnType<typeof useDeviceHealth>
    );
    vi.mocked(useTranscodeHotspots).mockReturnValue(
      idle as unknown as ReturnType<typeof useTranscodeHotspots>
    );
    vi.mocked(useDeviceCompatibilityMatrix).mockReturnValue({
      byServer: new Map(),
      isLoading: true,
    } as unknown as ReturnType<typeof useDeviceCompatibilityMatrix>);
  });

  it('links to people ranked by transcodes with the current range instead of a user table', () => {
    render(
      <MemoryRouter initialEntries={['/stats/devices?period=week']}>
        <TooltipProvider>
          <StatsDevices />
        </TooltipProvider>
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: /statsUsers.openPeople/ })).toHaveAttribute(
      'href',
      '/stats/people?rank=transcodes&period=week'
    );
    expect(screen.queryByText('devices.topTranscodingUsers')).not.toBeInTheDocument();
    expect(screen.queryByText('common:labels.user')).not.toBeInTheDocument();
  });
});
