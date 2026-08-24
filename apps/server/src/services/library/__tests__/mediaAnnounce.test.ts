/**
 * The library-sync diff behind the two media triggers: which rows count as added,
 * which count as an upgrade, and how many of them one sync run may announce.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaQuality } from '../../automations/types.js';

const mockHasMediaListeners = vi.fn();
const mockDispatchMediaAdded = vi.fn();
const mockDispatchMediaUpgraded = vi.fn();
vi.mock('../../automations/events/producers.js', () => ({
  hasMediaListeners: (...args: unknown[]) => mockHasMediaListeners(...args),
  dispatchMediaAdded: (...args: unknown[]) => mockDispatchMediaAdded(...args),
  dispatchMediaUpgraded: (...args: unknown[]) => mockDispatchMediaUpgraded(...args),
}));

import {
  MEDIA_ANNOUNCE_CAP,
  announceMediaChanges,
  createAnnounceRun,
  createMediaAnnounce,
  diffMediaChanges,
  type PriorMediaRow,
  type SyncedMediaRow,
} from '../mediaAnnounce.js';

const server = { id: 'server-1', name: 'Basement', type: 'plex' as const };
const firstSeen = new Date('2026-08-21T12:00:00Z');
const earlier = new Date('2026-01-01T00:00:00Z');

const quality = (overrides: Partial<MediaQuality> = {}): MediaQuality => ({
  resolution: '1080p',
  dynamicRange: 'sdr',
  videoCodec: 'H264',
  audioCodec: 'AC3',
  audioChannels: 6,
  fileSize: 8_000_000_000,
  ...overrides,
});

const synced = (overrides: Partial<SyncedMediaRow> = {}): SyncedMediaRow => ({
  id: 'item-1',
  ratingKey: 'rk-1',
  firstSeenAt: earlier,
  title: 'Cars',
  grandparentTitle: null,
  mediaType: 'movie',
  year: 2006,
  quality: quality(),
  ...overrides,
});

const priorOf = (rows: Array<[string, PriorMediaRow]>) => new Map(rows);

describe('diffMediaChanges', () => {
  it('reads a row first seen in this call as an addition', () => {
    const rows = [synced({ firstSeenAt: firstSeen })];

    const { changes } = diffMediaChanges({ rows, prior: priorOf([]), firstSeen, budget: 10 });

    expect(changes).toEqual([{ kind: 'added', row: rows[0] }]);
  });

  it('reads a changed quality column as an upgrade and names the fields that moved', () => {
    const rows = [synced({ quality: quality({ resolution: '4k', fileSize: 40_000_000_000 }) })];
    const prior = priorOf([['rk-1', { quality: quality() }]]);

    const { changes } = diffMediaChanges({ rows, prior, firstSeen, budget: 10 });

    expect(changes).toEqual([
      {
        kind: 'upgraded',
        row: rows[0],
        from: quality(),
        changed: ['resolution', 'fileSize'],
      },
    ]);
  });

  it('announces a drop too: the trigger is named for the common case', () => {
    const rows = [synced({ quality: quality({ resolution: '720p' }) })];
    const prior = priorOf([['rk-1', { quality: quality() }]]);

    const { changes } = diffMediaChanges({ rows, prior, firstSeen, budget: 10 });

    expect(changes[0]).toMatchObject({ kind: 'upgraded', changed: ['resolution'] });
  });

  it('ignores a column arriving and a column disappearing', () => {
    const appeared = [synced({ quality: quality({ dynamicRange: 'hdr10' }) })];
    const appearedPrior = priorOf([['rk-1', { quality: quality({ dynamicRange: null }) }]]);
    expect(
      diffMediaChanges({ rows: appeared, prior: appearedPrior, firstSeen, budget: 10 }).changes
    ).toEqual([]);

    const vanished = [synced({ quality: quality({ dynamicRange: null }) })];
    const vanishedPrior = priorOf([['rk-1', { quality: quality({ dynamicRange: 'hdr10' }) }]]);
    expect(
      diffMediaChanges({ rows: vanished, prior: vanishedPrior, firstSeen, budget: 10 }).changes
    ).toEqual([]);
  });

  it('says nothing about an identical signature or a revived tombstone', () => {
    const rows = [synced()];
    const prior = priorOf([['rk-1', { quality: quality() }]]);

    expect(diffMediaChanges({ rows, prior, firstSeen, budget: 10 }).changes).toEqual([]);
  });

  it('stops at the budget and counts what it dropped', () => {
    const rows = Array.from({ length: MEDIA_ANNOUNCE_CAP + 1 }, (_, index) =>
      synced({ id: `item-${index}`, ratingKey: `rk-${index}`, firstSeenAt: firstSeen })
    );

    const { changes, suppressed } = diffMediaChanges({
      rows,
      prior: priorOf([]),
      firstSeen,
      budget: MEDIA_ANNOUNCE_CAP,
    });

    expect(changes).toHaveLength(MEDIA_ANNOUNCE_CAP);
    expect(suppressed).toBe(1);
  });
});

describe('createMediaAnnounce', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasMediaListeners.mockResolvedValue(true);
  });

  it('announces nothing on a first sync, and never probes the library when nothing listens', async () => {
    const isFirstSync = vi.fn().mockResolvedValue(true);
    const run = createAnnounceRun(server);

    expect(await createMediaAnnounce({ run, libraryName: 'Movies', isFirstSync })).toBeNull();
    expect(isFirstSync).toHaveBeenCalledOnce();

    mockHasMediaListeners.mockResolvedValue(false);
    expect(await createMediaAnnounce({ run, libraryName: 'Movies', isFirstSync })).toBeNull();
    expect(isFirstSync).toHaveBeenCalledOnce();
  });

  it('shares one budget across every library of the run', async () => {
    const run = createAnnounceRun(server);
    const isFirstSync = vi.fn().mockResolvedValue(false);

    const movies = await createMediaAnnounce({ run, libraryName: 'Movies', isFirstSync });
    const shows = await createMediaAnnounce({ run, libraryName: 'Shows', isFirstSync });

    expect(movies?.libraryName).toBe('Movies');
    expect(shows?.budget).toBe(movies?.budget);
    expect(run.budget.remaining).toBe(MEDIA_ANNOUNCE_CAP);
  });
});

describe('announceMediaChanges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const announceFor = () => ({
    server,
    libraryName: 'Movies',
    budget: { remaining: 2, suppressed: 0 },
  });

  it('dispatches one event per change and spends the run budget', async () => {
    const announce = announceFor();
    const rows = [
      synced({ firstSeenAt: firstSeen }),
      synced({ id: 'item-2', ratingKey: 'rk-2', quality: quality({ resolution: '4k' }) }),
      synced({ id: 'item-3', ratingKey: 'rk-3', firstSeenAt: firstSeen }),
    ];
    const prior = priorOf([
      ['rk-2', { quality: quality() }],
      ['rk-3', { quality: quality() }],
    ]);

    await announceMediaChanges({ announce, libraryId: '1', rows, prior, firstSeen });

    expect(mockDispatchMediaAdded).toHaveBeenCalledWith({
      server,
      media: {
        libraryItemId: 'item-1',
        title: 'Cars',
        grandparentTitle: null,
        type: 'movie',
        year: 2006,
        libraryId: '1',
        libraryName: 'Movies',
        quality: quality(),
      },
    });
    expect(mockDispatchMediaUpgraded).toHaveBeenCalledWith({
      server,
      media: expect.objectContaining({ libraryItemId: 'item-2' }),
      from: quality(),
      changed: ['resolution'],
    });
    expect(announce.budget).toEqual({ remaining: 0, suppressed: 1 });
  });

  it('dispatches nothing once the budget is spent', async () => {
    const announce = { ...announceFor(), budget: { remaining: 0, suppressed: 3 } };

    await announceMediaChanges({
      announce,
      libraryId: '1',
      rows: [synced({ firstSeenAt: firstSeen })],
      prior: priorOf([]),
      firstSeen,
    });

    expect(mockDispatchMediaAdded).not.toHaveBeenCalled();
    expect(announce.budget).toEqual({ remaining: 0, suppressed: 4 });
  });
});
