/**
 * Create-path dispatch contract
 *
 * createSessionWithRulesAtomic dispatches session.started with { tx, deferActions }.
 * The real dispatcher, subscribers, evaluate and contextAssembly modules run here:
 * an unregistered subscriber would silently return no violations, so these pin
 * that violations are recorded inside the transaction and actions run after it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuleV2 } from '@tracearr/shared';
import type { sessions } from '../../../db/schema.js';
import type { GeoLocation } from '../../../services/geoip.js';
import type { ProcessedSession } from '../types.js';

// ============================================================================
// Module Mocks
// ============================================================================

const insertedRow = {
  id: 'sess-1',
  serverId: 'srv1',
  serverUserId: 'su1',
  sessionKey: 'sk',
  plexSessionId: null,
  externalSessionId: null,
  state: 'playing',
  mediaType: 'movie',
  mediaTitle: 'M',
  grandparentTitle: null,
  seasonNumber: null,
  episodeNumber: null,
  year: null,
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
  lastSeenAt: new Date('2026-08-16T10:00:00Z'),
  stoppedAt: null,
  durationMs: null,
  totalDurationMs: null,
  progressMs: null,
  lastPausedAt: null,
  pausedDurationMs: 0,
  referenceId: null,
  watched: false,
  shortSession: false,
  forceStopped: false,
  ipAddress: '1.1.1.1',
  geoCity: null,
  geoRegion: null,
  geoCountry: null,
  geoContinent: null,
  geoPostal: null,
  geoLat: null,
  geoLon: null,
  geoAsnNumber: null,
  geoAsnOrganization: null,
  playerName: 'P',
  deviceId: null,
  product: null,
  device: null,
  platform: null,
  quality: null,
  isTranscode: false,
  videoDecision: null,
  audioDecision: null,
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

const fakeTx = {
  execute: vi.fn(),
  insert: vi.fn(() => ({
    values: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([insertedRow]) })),
  })),
  update: vi.fn(() => ({
    set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
  })),
};

// How many times executeActions had run at the moment the transaction callback
// resolved: the deferred contract means this must be 0.
let executeActionsCallsAtCommit = -1;

const mockTransaction = vi.fn(async (cb: (tx: typeof fakeTx) => Promise<unknown>) => {
  const out = await cb(fakeTx);
  executeActionsCallsAtCommit = mockExecuteActions.mock.calls.length;
  return out;
});

vi.mock('../../../db/client.js', () => ({
  db: { transaction: (...args: unknown[]) => mockTransaction(...(args as [never])) },
}));

vi.mock('../../../db/schema.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
}));

const mockEvaluateRulesAsync = vi.fn();
vi.mock('../../../services/rules/engine.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  evaluateRulesAsync: (...args: unknown[]) => mockEvaluateRulesAsync(...args),
}));

const mockRecordViolation = vi.fn();
vi.mock('../../../services/rules/violationWriter.js', () => ({
  recordViolation: (...args: unknown[]) => mockRecordViolation(...args),
}));

const mockExecuteActions = vi.fn();
vi.mock('../../../services/rules/executors/index.js', () => ({
  executeActions: (...args: unknown[]) => mockExecuteActions(...args),
}));

const mockStoreActionResults = vi.fn();
vi.mock('../../../services/rules/v2Integration.js', () => ({
  storeActionResults: (...args: unknown[]) => mockStoreActionResults(...args),
}));

vi.mock('../../../services/settings.js', () => ({
  getWatchedThreshold: vi.fn().mockResolvedValue(0.85),
}));

vi.mock('../../../utils/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  rulesLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../services/geoip.js', () => ({
  geoipService: { isPrivateIP: (ip: string) => ip.startsWith('192.168.') },
}));

import { createSessionWithRulesAtomic } from '../sessionLifecycle.js';
import { resetDispatcherForTests } from '../../../services/rules/events/dispatcher.js';
import {
  registerRuleSubscribers,
  resetRuleSubscribersForTests,
} from '../../../services/rules/events/subscribers.js';

// ============================================================================
// Fixtures
// ============================================================================

const processed = {
  sessionKey: 'sk',
  ratingKey: undefined,
  state: 'playing',
  mediaType: 'movie',
  mediaTitle: 'M',
  ipAddress: '1.1.1.1',
  playerName: 'P',
} as unknown as ProcessedSession;

const server = { id: 'srv1', name: 'S', type: 'plex' as const };

const serverUser = {
  id: 'su1',
  userId: 'u1',
  username: 'x',
  thumbUrl: null,
  identityName: null,
  trustScore: 100,
  lastActivityAt: null,
  createdAt: new Date('2026-01-01'),
  identityServerUserIds: ['su1'],
};

const geo: GeoLocation = {
  city: null,
  region: null,
  country: null,
  countryCode: null,
  continent: null,
  postal: null,
  lat: null,
  lon: null,
  asnNumber: null,
  asnOrganization: null,
};

const rule: RuleV2 = {
  id: 'r1',
  name: 'Kill on start',
  description: null,
  serverId: null,
  serverUserId: null,
  userId: null,
  enforceAcrossServers: false,
  severity: 'high',
  isActive: true,
  conditions: {
    groups: [{ conditions: [{ field: 'concurrent_streams', operator: 'gt', value: 1 }] }],
  },
  actions: { actions: [{ type: 'kill_stream' }] },
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const violationRow = { id: 'v1', ruleId: 'r1', serverUserId: 'su1', sessionId: 'sess-1' };

function killResults(enqueuedSessionIds: string[]) {
  return [
    {
      action: { type: 'kill_stream' },
      success: true,
      skipped: true,
      skipReason: 'queued',
      enqueuedSessionIds,
    },
  ];
}

function create(activeRulesV2: RuleV2[] = [rule]) {
  return createSessionWithRulesAtomic({
    processed,
    server,
    serverUser,
    geo,
    activeRulesV2,
    activeSessions: [],
    recentSessions: [],
  });
}

// ============================================================================
// Tests
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();
  executeActionsCallsAtCommit = -1;
  resetDispatcherForTests();
  resetRuleSubscribersForTests();
  registerRuleSubscribers();
  mockEvaluateRulesAsync.mockResolvedValue([
    {
      ruleId: rule.id,
      ruleName: rule.name,
      matched: true,
      matchedGroups: [0],
      actions: rule.actions.actions,
      evidence: [],
    },
  ]);
  mockRecordViolation.mockResolvedValue(violationRow);
  mockExecuteActions.mockResolvedValue(killResults(['sess-1']));
  mockStoreActionResults.mockResolvedValue(undefined);
});

describe('createSessionWithRulesAtomic dispatch contract', () => {
  it('records inside the transaction and defers actions until after commit', async () => {
    const result = await create();

    expect(mockRecordViolation).toHaveBeenCalledTimes(1);
    expect(mockRecordViolation).toHaveBeenCalledWith(
      expect.objectContaining({
        tx: fakeTx,
        scope: { kind: 'session', sessionId: 'sess-1', fresh: true },
      })
    );

    // Nothing acted before the transaction callback resolved.
    expect(executeActionsCallsAtCommit).toBe(0);
    expect(mockExecuteActions).toHaveBeenCalledTimes(1);
    expect(mockExecuteActions).toHaveBeenCalledWith(
      expect.objectContaining({ violationId: 'v1', rule }),
      rule.actions.actions
    );
    expect(mockStoreActionResults).toHaveBeenCalledWith('v1', rule.id, killResults(['sess-1']));

    expect(result.violationResults).toHaveLength(1);
    expect(result.violationResults[0]?.violation.id).toBe('v1');
    expect(result.violationResults[0]?.rule).toEqual({
      id: 'r1',
      name: 'Kill on start',
      type: null,
    });
    expect(result.wasTerminatedByRule).toBe(true);
  });

  it('wasTerminatedByRule is false when the kill did not target the new session', async () => {
    mockExecuteActions.mockResolvedValue(killResults(['someone-else']));

    const result = await create();

    expect(mockExecuteActions).toHaveBeenCalledTimes(1);
    expect(result.wasTerminatedByRule).toBe(false);
  });

  it('evaluates nothing and acts nothing when there are no active rules', async () => {
    const result = await create([]);

    expect(mockEvaluateRulesAsync).not.toHaveBeenCalled();
    expect(mockRecordViolation).not.toHaveBeenCalled();
    expect(mockExecuteActions).not.toHaveBeenCalled();
    expect(result.violationResults).toEqual([]);
    expect(result.wasTerminatedByRule).toBe(false);
  });

  it('propagates a subscriber failure out of the transaction and retries a serialization error', async () => {
    mockEvaluateRulesAsync.mockRejectedValue(
      Object.assign(new Error('could not serialize access'), { code: '40001' })
    );

    await expect(create()).rejects.toThrow('could not serialize access');

    expect(mockTransaction).toHaveBeenCalledTimes(3);
    expect(mockRecordViolation).not.toHaveBeenCalled();
    expect(mockExecuteActions).not.toHaveBeenCalled();
  });
});
