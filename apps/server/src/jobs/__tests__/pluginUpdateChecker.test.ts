import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFetchJson, mockEnqueueNotification, mockSseManager, mockGetSettings, mockDbServers } =
  vi.hoisted(() => ({
    mockFetchJson: vi.fn(),
    mockEnqueueNotification: vi.fn().mockResolvedValue('job-id'),
    mockSseManager: {
      setLatestPluginVersion: vi.fn(),
      getPluginVersion: vi.fn().mockReturnValue(null),
      isInFallback: vi.fn().mockReturnValue(false),
    },
    mockGetSettings: vi.fn().mockResolvedValue({
      pluginUpdateCheckEnabled: true,
      pluginManifestUrl: null,
    }),
    mockDbServers: vi.fn().mockResolvedValue([]),
  }));

vi.mock('../../utils/http.js', () => ({ fetchJson: mockFetchJson }));
vi.mock('../notificationQueue.js', () => ({ enqueueNotification: mockEnqueueNotification }));
vi.mock('../../services/sseManager.js', () => ({ sseManager: mockSseManager }));
vi.mock('../../services/settings.js', () => ({ getSettings: mockGetSettings }));
vi.mock('../../db/client.js', () => ({
  db: { select: () => ({ from: mockDbServers }) },
}));

import { runPluginUpdateCheck, _resetNudgeStateForTests } from '../pluginUpdateChecker.js';

const MANIFEST = [
  {
    versions: [{ version: '0.1.0.0' }, { version: '0.2.0.0' }],
  },
];

describe('runPluginUpdateCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetNudgeStateForTests();
    mockSseManager.isInFallback.mockReturnValue(false);
    mockSseManager.getPluginVersion.mockReturnValue(null);
    mockGetSettings.mockResolvedValue({ pluginUpdateCheckEnabled: true, pluginManifestUrl: null });
    mockFetchJson.mockImplementation((url: string) =>
      url.includes('/releases/latest')
        ? { tag_name: 'v0.2.0', html_url: 'https://github.com/example/release' }
        : MANIFEST
    );
    mockDbServers.mockResolvedValue([
      { id: 's1', name: 'JF', type: 'jellyfin' },
      { id: 's2', name: 'Plex', type: 'plex' },
    ]);
  });

  it('publishes the max manifest version to sseManager', async () => {
    await runPluginUpdateCheck();
    expect(mockSseManager.setLatestPluginVersion).toHaveBeenCalledWith(
      'media-server-sse',
      '0.2.0.0'
    );
  });

  it('nudges once for an outdated jellyfin plugin and dedups repeats', async () => {
    mockSseManager.getPluginVersion.mockReturnValue('0.1.0.0');
    await runPluginUpdateCheck();
    await runPluginUpdateCheck();
    const calls = mockEnqueueNotification.mock.calls.filter(
      (c) => c[0].type === 'plugin_update_available'
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]![0].payload.serverId).toBe('s1');
    expect(calls[0]![0].payload.latestVersion).toBe('0.2.0.0');
  });

  it('re-arms when a newer version appears', async () => {
    mockSseManager.getPluginVersion.mockReturnValue('0.1.0.0');
    await runPluginUpdateCheck();
    mockFetchJson.mockImplementation((url: string) =>
      url.includes('/releases/latest')
        ? { tag_name: 'v0.2.0', html_url: 'https://github.com/example/release' }
        : [{ versions: [{ version: '0.3.0.0' }] }]
    );
    await runPluginUpdateCheck();
    const calls = mockEnqueueNotification.mock.calls.filter(
      (c) => c[0].type === 'plugin_update_available'
    );
    expect(calls).toHaveLength(2);
  });

  it('does not nudge an up to date plugin', async () => {
    mockSseManager.getPluginVersion.mockReturnValue('0.2.0.0');
    await runPluginUpdateCheck();
    expect(mockEnqueueNotification).not.toHaveBeenCalled();
  });

  it('never nudges plex servers', async () => {
    mockDbServers.mockResolvedValue([{ id: 's2', name: 'Plex', type: 'plex' }]);
    await runPluginUpdateCheck();
    expect(mockEnqueueNotification).not.toHaveBeenCalled();
  });

  it('skips servers in fallback (no live plugin connection)', async () => {
    mockSseManager.isInFallback.mockReturnValue(true);
    mockSseManager.getPluginVersion.mockReturnValue('0.1.0.0');
    await runPluginUpdateCheck();
    expect(mockEnqueueNotification).not.toHaveBeenCalled();
  });

  it('checks and notifies for an outdated Dispatcharr Metrics plugin', async () => {
    mockSseManager.getPluginVersion.mockReturnValue('0.1.0');
    mockDbServers.mockResolvedValue([{ id: 's3', name: 'Dispatcharr', type: 'dispatcharr' }]);

    await runPluginUpdateCheck();

    expect(mockSseManager.setLatestPluginVersion).toHaveBeenCalledWith(
      'dispatcharr-metrics',
      '0.2.0'
    );
    expect(mockEnqueueNotification).toHaveBeenCalledWith({
      type: 'plugin_update_available',
      payload: {
        serverId: 's3',
        serverName: 'Dispatcharr',
        serverType: 'dispatcharr',
        installedVersion: '0.1.0',
        latestVersion: '0.2.0',
        downloadUrl: 'https://github.com/example/release',
      },
    });
  });

  it('does not flag Dispatcharr 1.0.9 as older than release 1.0.1', async () => {
    mockSseManager.getPluginVersion.mockReturnValue('1.0.9');
    mockFetchJson.mockImplementation((url: string) =>
      url.includes('/releases/latest')
        ? { tag_name: 'v1.0.1', html_url: 'https://github.com/example/release' }
        : MANIFEST
    );
    mockDbServers.mockResolvedValue([{ id: 's3', name: 'Dispatcharr', type: 'dispatcharr' }]);

    await runPluginUpdateCheck();

    expect(mockEnqueueNotification).not.toHaveBeenCalled();
  });

  it('continues checking Dispatcharr when the SSE manifest fails', async () => {
    mockFetchJson.mockImplementation((url: string) => {
      if (url.includes('/releases/latest')) {
        return { tag_name: 'v0.2.0', html_url: 'https://github.com/example/release' };
      }
      return Promise.reject(new Error('manifest unavailable'));
    });
    mockSseManager.getPluginVersion.mockReturnValue('0.1.0');
    mockDbServers.mockResolvedValue([{ id: 's3', name: 'Dispatcharr', type: 'dispatcharr' }]);

    await runPluginUpdateCheck();

    expect(mockEnqueueNotification).toHaveBeenCalledOnce();
  });

  it('fails soft on manifest fetch error', async () => {
    mockFetchJson.mockRejectedValue(new Error('network'));
    await expect(runPluginUpdateCheck()).resolves.toBeUndefined();
    expect(mockSseManager.setLatestPluginVersion).not.toHaveBeenCalled();
    expect(mockEnqueueNotification).not.toHaveBeenCalled();
  });

  it('does nothing when disabled', async () => {
    mockGetSettings.mockResolvedValue({ pluginUpdateCheckEnabled: false, pluginManifestUrl: null });
    await runPluginUpdateCheck();
    expect(mockFetchJson).not.toHaveBeenCalled();
  });
});
