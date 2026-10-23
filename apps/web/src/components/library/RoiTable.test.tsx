import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { RoiItem, RoiResponse, Server } from '@tracearr/shared';
import { RoiTable } from './RoiTable';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
}));

vi.mock('@/components/server', () => ({
  ServerColumnCell: ({ server }: { server: Server }) => <span>{server.name}</span>,
}));

const servers = [
  { id: 'srv-1', name: 'Den' },
  { id: 'srv-2', name: 'Attic' },
] as Server[];

const item: RoiItem = {
  id: 'item-1',
  mediaId: 'media-1',
  serverId: 'srv-1',
  serverName: 'Den',
  serverIds: ['srv-1', 'srv-2'],
  title: 'Harbor Lights',
  mediaType: 'show',
  year: 2019,
  fileSizeBytes: 3 * 1024 ** 3,
  fileSizeGb: 3,
  watchCount: 3,
  totalWatchHours: 2.25,
  watchHoursPerGb: 0.75,
  lastWatchedAt: '2026-10-20',
};

const data: RoiResponse = {
  items: [item],
  summary: { totalItems: 1, totalStorageGb: 3, totalWatchHours: 2.25, avgWatchHoursPerGb: 0.75 },
  pagination: { page: 1, pageSize: 10, total: 1 },
};

function renderTable(isMultiServer: boolean) {
  return render(
    <RoiTable
      data={data}
      page={1}
      onPageChange={vi.fn()}
      sortBy="watch_hours_per_gb"
      sortOrder="desc"
      onSortChange={vi.fn()}
      mediaType="all"
      onMediaTypeChange={vi.fn()}
      isMultiServer={isMultiServer}
      selectedServers={servers}
    />
  );
}

describe('RoiTable', () => {
  it('shows a chip for each server holding the title in a multi-server view', () => {
    renderTable(true);

    expect(screen.getByRole('columnheader', { name: 'common:labels.server' })).toBeInTheDocument();
    expect(screen.getByText('Den')).toBeInTheDocument();
    expect(screen.getByText('Attic')).toBeInTheDocument();
  });

  it('hides the server column in a single-server view', () => {
    renderTable(false);

    expect(screen.queryByRole('columnheader', { name: 'common:labels.server' })).toBeNull();
    expect(screen.queryByText('Den')).toBeNull();
    expect(screen.getByText('Oct 20, 2026')).toBeInTheDocument();
  });
});
