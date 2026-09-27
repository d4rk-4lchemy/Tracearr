import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { VersionInfo } from '@tracearr/shared';
import { UpdateDialog } from './UpdateDialog';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function version(tag: string): VersionInfo {
  const latest: NonNullable<VersionInfo['fork']['latest']> = {
    version: '2.5.1',
    upstreamVersion: '2.5.1',
    forkRevision: 2,
    forkVersion: '2.5.1-r2',
    tag: 'v2.5.1-r2',
    releaseUrl: 'https://github.com/d4rk-4lchemy/Tracearr/releases/tag/v2.5.1-r2',
    publishedAt: '2026-09-27T00:00:00Z',
    isPrerelease: false,
    releaseName: null,
    releaseNotes: null,
    upgradeWarnings: [],
  };

  return {
    current: {
      version: '2.5.1',
      upstreamVersion: '2.5.1',
      forkRevision: 1,
      forkVersion: '2.5.1-r1',
      forkReleaseTag: 'v2.5.1-r1',
      forkRepo: 'd4rk-4lchemy/Tracearr',
      imageRepo: 'ghcr.io/d4rk-4lchemy/distracearr',
      tag,
      commit: null,
      buildDate: null,
      isPrerelease: false,
    },
    fork: { latest, updateAvailable: true },
    upstream: { latest: null, updateAvailable: false },
    recommended: { kind: 'fork-update', target: latest },
    lastChecked: null,
  };
}

describe('UpdateDialog image commands', () => {
  it.each([
    ['v2.5.1-r1', 'latest'],
    ['supervised-2.5.1-r1', 'supervised'],
  ])('shows both registries for %s', (currentTag, updateTag) => {
    render(<UpdateDialog open onOpenChange={vi.fn()} version={version(currentTag)} />);

    expect(
      screen.getByText(`docker pull ghcr.io/d4rk-4lchemy/distracearr:${updateTag}`)
    ).toBeInTheDocument();
    expect(
      screen.getByText(`docker pull darkalchemy2137/distracearr:${updateTag}`)
    ).toBeInTheDocument();
  });
});
