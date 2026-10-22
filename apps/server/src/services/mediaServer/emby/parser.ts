/**
 * Emby API Response Parser
 *
 * Pure functions for parsing raw Emby API responses into typed objects.
 * Separated from the client for testability and reuse.
 *
 * Based on Emby OpenAPI specification v4.1.1.0
 */

import { parseOptionalNumber, parseOptionalString, parseString } from '../../../utils/parsing.js';
import type { MediaSession } from '../types.js';
import type { EmbySyncJob, EmbySyncJobItem } from '../shared/jellyfinEmbyParser.js';
import { getStreamDecisionsEmby } from '../shared/jellyfinEmbyUtils.js';

// Re-export shared parser functions (identical between Jellyfin/Emby)
export {
  parsePlaybackState,
  parseUser,
  parseUsersResponse,
  parseLibrary,
  parseLibrariesResponse,
  parseWatchHistoryItem,
  parseWatchHistoryResponse,
  parseActivityLogItem,
  parseActivityLogResponse,
  parseItem,
  parseItemsResponse,
  parseLibraryItemsResponse,
  // Re-export shared types with platform-specific aliases for backward compatibility
  type JellyfinEmbyActivityEntry as EmbyActivityEntry,
  type JellyfinEmbyItemResult as EmbyItemResult,
} from '../shared/jellyfinEmbyParser.js';

import {
  parseSessionsResponse as parseSessionsResponseShared,
  parseSessionCore,
} from '../shared/jellyfinEmbyParser.js';

// ============================================================================
// Session Parsing (Emby-specific wrapper)
// ============================================================================

/**
 * Parse raw Emby session data into a MediaSession object.
 * Uses shared parsing logic with Emby-specific stream decisions.
 * Note: lastPausedDate is disabled as Emby does not support this field.
 */
export function parseSession(session: Record<string, unknown>): MediaSession | null {
  return parseSessionCore(session, getStreamDecisionsEmby, false);
}

/**
 * Parse Emby sessions API response
 * Filters to only sessions with active playback
 */
export function parseSessionsResponse(sessions: unknown[]): MediaSession[] {
  return parseSessionsResponseShared(sessions, parseSession);
}

// ============================================================================
// Sync (app downloads)
// ============================================================================

function syncItems(data: unknown): Array<Record<string, unknown>> {
  const items = (data as { Items?: unknown })?.Items;
  return Array.isArray(items) ? (items as Array<Record<string, unknown>>) : [];
}

export function parseSyncJobs(data: unknown): EmbySyncJob[] {
  return syncItems(data).map((job) => ({
    id: Number(job.Id),
    userId: parseString(job.UserId),
    itemId: parseString(job.ItemId),
    name: parseString(job.Name),
    targetId: parseString(job.TargetId),
    targetName: parseString(job.TargetName),
    quality: parseOptionalString(job.Quality) ?? null,
    status: parseString(job.Status),
    dateCreated: parseString(job.DateCreated),
    dateLastModified: parseString(job.DateLastModified),
  }));
}

function parseSyncMediaSource(raw: unknown): EmbySyncJobItem['mediaSource'] {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const streams = Array.isArray(source.MediaStreams)
    ? (source.MediaStreams as Array<Record<string, unknown> | null>)
    : [];
  const video = streams.find((stream) => stream?.Type === 'Video');
  const audio = streams.find((stream) => stream?.Type === 'Audio');
  return {
    size: parseOptionalNumber(source.Size) ?? null,
    bitrate: parseOptionalNumber(source.Bitrate) ?? null,
    container: parseOptionalString(source.Container) ?? null,
    videoCodec: parseOptionalString(video?.Codec) ?? null,
    audioCodec: parseOptionalString(audio?.Codec) ?? null,
    width: parseOptionalNumber(video?.Width) ?? null,
    height: parseOptionalNumber(video?.Height) ?? null,
  };
}

export function parseSyncJobItems(data: unknown): EmbySyncJobItem[] {
  return syncItems(data).map((item) => ({
    id: Number(item.Id),
    jobId: Number(item.JobId),
    itemId: parseString(item.ItemId),
    status: parseString(item.Status),
    dateCreated: parseString(item.DateCreated),
    mediaSource: parseSyncMediaSource(item.MediaSource),
  }));
}
