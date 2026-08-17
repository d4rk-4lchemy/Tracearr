/**
 * Session subscriber pipeline tests
 *
 * Ports of the transcode/pause re-evaluation suites onto runRulePipeline:
 * - Only the trigger's rule subset is evaluated (no false positives)
 * - Violations are recorded through the single writer, with the trigger marker
 * - Actions are gated on a newly inserted violation (never on a deduped match)
 * - The event's Session carries the fresh poll/SSE fields
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuleV2, Session } from '@tracearr/shared';
import type { ProcessedSession } from '../../../jobs/poller/types.js';
import type {
  AccountInactiveForEvent,
  EvaluationInputs,
  EvaluationServer,
  EvaluationServerUser,
  PauseData,
  SessionHeldForEvent,
  SessionPausedEvent,
  SessionRow,
  SessionStartedEvent,
  SessionTranscodeChangedEvent,
} from '../events/types.js';

// ============================================================================
// Module Mocks
// ============================================================================

const mockEvaluateRulesAsync = vi.fn();
vi.mock('../engine.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  evaluateRulesAsync: (...args: unknown[]) => mockEvaluateRulesAsync(...args),
}));
const mockRecordViolation = vi.fn();
vi.mock('../violationWriter.js', () => ({
  recordViolation: (...args: unknown[]) => mockRecordViolation(...args),
}));
const mockExecuteActions = vi.fn();
vi.mock('../executors/index.js', () => ({
  executeActions: (...args: unknown[]) => mockExecuteActions(...args),
}));
const mockStoreActionResults = vi.fn();
vi.mock('../v2Integration.js', () => ({
  storeActionResults: (...args: unknown[]) => mockStoreActionResults(...args),
}));
vi.mock('../../../utils/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  rulesLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../geoip.js', () => ({
  geoipService: {
    isPrivateIP: (ip: string) =>
      ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('127.'),
  },
}));

import {
  registerRuleSubscribers,
  resetRuleSubscribersForTests,
  runRulePipeline,
} from '../events/subscribers.js';
import { dispatch, resetDispatcherForTests } from '../events/dispatcher.js';
import { toRuleSession } from '../events/contextAssembly.js';
import { pickLiveSessionFields } from '../../../jobs/poller/sessionMapper.js';

// ============================================================================
// Helpers
// ============================================================================

function createMockExistingSession(overrides: Record<string, unknown> = {}): SessionRow {
  return {
    id: 'session-1',
    serverId: 'server-1',
    serverUserId: 'user-1',
    sessionKey: 'sk-1',
    externalSessionId: 'ext-1',
    state: 'playing',
    mediaType: 'movie',
    mediaTitle: 'Test Movie',
    grandparentTitle: null,
    seasonNumber: null,
    episodeNumber: null,
    year: 2024,
    thumbPath: null,
    ratingKey: 'rk-1',
    startedAt: new Date(),
    stoppedAt: null,
    durationMs: null,
    totalDurationMs: 7200000,
    progressMs: 0,
    lastPausedAt: null,
    pausedDurationMs: 0,
    referenceId: null,
    watched: false,
    ipAddress: '192.168.1.100',
    geoCity: 'New York',
    geoRegion: 'NY',
    geoCountry: 'US',
    geoContinent: 'NA',
    geoPostal: '10001',
    geoLat: 40.7128,
    geoLon: -74.006,
    geoAsnNumber: 7922,
    geoAsnOrganization: 'Comcast',
    playerName: 'Player 1',
    deviceId: 'device-1',
    product: 'Plex Web',
    device: 'Chrome',
    platform: 'Web',
    quality: '1080p',
    isTranscode: false,
    videoDecision: 'directplay',
    audioDecision: 'directplay',
    bitrate: 20000,
    channelTitle: null,
    channelIdentifier: null,
    channelThumb: null,
    artistName: null,
    albumName: null,
    trackNumber: null,
    discNumber: null,
    sourceVideoCodec: 'hevc',
    sourceAudioCodec: 'ac3',
    sourceAudioChannels: 6,
    sourceVideoWidth: 3840,
    sourceVideoHeight: 2160,
    sourceVideoDetails: null,
    sourceAudioDetails: null,
    streamVideoCodec: null,
    streamAudioCodec: null,
    streamVideoDetails: null,
    streamAudioDetails: null,
    transcodeInfo: null,
    subtitleInfo: null,
    ...overrides,
  } as SessionRow;
}

function createMockProcessedSession(overrides: Record<string, unknown> = {}): ProcessedSession {
  return {
    sessionKey: 'sk-1',
    ratingKey: 'rk-1',
    externalUserId: 'ext-user-1',
    username: 'testuser',
    userThumb: '',
    mediaTitle: 'Test Movie',
    mediaType: 'movie' as const,
    grandparentTitle: '',
    seasonNumber: 0,
    episodeNumber: 0,
    year: 2024,
    thumbPath: '',
    channelTitle: null,
    channelIdentifier: null,
    channelThumb: null,
    artistName: null,
    albumName: null,
    trackNumber: null,
    discNumber: null,
    ipAddress: '192.168.1.100',
    playerName: 'Player 1',
    deviceId: 'device-1',
    product: 'Plex Web',
    device: 'Chrome',
    platform: 'Web',
    quality: '4K (H.265) → 1080p (H.264)',
    isTranscode: true,
    videoDecision: 'transcode',
    audioDecision: 'directplay',
    bitrate: 10000,
    state: 'playing' as const,
    totalDurationMs: 7200000,
    progressMs: 360000,
    sourceVideoCodec: 'hevc',
    sourceAudioCodec: 'ac3',
    sourceAudioChannels: 6,
    sourceVideoWidth: 3840,
    sourceVideoHeight: 2160,
    sourceVideoDetails: null,
    sourceAudioDetails: null,
    streamVideoCodec: 'h264',
    streamAudioCodec: null,
    streamVideoDetails: null,
    streamAudioDetails: null,
    transcodeInfo: null,
    subtitleInfo: null,
    ...overrides,
  } as ProcessedSession;
}

function createPausedSession(overrides: Record<string, unknown> = {}): SessionRow {
  return createMockExistingSession({
    state: 'paused',
    progressMs: 600000,
    lastPausedAt: new Date(Date.now() - 20 * 60 * 1000), // 20 minutes ago (stale)
    ...overrides,
  });
}

function createPausedProcessedSession(overrides: Record<string, unknown> = {}): ProcessedSession {
  return createMockProcessedSession({
    quality: '1080p',
    isTranscode: false,
    videoDecision: 'directplay',
    audioDecision: 'directplay',
    bitrate: 20000,
    state: 'paused' as const,
    progressMs: 600000,
    streamVideoCodec: null,
    ...overrides,
  });
}

function createTranscodeRule(overrides: Partial<RuleV2> = {}): RuleV2 {
  return {
    id: 'rule-transcode-1',
    name: 'Block 4K Transcoding',
    description: null,
    serverId: null,
    serverUserId: null,
    userId: null,
    enforceAcrossServers: false,
    severity: 'high',
    isActive: true,
    conditions: {
      groups: [
        { conditions: [{ field: 'is_transcoding', operator: 'eq', value: true }] },
        { conditions: [{ field: 'source_resolution', operator: 'eq', value: '4K' }] },
      ],
    },
    actions: {
      actions: [{ type: 'kill_stream' }],
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createConcurrentStreamsRule(overrides: Partial<RuleV2> = {}): RuleV2 {
  return {
    id: 'rule-concurrent-1',
    name: 'Max 2 Concurrent Streams',
    description: null,
    serverId: null,
    serverUserId: null,
    userId: null,
    enforceAcrossServers: false,
    severity: 'warning',
    isActive: true,
    conditions: {
      groups: [{ conditions: [{ field: 'concurrent_streams', operator: 'gt', value: 2 }] }],
    },
    actions: {
      actions: [],
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createPauseRule(overrides: Partial<RuleV2> = {}): RuleV2 {
  return {
    id: 'rule-pause-1',
    name: 'Kill After 15min Pause',
    description: null,
    serverId: null,
    serverUserId: null,
    userId: null,
    enforceAcrossServers: false,
    severity: 'warning',
    isActive: true,
    conditions: {
      groups: [{ conditions: [{ field: 'current_pause_minutes', operator: 'gte', value: 15 }] }],
    },
    actions: {
      actions: [{ type: 'kill_stream' }],
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createTotalPauseRule(overrides: Partial<RuleV2> = {}): RuleV2 {
  return {
    id: 'rule-total-pause-1',
    name: 'Warn After 30min Total Pause',
    description: null,
    serverId: null,
    serverUserId: null,
    userId: null,
    enforceAcrossServers: false,
    severity: 'warning',
    isActive: true,
    conditions: {
      groups: [{ conditions: [{ field: 'total_pause_minutes', operator: 'gte', value: 30 }] }],
    },
    actions: {
      actions: [],
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createInactivityRule(overrides: Partial<RuleV2> = {}): RuleV2 {
  return {
    id: 'rule-inactive-1',
    name: 'Dormant 30 Days',
    description: null,
    serverId: null,
    serverUserId: null,
    userId: null,
    enforceAcrossServers: false,
    severity: 'warning',
    isActive: true,
    conditions: {
      groups: [{ conditions: [{ field: 'inactive_days', operator: 'gte', value: 30 }] }],
    },
    actions: { actions: [] },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const server: EvaluationServer = { id: 'server-1', name: 'Test Plex', type: 'plex' };
const serverUser: EvaluationServerUser = {
  id: 'user-1',
  userId: 'identity-1',
  username: 'testuser',
  thumbUrl: null,
  identityName: null,
  trustScore: 100,
  lastActivityAt: new Date(),
  createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
  identityServerUserIds: ['user-1'],
};

interface TriggerInput {
  existingSession: SessionRow;
  processed: ProcessedSession;
  server: EvaluationServer;
  serverUser: EvaluationServerUser;
  activeRulesV2: RuleV2[];
  activeSessions: Session[];
  recentSessions: Session[];
}

interface PauseTriggerInput extends TriggerInput {
  pauseData: PauseData;
}

function createTranscodeInput(overrides: Partial<TriggerInput> = {}): TriggerInput {
  return {
    existingSession: createMockExistingSession(),
    processed: createMockProcessedSession(),
    server,
    serverUser,
    activeRulesV2: [createTranscodeRule(), createConcurrentStreamsRule()],
    activeSessions: [],
    recentSessions: [],
    ...overrides,
  };
}

const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

function createPauseInput(overrides: Partial<PauseTriggerInput> = {}): PauseTriggerInput {
  return {
    existingSession: createPausedSession(),
    processed: createPausedProcessedSession(),
    pauseData: {
      lastPausedAt: tenMinutesAgo,
      pausedDurationMs: 0,
    },
    server,
    serverUser,
    activeRulesV2: [createPauseRule(), createConcurrentStreamsRule()],
    activeSessions: [],
    recentSessions: [],
    ...overrides,
  };
}

function startedEvent(input: TriggerInput): SessionStartedEvent {
  return {
    type: 'session.started',
    at: new Date(),
    server: input.server,
    serverUser: input.serverUser,
    session: toRuleSession(input.existingSession),
  };
}

function transcodeEvent(input: TriggerInput): SessionTranscodeChangedEvent {
  return {
    type: 'session.transcode_changed',
    at: new Date(),
    server: input.server,
    serverUser: input.serverUser,
    session: toRuleSession(input.existingSession, pickLiveSessionFields(input.processed)),
    previous: {
      videoDecision: input.existingSession.videoDecision,
      audioDecision: input.existingSession.audioDecision,
    },
    next: {
      videoDecision: input.processed.videoDecision,
      audioDecision: input.processed.audioDecision,
    },
  };
}

function pauseEvent(input: PauseTriggerInput): SessionPausedEvent {
  return {
    type: 'session.paused',
    at: new Date(),
    server: input.server,
    serverUser: input.serverUser,
    session: toRuleSession(input.existingSession, {
      ...pickLiveSessionFields(input.processed),
      lastPausedAt: input.pauseData.lastPausedAt,
      pausedDurationMs: input.pauseData.pausedDurationMs,
    }),
    pauseData: input.pauseData,
  };
}

function heldForEvent(input: PauseTriggerInput): SessionHeldForEvent {
  return {
    type: 'session.held_for',
    at: new Date(),
    server: input.server,
    serverUser: input.serverUser,
    session: toRuleSession(input.existingSession, {
      ...pickLiveSessionFields(input.processed),
      lastPausedAt: input.pauseData.lastPausedAt,
      pausedDurationMs: input.pauseData.pausedDurationMs,
    }),
    pauseData: input.pauseData,
    heldMinutes: 12,
  };
}

function accountInactiveEvent(): AccountInactiveForEvent {
  return { type: 'account.inactive_for', at: new Date(), server, serverUser, session: null };
}

function inputsOf(input: TriggerInput): EvaluationInputs {
  return {
    activeRulesV2: input.activeRulesV2,
    activeSessions: input.activeSessions,
    recentSessions: input.recentSessions,
    identityServerUserIds: input.serverUser.identityServerUserIds,
  };
}

function runTranscode(input: TriggerInput) {
  return runRulePipeline(
    transcodeEvent(input),
    inputsOf(input),
    {},
    { kind: 'session', sessionId: input.existingSession.id },
    { transcodeReEval: true }
  );
}

function runPause(input: PauseTriggerInput) {
  return runRulePipeline(
    pauseEvent(input),
    inputsOf(input),
    {},
    { kind: 'session', sessionId: input.existingSession.id },
    { pauseReEval: true }
  );
}

const transcodeViolation = {
  id: 'violation-1',
  ruleId: 'rule-transcode-1',
  serverUserId: 'user-1',
  sessionId: 'session-1',
  severity: 'high',
  ruleType: null,
  data: {},
  createdAt: new Date(),
  acknowledgedAt: null,
};

const pauseViolation = {
  ...transcodeViolation,
  ruleId: 'rule-pause-1',
  severity: 'warning',
};

// ============================================================================
// Tests
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();
  mockEvaluateRulesAsync.mockResolvedValue([]);
  mockRecordViolation.mockResolvedValue(transcodeViolation);
  mockExecuteActions.mockResolvedValue([]);
  mockStoreActionResults.mockResolvedValue(undefined);
});

describe('session.transcode_changed pipeline', () => {
  describe('rule filtering', () => {
    it('only evaluates transcode-related rules, skipping concurrent_streams', async () => {
      const input = createTranscodeInput();
      await runTranscode(input);

      // Should have been called with only the transcode rule, not the concurrent streams rule
      expect(mockEvaluateRulesAsync).toHaveBeenCalledTimes(1);
      const [_baseContext, rules] = mockEvaluateRulesAsync.mock.calls[0] as [unknown, RuleV2[]];
      expect(rules).toHaveLength(1);
      expect(rules[0]?.id).toBe('rule-transcode-1');
      expect(rules[0]?.name).toBe('Block 4K Transcoding');
    });

    it('returns empty array when no rules have transcode conditions', async () => {
      const input = createTranscodeInput({ activeRulesV2: [createConcurrentStreamsRule()] });

      const { violations } = await runTranscode(input);

      expect(violations).toEqual([]);
      expect(mockEvaluateRulesAsync).not.toHaveBeenCalled();
    });

    it('returns empty array when there are no active rules', async () => {
      const input = createTranscodeInput({ activeRulesV2: [] });

      const { violations } = await runTranscode(input);

      expect(violations).toEqual([]);
      expect(mockEvaluateRulesAsync).not.toHaveBeenCalled();
    });
  });

  describe('violation creation', () => {
    it('creates violation when transcode rule matches', async () => {
      mockEvaluateRulesAsync.mockResolvedValue([
        {
          ruleId: 'rule-transcode-1',
          ruleName: 'Block 4K Transcoding',
          matched: true,
          matchedGroups: [0, 1],
          actions: [{ type: 'kill_stream' }],
        },
      ]);

      const input = createTranscodeInput();
      const { violations } = await runTranscode(input);

      expect(violations).toHaveLength(1);
      expect(violations[0]).toEqual({
        violation: transcodeViolation,
        rule: { id: 'rule-transcode-1', name: 'Block 4K Transcoding', type: null },
      });
      expect(mockRecordViolation).toHaveBeenCalledTimes(1);
    });

    it('includes transcodeReEval marker in violation data', async () => {
      mockEvaluateRulesAsync.mockResolvedValue([
        {
          ruleId: 'rule-transcode-1',
          ruleName: 'Block 4K Transcoding',
          matched: true,
          matchedGroups: [0, 1],
          actions: [],
        },
      ]);

      const input = createTranscodeInput();
      await runTranscode(input);

      expect(mockRecordViolation).toHaveBeenCalledWith(
        expect.objectContaining({
          marker: { transcodeReEval: true },
          serverUserId: 'user-1',
          scope: { kind: 'session', sessionId: 'session-1' },
          session: transcodeEvent(input).session,
        })
      );
    });
  });

  describe('deduplication', () => {
    it('skips violation creation when duplicate exists', async () => {
      mockEvaluateRulesAsync.mockResolvedValue([
        {
          ruleId: 'rule-transcode-1',
          ruleName: 'Block 4K Transcoding',
          matched: true,
          matchedGroups: [0, 1],
          actions: [],
        },
      ]);

      // Simulate existing violation found (writer's dedup gate returns null)
      mockRecordViolation.mockResolvedValue(null);

      const { violations } = await runTranscode(createTranscodeInput());

      expect(violations).toHaveLength(0);
    });

    it('does NOT execute side effects when violation is deduplicated', async () => {
      mockEvaluateRulesAsync.mockResolvedValue([
        {
          ruleId: 'rule-transcode-1',
          ruleName: 'Block 4K Transcoding',
          matched: true,
          matchedGroups: [0, 1],
          actions: [{ type: 'create_violation', severity: 'high' }, { type: 'kill_stream' }],
        },
      ]);

      // Simulate existing violation — kill_stream must NOT re-fire
      mockRecordViolation.mockResolvedValue(null);

      const { violations } = await runTranscode(createTranscodeInput());

      expect(violations).toHaveLength(0);
      expect(mockExecuteActions).not.toHaveBeenCalled();
      expect(mockStoreActionResults).not.toHaveBeenCalled();
    });
  });

  describe('transaction safety', () => {
    it('passes the guarded session scope to the writer', async () => {
      mockEvaluateRulesAsync.mockResolvedValue([
        {
          ruleId: 'rule-transcode-1',
          ruleName: 'Block 4K Transcoding',
          matched: true,
          matchedGroups: [0, 1],
          actions: [],
        },
      ]);

      await runTranscode(createTranscodeInput());

      // The guarded (non-fresh) session scope is what selects the lock + gate path;
      // the lock/dedup ordering itself is pinned in violationWriter.test.ts.
      const args = mockRecordViolation.mock.calls[0]?.[0] as { scope: unknown };
      expect(args.scope).toEqual({ kind: 'session', sessionId: 'session-1' });
    });

    it('leaves the writer to open its own transaction', async () => {
      mockEvaluateRulesAsync.mockResolvedValue([
        {
          ruleId: 'rule-transcode-1',
          ruleName: 'Block 4K Transcoding',
          matched: true,
          matchedGroups: [0, 1],
          actions: [],
        },
      ]);

      await runTranscode(createTranscodeInput());

      // No caller transaction passed, so the writer opens its own around dedup + insert
      expect(mockRecordViolation).toHaveBeenCalledTimes(1);
      const args = mockRecordViolation.mock.calls[0]?.[0] as { tx?: unknown };
      expect(args.tx).toBeUndefined();
    });
  });

  describe('trust score penalty', () => {
    it('records once and runs no actions when the rule has none', async () => {
      mockEvaluateRulesAsync.mockResolvedValue([
        {
          ruleId: 'rule-transcode-1',
          ruleName: 'Block 4K Transcoding',
          matched: true,
          matchedGroups: [0, 1],
          actions: [],
        },
      ]);

      await runTranscode(createTranscodeInput());

      // Recording the violation is the pipeline's only write; a rule with no
      // actions produces nothing else.
      expect(mockRecordViolation).toHaveBeenCalledTimes(1);
      expect(mockExecuteActions).not.toHaveBeenCalled();
      expect(mockStoreActionResults).not.toHaveBeenCalled();
    });
  });

  describe('side effect actions', () => {
    it('executes kill_stream action alongside violation', async () => {
      const rule = createTranscodeRule();
      mockEvaluateRulesAsync.mockResolvedValue([
        {
          ruleId: 'rule-transcode-1',
          ruleName: 'Block 4K Transcoding',
          matched: true,
          matchedGroups: [0, 1],
          actions: [{ type: 'kill_stream' }],
        },
      ]);

      mockExecuteActions.mockResolvedValue([{ action: 'kill_stream', success: true }]);

      const input = createTranscodeInput({
        activeRulesV2: [rule, createConcurrentStreamsRule()],
      });
      await runTranscode(input);

      // Should execute side effect actions (kill_stream)
      expect(mockExecuteActions).toHaveBeenCalledTimes(1);
      expect(mockExecuteActions).toHaveBeenCalledWith(
        expect.objectContaining({ violationId: 'violation-1', rule }),
        [{ type: 'kill_stream' }]
      );

      // Should store action results
      expect(mockStoreActionResults).toHaveBeenCalledWith('violation-1', 'rule-transcode-1', [
        { action: 'kill_stream', success: true },
      ]);
    });
  });

  describe('context building', () => {
    it('passes updated transcode fields from processed data to evaluation', async () => {
      const input = createTranscodeInput({
        processed: createMockProcessedSession({
          isTranscode: true,
          videoDecision: 'transcode',
          audioDecision: 'copy',
        }),
        existingSession: createMockExistingSession({
          isTranscode: false,
          videoDecision: 'directplay',
          audioDecision: 'directplay',
        }),
      });

      await runTranscode(input);

      expect(mockEvaluateRulesAsync).toHaveBeenCalledTimes(1);
      const [baseContext] = mockEvaluateRulesAsync.mock.calls[0] as [
        { session: Session },
        RuleV2[],
      ];

      // Session should have UPDATED transcode fields from processed
      expect(baseContext.session.isTranscode).toBe(true);
      expect(baseContext.session.videoDecision).toBe('transcode');
      expect(baseContext.session.audioDecision).toBe('copy');

      // But identity fields should come from existing session
      expect(baseContext.session.id).toBe('session-1');
      expect(baseContext.session.serverId).toBe('server-1');
      expect(baseContext.session.serverUserId).toBe('user-1');
    });
  });

  describe('false positive prevention', () => {
    it('does NOT evaluate concurrent_streams rules on transcode change', async () => {
      const input = createTranscodeInput({
        activeRulesV2: [
          createConcurrentStreamsRule(),
          createTranscodeRule(),
          // Another non-transcode rule
          {
            id: 'rule-geo-1',
            name: 'Geo Restriction',
            description: null,
            serverId: null,
            serverUserId: null,
            userId: null,
            enforceAcrossServers: false,
            severity: 'warning',
            isActive: true,
            conditions: {
              groups: [
                {
                  conditions: [{ field: 'country', operator: 'not_in', value: ['US', 'CA'] }],
                },
              ],
            },
            actions: { actions: [] },
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      });

      await runTranscode(input);

      // Only the transcode rule should be evaluated
      const [_ctx, rules] = mockEvaluateRulesAsync.mock.calls[0] as [unknown, RuleV2[]];
      expect(rules).toHaveLength(1);
      expect(rules[0]?.id).toBe('rule-transcode-1');
    });

    it('evaluates output_resolution rules (they depend on transcode state)', async () => {
      const outputResRule: RuleV2 = {
        id: 'rule-output-res-1',
        name: 'Block Low Resolution Output',
        description: null,
        serverId: null,
        serverUserId: null,
        userId: null,
        enforceAcrossServers: false,
        severity: 'warning',
        isActive: true,
        conditions: {
          groups: [{ conditions: [{ field: 'output_resolution', operator: 'eq', value: '480p' }] }],
        },
        actions: { actions: [] },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const input = createTranscodeInput({
        activeRulesV2: [outputResRule, createConcurrentStreamsRule()],
      });

      await runTranscode(input);

      const [_ctx, rules] = mockEvaluateRulesAsync.mock.calls[0] as [unknown, RuleV2[]];
      expect(rules).toHaveLength(1);
      expect(rules[0]?.id).toBe('rule-output-res-1');
    });

    it('evaluates is_transcode_downgrade rules (they depend on transcode state)', async () => {
      const downgradeRule: RuleV2 = {
        id: 'rule-downgrade-1',
        name: 'Detect Transcode Downgrade',
        description: null,
        serverId: null,
        serverUserId: null,
        userId: null,
        enforceAcrossServers: false,
        severity: 'warning',
        isActive: true,
        conditions: {
          groups: [
            { conditions: [{ field: 'is_transcode_downgrade', operator: 'eq', value: true }] },
          ],
        },
        actions: { actions: [] },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const input = createTranscodeInput({ activeRulesV2: [downgradeRule] });

      await runTranscode(input);

      const [_ctx, rules] = mockEvaluateRulesAsync.mock.calls[0] as [unknown, RuleV2[]];
      expect(rules).toHaveLength(1);
      expect(rules[0]?.id).toBe('rule-downgrade-1');
    });
  });
});

describe('session.paused pipeline', () => {
  beforeEach(() => {
    mockRecordViolation.mockResolvedValue(pauseViolation);
  });

  describe('rule filtering', () => {
    it('only evaluates pause-related rules, skipping concurrent_streams', async () => {
      await runPause(createPauseInput());

      expect(mockEvaluateRulesAsync).toHaveBeenCalledTimes(1);
      const [_baseContext, rules] = mockEvaluateRulesAsync.mock.calls[0] as [unknown, RuleV2[]];
      expect(rules).toHaveLength(1);
      expect(rules[0]?.id).toBe('rule-pause-1');
      expect(rules[0]?.name).toBe('Kill After 15min Pause');
    });

    it('evaluates both current_pause and total_pause rules', async () => {
      const input = createPauseInput({
        activeRulesV2: [createPauseRule(), createTotalPauseRule(), createConcurrentStreamsRule()],
      });

      await runPause(input);

      const [_ctx, rules] = mockEvaluateRulesAsync.mock.calls[0] as [unknown, RuleV2[]];
      expect(rules).toHaveLength(2);
      expect(rules.map((r) => r.id)).toEqual(['rule-pause-1', 'rule-total-pause-1']);
    });

    it('returns empty array when no rules have pause conditions', async () => {
      const input = createPauseInput({
        activeRulesV2: [createConcurrentStreamsRule(), createTranscodeRule()],
      });

      const { violations } = await runPause(input);

      expect(violations).toEqual([]);
      expect(mockEvaluateRulesAsync).not.toHaveBeenCalled();
    });

    it('returns empty array when there are no active rules', async () => {
      const input = createPauseInput({ activeRulesV2: [] });

      const { violations } = await runPause(input);

      expect(violations).toEqual([]);
      expect(mockEvaluateRulesAsync).not.toHaveBeenCalled();
    });
  });

  describe('violation creation', () => {
    it('creates violation when pause rule matches', async () => {
      mockEvaluateRulesAsync.mockResolvedValue([
        {
          ruleId: 'rule-pause-1',
          ruleName: 'Kill After 15min Pause',
          matched: true,
          matchedGroups: [0],
          actions: [{ type: 'kill_stream' }],
        },
      ]);

      const { violations } = await runPause(createPauseInput());

      expect(violations).toHaveLength(1);
      expect(violations[0]).toEqual({
        violation: pauseViolation,
        rule: { id: 'rule-pause-1', name: 'Kill After 15min Pause', type: null },
      });
      expect(mockRecordViolation).toHaveBeenCalledTimes(1);
    });

    it('includes pauseReEval marker in violation data', async () => {
      mockEvaluateRulesAsync.mockResolvedValue([
        {
          ruleId: 'rule-pause-1',
          ruleName: 'Kill After 15min Pause',
          matched: true,
          matchedGroups: [0],
          actions: [],
        },
      ]);

      const input = createPauseInput();
      await runPause(input);

      expect(mockRecordViolation).toHaveBeenCalledWith(
        expect.objectContaining({
          marker: { pauseReEval: true },
          serverUserId: 'user-1',
          scope: { kind: 'session', sessionId: 'session-1' },
          session: pauseEvent(input).session,
        })
      );
    });

    it('passes the matched rule object to the writer', async () => {
      mockEvaluateRulesAsync.mockResolvedValue([
        {
          ruleId: 'rule-pause-1',
          ruleName: 'Kill After 15min Pause',
          matched: true,
          matchedGroups: [0],
          actions: [],
        },
      ]);

      // The writer reads severity off the rule, so it has to be the rule the engine matched
      const rule = createPauseRule();
      await runPause(createPauseInput({ activeRulesV2: [rule, createConcurrentStreamsRule()] }));

      expect(mockRecordViolation.mock.calls[0]?.[0]?.rule).toBe(rule);
    });
  });

  describe('deduplication', () => {
    it('skips violation creation when duplicate exists', async () => {
      mockEvaluateRulesAsync.mockResolvedValue([
        {
          ruleId: 'rule-pause-1',
          ruleName: 'Kill After 15min Pause',
          matched: true,
          matchedGroups: [0],
          actions: [],
        },
      ]);

      // Simulate existing violation found (writer's dedup gate returns null)
      mockRecordViolation.mockResolvedValue(null);

      const { violations } = await runPause(createPauseInput());

      expect(violations).toHaveLength(0);
    });

    it('does NOT execute side effects when violation is deduplicated', async () => {
      mockEvaluateRulesAsync.mockResolvedValue([
        {
          ruleId: 'rule-pause-1',
          ruleName: 'Kill After 15min Pause',
          matched: true,
          matchedGroups: [0],
          // On every subsequent poll cycle while paused, the rule matches again
          // but kill_stream must NOT fire again because dedup prevents it.
          actions: [{ type: 'kill_stream' }],
        },
      ]);

      // Simulate existing violation — this is the critical dedup scenario.
      mockRecordViolation.mockResolvedValue(null);

      await runPause(createPauseInput());

      // kill_stream should NOT fire on dedup
      expect(mockExecuteActions).not.toHaveBeenCalled();
      expect(mockStoreActionResults).not.toHaveBeenCalled();
    });
  });

  describe('transaction safety', () => {
    it('passes the guarded session scope to the writer', async () => {
      mockEvaluateRulesAsync.mockResolvedValue([
        {
          ruleId: 'rule-pause-1',
          ruleName: 'Kill After 15min Pause',
          matched: true,
          matchedGroups: [0],
          actions: [],
        },
      ]);

      await runPause(createPauseInput());

      // The guarded (non-fresh) session scope selects the lock + gate path in the writer.
      const args = mockRecordViolation.mock.calls[0]?.[0] as { scope: unknown };
      expect(args.scope).toEqual({ kind: 'session', sessionId: 'session-1' });
    });

    it('leaves the writer to open its own transaction', async () => {
      mockEvaluateRulesAsync.mockResolvedValue([
        {
          ruleId: 'rule-pause-1',
          ruleName: 'Kill After 15min Pause',
          matched: true,
          matchedGroups: [0],
          actions: [],
        },
      ]);

      await runPause(createPauseInput());

      expect(mockRecordViolation).toHaveBeenCalledTimes(1);
      const args = mockRecordViolation.mock.calls[0]?.[0] as { tx?: unknown };
      expect(args.tx).toBeUndefined();
    });
  });

  describe('trust score penalty', () => {
    it('records once and runs no actions when the rule has none', async () => {
      mockEvaluateRulesAsync.mockResolvedValue([
        {
          ruleId: 'rule-pause-1',
          ruleName: 'Kill After 15min Pause',
          matched: true,
          matchedGroups: [0],
          actions: [],
        },
      ]);

      await runPause(createPauseInput());

      // Trust score is handled elsewhere; recording the violation is the only write
      expect(mockRecordViolation).toHaveBeenCalledTimes(1);
      expect(mockExecuteActions).not.toHaveBeenCalled();
      expect(mockStoreActionResults).not.toHaveBeenCalled();
    });
  });

  describe('side effect actions', () => {
    it('executes kill_stream action alongside new violation', async () => {
      const rule = createPauseRule();
      mockEvaluateRulesAsync.mockResolvedValue([
        {
          ruleId: 'rule-pause-1',
          ruleName: 'Kill After 15min Pause',
          matched: true,
          matchedGroups: [0],
          actions: [{ type: 'kill_stream' }],
        },
      ]);

      mockExecuteActions.mockResolvedValue([{ action: 'kill_stream', success: true }]);

      const input = createPauseInput({ activeRulesV2: [rule, createConcurrentStreamsRule()] });
      await runPause(input);

      expect(mockExecuteActions).toHaveBeenCalledTimes(1);
      expect(mockExecuteActions).toHaveBeenCalledWith(
        expect.objectContaining({ violationId: 'violation-1', rule }),
        [{ type: 'kill_stream' }]
      );

      expect(mockStoreActionResults).toHaveBeenCalledWith('violation-1', 'rule-pause-1', [
        { action: 'kill_stream', success: true },
      ]);
    });
  });

  describe('context building', () => {
    it('uses fresh pauseData instead of stale existingSession values', async () => {
      const freshPauseStart = new Date(Date.now() - 5 * 60 * 1000); // 5 min ago (fresh)
      const stalePauseStart = new Date(Date.now() - 20 * 60 * 1000); // 20 min ago (stale)

      const input = createPauseInput({
        existingSession: createPausedSession({
          // These are STALE values from the DB (before update)
          lastPausedAt: stalePauseStart,
          pausedDurationMs: 0,
        }),
        pauseData: {
          // These are FRESH values from calculatePauseAccumulation
          lastPausedAt: freshPauseStart,
          pausedDurationMs: 300000, // 5 min accumulated
        },
      });

      await runPause(input);

      expect(mockEvaluateRulesAsync).toHaveBeenCalledTimes(1);
      const [baseContext] = mockEvaluateRulesAsync.mock.calls[0] as [
        { session: Session },
        RuleV2[],
      ];

      // Session should use FRESH pause data, not stale existingSession values
      expect(baseContext.session.lastPausedAt).toEqual(freshPauseStart);
      expect(baseContext.session.pausedDurationMs).toBe(300000);

      // But identity fields should come from existingSession
      expect(baseContext.session.id).toBe('session-1');
      expect(baseContext.session.serverId).toBe('server-1');
      expect(baseContext.session.serverUserId).toBe('user-1');
    });

    it('uses paused state from processed data', async () => {
      const input = createPauseInput({
        processed: createPausedProcessedSession({ state: 'paused' }),
        existingSession: createPausedSession({ state: 'playing' }), // Stale
      });

      await runPause(input);

      const [baseContext] = mockEvaluateRulesAsync.mock.calls[0] as [
        { session: Session },
        RuleV2[],
      ];
      expect(baseContext.session.state).toBe('paused');
    });
  });

  describe('false positive prevention', () => {
    it('does NOT evaluate concurrent_streams rules on pause re-eval', async () => {
      const input = createPauseInput({
        activeRulesV2: [createConcurrentStreamsRule(), createPauseRule(), createTranscodeRule()],
      });

      await runPause(input);

      const [_ctx, rules] = mockEvaluateRulesAsync.mock.calls[0] as [unknown, RuleV2[]];
      expect(rules).toHaveLength(1);
      expect(rules[0]?.id).toBe('rule-pause-1');
    });

    it('evaluates rules with mixed pause + non-pause conditions', async () => {
      const mixedRule: RuleV2 = {
        id: 'rule-mixed-1',
        name: 'Pause + Concurrent',
        description: null,
        serverId: null,
        serverUserId: null,
        userId: null,
        enforceAcrossServers: false,
        severity: 'warning',
        isActive: true,
        conditions: {
          groups: [
            { conditions: [{ field: 'current_pause_minutes', operator: 'gte', value: 10 }] },
            { conditions: [{ field: 'concurrent_streams', operator: 'gt', value: 1 }] },
          ],
        },
        actions: { actions: [] },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const input = createPauseInput({
        activeRulesV2: [mixedRule, createConcurrentStreamsRule()],
      });

      await runPause(input);

      // The mixed rule has a pause condition, so it should be included
      const [_ctx, rules] = mockEvaluateRulesAsync.mock.calls[0] as [unknown, RuleV2[]];
      expect(rules).toHaveLength(1);
      expect(rules[0]?.id).toBe('rule-mixed-1');
    });
  });
});

describe('runRulePipeline', () => {
  it('appends the event session to activeSessions when the grace filter dropped it', async () => {
    const other = { id: 'session-2', serverId: 'server-1', serverUserId: 'user-1' } as Session;
    const input = createTranscodeInput({ activeSessions: [other] });

    await runTranscode(input);

    const [baseContext] = mockEvaluateRulesAsync.mock.calls[0] as [
      { session: Session; activeSessions: Session[] },
      RuleV2[],
    ];
    expect(baseContext.activeSessions).toHaveLength(2);
    expect(baseContext.activeSessions[1]).toBe(baseContext.session);
  });

  it('under deferActions records now, acts later, and the closure returns the action results', async () => {
    mockEvaluateRulesAsync.mockResolvedValue([
      {
        ruleId: 'r1',
        ruleName: 'Deferred',
        matched: true,
        matchedGroups: [0],
        actions: [{ type: 'log_only' }],
      },
    ]);
    mockRecordViolation.mockResolvedValue({ id: 'v1' });
    mockExecuteActions.mockResolvedValue([{ action: { type: 'log_only' }, success: true }]);

    const input = createTranscodeInput({
      activeRulesV2: [createTranscodeRule({ id: 'r1', name: 'Deferred' })],
    });
    const res = await runRulePipeline(
      transcodeEvent(input),
      inputsOf(input),
      { deferActions: true },
      { kind: 'session', sessionId: 'session-1', fresh: true }
    );

    expect(mockRecordViolation).toHaveBeenCalledTimes(1);
    expect(mockExecuteActions).not.toHaveBeenCalled();
    if (!res.deferredActions) throw new Error('expected deferredActions');
    const results = await res.deferredActions();
    expect(mockExecuteActions).toHaveBeenCalledTimes(1);
    expect(mockStoreActionResults).toHaveBeenCalledWith('v1', 'r1', results);
    expect(results).toHaveLength(1);
  });

  it('records then acts per rule, not record-all-then-act-all', async () => {
    mockEvaluateRulesAsync.mockResolvedValue([
      {
        ruleId: 'r1',
        ruleName: 'First',
        matched: true,
        matchedGroups: [0],
        actions: [{ type: 'kill_stream' }],
      },
      {
        ruleId: 'r2',
        ruleName: 'Second',
        matched: true,
        matchedGroups: [0],
        actions: [{ type: 'kill_stream' }],
      },
    ]);
    mockRecordViolation.mockResolvedValueOnce({ id: 'v1' }).mockResolvedValueOnce({ id: 'v2' });

    const input = createTranscodeInput({
      activeRulesV2: [
        createTranscodeRule({ id: 'r1', name: 'First' }),
        createTranscodeRule({ id: 'r2', name: 'Second' }),
      ],
    });
    await runTranscode(input);

    expect(mockRecordViolation).toHaveBeenCalledTimes(2);
    expect(mockExecuteActions).toHaveBeenCalledTimes(2);

    const [recordFirst, recordSecond] = mockRecordViolation.mock.invocationCallOrder as [
      number,
      number,
    ];
    const [actFirst, actSecond] = mockExecuteActions.mock.invocationCallOrder as [number, number];
    expect(recordFirst).toBeLessThan(actFirst);
    expect(actFirst).toBeLessThan(recordSecond);
    expect(recordSecond).toBeLessThan(actSecond);
  });
});

describe('registerRuleSubscribers', () => {
  beforeEach(() => {
    resetDispatcherForTests();
    resetRuleSubscribersForTests();
    registerRuleSubscribers();
    mockEvaluateRulesAsync.mockResolvedValue([
      {
        ruleId: 'rule-transcode-1',
        ruleName: 'Block 4K Transcoding',
        matched: true,
        matchedGroups: [0, 1],
        actions: [],
      },
    ]);
  });

  it('records a dispatched session.started against the fresh scope with no marker', async () => {
    const input = createTranscodeInput();

    const result = await dispatch(startedEvent(input), inputsOf(input));

    expect(mockRecordViolation).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { kind: 'session', sessionId: 'session-1', fresh: true },
      })
    );
    expect(mockRecordViolation.mock.calls[0]?.[0]?.marker).toBeUndefined();
    expect(result.violations).toEqual([
      {
        violation: transcodeViolation,
        rule: { id: 'rule-transcode-1', name: 'Block 4K Transcoding', type: null },
      },
    ]);
  });

  it('records a dispatched session.transcode_changed against the guarded scope', async () => {
    const input = createTranscodeInput();

    const result = await dispatch(transcodeEvent(input), inputsOf(input));

    expect(mockRecordViolation).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { kind: 'session', sessionId: 'session-1' },
        marker: { transcodeReEval: true },
      })
    );
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.violation).toEqual(transcodeViolation);
  });

  it('records a dispatched session.paused against the guarded scope', async () => {
    mockEvaluateRulesAsync.mockResolvedValue([
      {
        ruleId: 'rule-pause-1',
        ruleName: 'Kill After 15min Pause',
        matched: true,
        matchedGroups: [0],
        actions: [],
      },
    ]);
    mockRecordViolation.mockResolvedValue(pauseViolation);
    const input = createPauseInput();

    const result = await dispatch(pauseEvent(input), inputsOf(input));

    expect(mockRecordViolation).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { kind: 'session', sessionId: 'session-1' },
        marker: { pauseReEval: true },
      })
    );
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.violation).toEqual(pauseViolation);
  });

  it('records a dispatched account.inactive_for against the account scope with no marker', async () => {
    mockEvaluateRulesAsync.mockResolvedValue([
      {
        ruleId: 'rule-inactive-1',
        ruleName: 'Dormant 30 Days',
        matched: true,
        matchedGroups: [0],
        actions: [],
      },
    ]);

    const result = await dispatch(accountInactiveEvent(), {
      activeRulesV2: [createInactivityRule(), createTranscodeRule()],
      activeSessions: [],
      recentSessions: [],
      identityServerUserIds: serverUser.identityServerUserIds,
    });

    // Only the inactivity rule is in scope for this trigger
    const [_ctx, rules] = mockEvaluateRulesAsync.mock.calls[0] as [unknown, RuleV2[]];
    expect(rules.map((r) => r.id)).toEqual(['rule-inactive-1']);
    expect(mockRecordViolation).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { kind: 'account', serverUserId: 'user-1' },
        serverUserId: 'user-1',
        session: null,
      })
    );
    expect(mockRecordViolation.mock.calls[0]?.[0]?.marker).toBeUndefined();
    expect(result.violations).toHaveLength(1);
  });

  it('records a dispatched session.held_for against the guarded scope', async () => {
    mockEvaluateRulesAsync.mockResolvedValue([
      {
        ruleId: 'rule-pause-1',
        ruleName: 'Kill After 15min Pause',
        matched: true,
        matchedGroups: [0],
        actions: [],
      },
    ]);
    mockRecordViolation.mockResolvedValue(pauseViolation);
    const input = createPauseInput();

    const result = await dispatch(heldForEvent(input), inputsOf(input));

    expect(mockRecordViolation).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { kind: 'session', sessionId: 'session-1' },
        marker: { heldFor: true },
      })
    );
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.violation).toEqual(pauseViolation);
  });
});
