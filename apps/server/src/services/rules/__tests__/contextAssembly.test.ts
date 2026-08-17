import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveSession, RuleV2, Session } from '@tracearr/shared';
import type { sessions } from '../../../db/schema.js';

const mockGetIdentityServerUserIds = vi.fn();
vi.mock('../../userService.js', () => ({
  getIdentityServerUserIds: (...args: unknown[]) => mockGetIdentityServerUserIds(...args),
}));

const mockBatchGetRecentUserSessions = vi.fn();
const mockMergeRecentSessionsForIdentity = vi.fn();
vi.mock('../../../jobs/poller/database.js', () => ({
  batchGetRecentUserSessions: (...args: unknown[]) => mockBatchGetRecentUserSessions(...args),
  mergeRecentSessionsForIdentity: (...args: unknown[]) =>
    mockMergeRecentSessionsForIdentity(...args),
  maxWindowHoursFromRules: (rules: RuleV2[]) => (rules.length > 0 ? 72 : 24),
}));

vi.mock('../../../utils/logger.js', () => ({
  rulesLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  assembleEvaluationInputs,
  setContextAssemblyDeps,
  toRuleServer,
  toRuleServerUser,
  toRuleSession,
} from '../events/contextAssembly.js';

const server = { id: 'srv1', name: 'Plex', type: 'plex' as const };
const serverUser = {
  id: 'su1',
  userId: 'u1',
  username: 'connor',
  thumbUrl: null,
  identityName: 'Connor',
  trustScore: 90,
  lastActivityAt: null,
  createdAt: new Date('2026-01-01'),
  identityServerUserIds: ['su1'],
};

function session(id: string, overrides: Partial<Session> = {}): ActiveSession {
  return {
    id,
    serverId: 'srv1',
    serverUserId: 'su1',
    state: 'playing',
    ...overrides,
  } as ActiveSession;
}

describe('toRuleServer / toRuleServerUser', () => {
  it('builds the evaluator-shaped Server with placeholders where nothing evaluates', () => {
    const s = toRuleServer(server);
    expect(s).toMatchObject({ id: 'srv1', name: 'Plex', type: 'plex', url: '' });
  });

  it('builds the evaluator-shaped ServerUser carrying the fields evaluators read', () => {
    const su = toRuleServerUser(serverUser, 'srv1');
    expect(su).toMatchObject({
      id: 'su1',
      userId: 'u1',
      serverId: 'srv1',
      username: 'connor',
      trustScore: 90,
      lastActivityAt: null,
      identityName: 'Connor',
      externalId: '',
      isServerAdmin: false,
    });
    expect(su.createdAt).toEqual(new Date('2026-01-01'));
  });
});

describe('assembleEvaluationInputs', () => {
  const graceIds = new Set<string>();
  const cached: ActiveSession[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    graceIds.clear();
    cached.length = 0;
    setContextAssemblyDeps({
      getAllActiveSessions: async () => cached,
      gracePeriodSessionIds: () => graceIds,
    });
    mockGetIdentityServerUserIds.mockResolvedValue(['su1', 'su2']);
    mockBatchGetRecentUserSessions.mockResolvedValue(new Map([['su1', []]]));
    mockMergeRecentSessionsForIdentity.mockReturnValue([session('old')]);
  });

  it('short-circuits with empty arrays when there are no rules', async () => {
    const result = await assembleEvaluationInputs({ rules: [], server, serverUser });
    expect(result).toEqual({
      activeRulesV2: [],
      activeSessions: [],
      recentSessions: [],
      identityServerUserIds: serverUser.identityServerUserIds,
    });
    expect(mockGetIdentityServerUserIds).not.toHaveBeenCalled();
    expect(mockBatchGetRecentUserSessions).not.toHaveBeenCalled();
  });

  it('filters grace-flagged sessions, resolves identity, and fetches recent with the rules window', async () => {
    cached.push(session('a'), session('b'));
    graceIds.add('b');
    const rules = [{ id: 'r1' } as RuleV2];

    const result = await assembleEvaluationInputs({ rules, server, serverUser });

    expect(result.activeRulesV2).toBe(rules);
    expect(result.activeSessions.map((s) => s.id)).toEqual(['a']);
    expect(mockGetIdentityServerUserIds).toHaveBeenCalledWith('u1');
    expect(result.identityServerUserIds).toEqual(['su1', 'su2']);
    expect(mockBatchGetRecentUserSessions).toHaveBeenCalledWith(['su1', 'su2'], 72);
    expect(result.recentSessions.map((s) => s.id)).toEqual(['old']);
  });

  it('falls back to this server user only when identity or recent lookups fail', async () => {
    cached.push(session('a'));
    mockGetIdentityServerUserIds.mockRejectedValueOnce(new Error('db down'));
    mockBatchGetRecentUserSessions
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce(new Map([['su1', [session('mine')]]]));

    const result = await assembleEvaluationInputs({
      rules: [{ id: 'r1' } as RuleV2],
      server,
      serverUser,
    });

    expect(result.identityServerUserIds).toEqual(['su1']);
    expect(mockBatchGetRecentUserSessions).toHaveBeenLastCalledWith(['su1'], 72);
    expect(result.recentSessions.map((s) => s.id)).toEqual(['mine']);
  });
});

describe('toRuleSession', () => {
  const row = {
    id: 'sess-1',
    serverId: 'srv1',
    serverUserId: 'su1',
    sessionKey: 'sk',
    plexSessionId: null,
    externalSessionId: null,
    state: 'playing',
    mediaType: 'movie',
    mediaTitle: 'Old Title',
    grandparentTitle: null,
    seasonNumber: null,
    episodeNumber: null,
    year: 2020,
    thumbPath: null,
    ratingKey: '',
    serverVersionKey: null,
    parentRatingKey: null,
    grandparentRatingKey: null,
    mediaId: null,
    showMediaId: null,
    imdbId: null,
    tmdbId: null,
    tvdbId: null,
    startedAt: new Date('2026-08-16T10:00:00Z'),
    lastSeenAt: new Date('2026-08-16T10:05:00Z'),
    stoppedAt: null,
    durationMs: null,
    totalDurationMs: 7200000,
    progressMs: 60000,
    lastPausedAt: null,
    pausedDurationMs: 0,
    referenceId: null,
    watched: false,
    shortSession: false,
    forceStopped: false,
    ipAddress: '1.2.3.4',
    geoCity: null,
    geoRegion: null,
    geoCountry: 'US',
    geoContinent: null,
    geoPostal: null,
    geoLat: null,
    geoLon: null,
    geoAsnNumber: null,
    geoAsnOrganization: null,
    playerName: 'Player',
    deviceId: 'dev-1',
    product: null,
    device: null,
    platform: null,
    quality: null,
    isTranscode: false,
    videoDecision: 'directplay',
    audioDecision: 'directplay',
    bitrate: null,
    sourceVideoCodec: null,
    sourceAudioCodec: null,
    sourceAudioChannels: null,
    sourceVideoDetails: null,
    sourceAudioDetails: null,
    streamVideoCodec: null,
    streamAudioCodec: null,
    streamVideoDetails: null,
    streamAudioDetails: null,
    transcodeInfo: null,
    subtitleInfo: null,
    channelTitle: null,
    channelIdentifier: null,
    channelThumb: null,
    artistName: null,
    albumName: null,
    trackNumber: null,
    discNumber: null,
  } as unknown as typeof sessions.$inferSelect;

  it('maps a row through mapSessionRow when there are no live overrides', () => {
    const s = toRuleSession(row);
    expect(s.id).toBe('sess-1');
    expect(s.mediaTitle).toBe('Old Title');
    expect(s.videoDecision).toBe('directplay');
    expect(s.ratingKey).toBe('');
    expect(s.stoppedAt).toBeNull();
  });

  it('lets live fields override the row and keeps identity fields from the row', () => {
    const s = toRuleSession(row, {
      videoDecision: 'transcode',
      isTranscode: true,
      mediaTitle: 'New Title',
      lastPausedAt: new Date('2026-08-16T10:04:00Z'),
      pausedDurationMs: 30000,
    });
    expect(s.id).toBe('sess-1');
    expect(s.serverUserId).toBe('su1');
    expect(s.videoDecision).toBe('transcode');
    expect(s.isTranscode).toBe(true);
    expect(s.mediaTitle).toBe('New Title');
    expect(s.lastPausedAt).toEqual(new Date('2026-08-16T10:04:00Z'));
    expect(s.pausedDurationMs).toBe(30000);
    expect(s.ipAddress).toBe('1.2.3.4');
  });
});
