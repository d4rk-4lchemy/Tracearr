/**
 * Emby Parser Tests
 *
 * Uses shared test factories for common behavior, with Emby-specific
 * tests for platform differences (DirectStream handling, image paths).
 *
 * Based on Emby OpenAPI specification v4.1.1.0
 */

import { describe, it, expect } from 'vitest';
import {
  parseSession,
  parseSessionsResponse,
  parseUser,
  parseUsersResponse,
  parseLibrary,
  parseLibrariesResponse,
  parseWatchHistoryItem,
  parseWatchHistoryResponse,
  parseActivityLogItem,
  parseActivityLogResponse,
  parseSyncJobItems,
  parseSyncJobs,
} from '../emby/parser.js';
import { createAllSharedParserTests } from './shared/jellyfinEmbyParserTests.js';

// ============================================================================
// Shared Tests (Common to Jellyfin and Emby)
// ============================================================================

createAllSharedParserTests(
  {
    parseSession,
    parseSessionsResponse,
    parseUser,
    parseUsersResponse,
    parseLibrary,
    parseLibrariesResponse,
    parseWatchHistoryItem,
    parseWatchHistoryResponse,
    parseActivityLogItem,
    parseActivityLogResponse,
  },
  'emby'
);

// ============================================================================
// Emby-Specific: DirectStream Handling
// ============================================================================

describe('Emby Parser - DirectStream Behavior', () => {
  it('should treat DirectStream as DirectPlay when no TranscodingInfo', () => {
    // Emby apps report DirectStream even when no remuxing occurs
    const session = parseSession({
      Id: 'session-1',
      NowPlayingItem: { Id: '1', Name: 'Test', Type: 'Movie' },
      PlayState: {
        PlayMethod: 'DirectStream',
        IsPaused: false,
      },
    });

    expect(session!.quality.isTranscode).toBe(false);
    expect(session!.quality.videoDecision).toBe('directplay');
  });

  it('should detect actual DirectStream (remux) when TranscodingInfo shows container change', () => {
    // Actual remuxing: container changes but streams are copied
    const session = parseSession({
      Id: 'session-1',
      NowPlayingItem: { Id: '1', Name: 'Test', Type: 'Movie' },
      PlayState: {
        PlayMethod: 'DirectStream',
        IsPaused: false,
      },
      TranscodingInfo: {
        Bitrate: 5000000,
        IsVideoDirect: false, // Video being remuxed
        IsAudioDirect: true,
      },
    });

    expect(session!.quality.isTranscode).toBe(false);
    expect(session!.quality.videoDecision).toBe('copy');
  });

  it('should fall back to TranscodingInfo.IsVideoDirect when PlayMethod not available', () => {
    // When IsVideoDirect is false, it's transcoding
    const transcodingSession = parseSession({
      Id: 'session-1',
      NowPlayingItem: { Id: '1', Name: 'Test', Type: 'Movie' },
      PlayState: {
        IsPaused: false,
      },
      TranscodingInfo: {
        Bitrate: 5000000,
        IsVideoDirect: false,
        IsAudioDirect: false,
      },
    });

    expect(transcodingSession!.quality.isTranscode).toBe(true);
    expect(transcodingSession!.quality.videoDecision).toBe('transcode');

    // When IsVideoDirect is true, it's direct/copy
    const directStreamSession = parseSession({
      Id: 'session-2',
      NowPlayingItem: { Id: '1', Name: 'Test', Type: 'Movie' },
      PlayState: {
        IsPaused: false,
      },
      TranscodingInfo: {
        Bitrate: 5000000,
        IsVideoDirect: true,
        IsAudioDirect: true,
      },
    });

    expect(directStreamSession!.quality.isTranscode).toBe(false);
    expect(directStreamSession!.quality.videoDecision).toBe('directplay');
  });

  it('should default to directplay when no PlayMethod and no TranscodingInfo', () => {
    const session = parseSession({
      Id: 'session-1',
      NowPlayingItem: { Id: '1', Name: 'Test', Type: 'Movie' },
      PlayState: {
        IsPaused: false,
      },
    });

    expect(session!.quality.isTranscode).toBe(false);
    expect(session!.quality.videoDecision).toBe('directplay');
  });
});

// ============================================================================
// Emby-Specific: Bitrate Handling
// ============================================================================

describe('Emby Parser - Bitrate Handling', () => {
  it('should prefer transcoding bitrate over source bitrate', () => {
    const rawSession = {
      Id: 'session-transcode',
      NowPlayingItem: {
        Id: 'item-1',
        Name: 'Movie',
        Type: 'Movie',
        MediaSources: [{ Bitrate: 30000000 }], // Source: 30000 kbps
      },
      PlayState: {
        PlayMethod: 'Transcode',
      },
      TranscodingInfo: {
        Bitrate: 5000000, // Transcoding: 5000 kbps
      },
    };

    const session = parseSession(rawSession);
    expect(session!.quality.bitrate).toBe(5000); // Should use transcoding bitrate
  });
});

// ============================================================================
// Emby-Specific: Watch History
// ============================================================================

describe('Emby Parser - Watch History', () => {
  it('should handle photo type as unknown', () => {
    const rawItem = {
      Id: 'photo-1',
      Name: 'Vacation Photo',
      Type: 'Photo',
      UserData: {
        PlayCount: 1,
      },
    };

    const item = parseWatchHistoryItem(rawItem);
    expect(item.type).toBe('unknown');
  });
});

// ============================================================================
// Emby-Specific: Edge Cases
// ============================================================================

describe('Emby Parser - Edge Cases', () => {
  it('should handle case insensitivity in media type', () => {
    const session = parseSession({
      NowPlayingItem: { Id: '1', Name: 'Test', Type: 'MOVIE' },
    });
    expect(session!.media.type).toBe('movie');
  });

  it('should build correct image paths', () => {
    const session = parseSession({
      Id: 'session-1',
      UserId: 'user-123',
      UserPrimaryImageTag: 'user-tag',
      NowPlayingItem: {
        Id: 'item-456',
        Name: 'Test',
        Type: 'Movie',
        ImageTags: { Primary: 'item-tag' },
      },
    });

    expect(session!.user.thumb).toBe('/Users/user-123/Images/Primary');
    expect(session!.media.thumbPath).toBe('/Items/item-456/Images/Primary');
  });

  it('should not include image path when tag is missing', () => {
    const session = parseSession({
      Id: 'session-1',
      UserId: 'user-123',
      NowPlayingItem: {
        Id: 'item-456',
        Name: 'Test',
        Type: 'Movie',
      },
    });

    expect(session!.user.thumb).toBeUndefined();
    expect(session!.media.thumbPath).toBeUndefined();
  });

  it('should use album artwork as fallback for music tracks without Primary image', () => {
    const session = parseSession({
      Id: 'session-1',
      UserId: 'user-123',
      NowPlayingItem: {
        Id: 'track-123',
        Name: 'Song Title',
        Type: 'Audio',
        ImageTags: {}, // No Primary image on track
        AlbumId: 'album-456',
        AlbumPrimaryImageTag: 'album-tag',
        Album: 'Test Album',
        AlbumArtist: 'Test Artist',
      },
    });

    // Should fall back to album artwork
    expect(session!.media.thumbPath).toBe('/Items/album-456/Images/Primary');
    expect(session!.music?.albumThumbPath).toBe('/Items/album-456/Images/Primary');
  });

  it('should prefer track Primary image over album artwork for music tracks', () => {
    const session = parseSession({
      Id: 'session-1',
      UserId: 'user-123',
      NowPlayingItem: {
        Id: 'track-123',
        Name: 'Song Title',
        Type: 'Audio',
        ImageTags: { Primary: 'track-tag' }, // Track has its own image
        AlbumId: 'album-456',
        AlbumPrimaryImageTag: 'album-tag',
        Album: 'Test Album',
        AlbumArtist: 'Test Artist',
      },
    });

    // Should use track's own image, not album
    expect(session!.media.thumbPath).toBe('/Items/track-123/Images/Primary');
    expect(session!.music?.albumThumbPath).toBe('/Items/album-456/Images/Primary');
  });
});

describe('Emby Parser - transcode progress parity', () => {
  it('parses throttle, transcode position, and per-direction hardware accel', () => {
    const session = parseSession({
      Id: 'session-1',
      NowPlayingItem: {
        Id: '1',
        Name: 'Test',
        Type: 'Movie',
        MediaStreams: [{ Type: 'Video', RealFrameRate: 24 }],
      },
      PlayState: { IsPaused: false },
      TranscodingInfo: {
        IsVideoDirect: false,
        CompletionPercentage: 61.2,
        Framerate: 48,
        CurrentThrottle: 40,
        TranscodingPositionTicks: 9000000000,
        VideoDecoderIsHardware: true,
        VideoDecoderHwAccel: 'qsv',
        VideoEncoderIsHardware: true,
        VideoEncoderHwAccel: 'qsv',
      },
    });

    const info = session!.quality.transcodeInfo;
    expect(info?.progress).toBe(61.2);
    expect(info?.speed).toBe(2);
    expect(info?.throttled).toBe(true);
    expect(info?.maxOffsetAvailable).toBe(900);
    expect(info?.hwRequested).toBe(true);
    expect(info?.hwDecoding).toBe('qsv');
    expect(info?.hwEncoding).toBe('qsv');
  });

  it('leaves throttle and hw fields unset for unthrottled software transcode', () => {
    const session = parseSession({
      Id: 'session-1',
      NowPlayingItem: { Id: '1', Name: 'Test', Type: 'Movie' },
      PlayState: { IsPaused: false },
      TranscodingInfo: {
        IsVideoDirect: false,
        CompletionPercentage: 5,
        CurrentThrottle: 0,
        VideoDecoderIsHardware: false,
        VideoDecoderHwAccel: 'vaapi',
        VideoEncoderIsHardware: false,
      },
    });

    const info = session!.quality.transcodeInfo;
    expect(info?.throttled).toBeUndefined();
    expect(info?.hwDecoding).toBeUndefined();
    expect(info?.hwRequested).toBeUndefined();
    expect(info?.progress).toBe(5);
  });
});

describe('sync job parsing', () => {
  it('reads a sync job with its numeric user and target', () => {
    expect(
      parseSyncJobs({
        Items: [
          {
            Id: 1,
            TargetId: '22D01846-6841-432B-9C71-8CF676E49F0E',
            TargetName: 'iPhone (Emby for iOS) - connor@example.com',
            Quality: '1500000',
            Container: 'mkv',
            Progress: 100,
            Name: 'Mentally Divergent',
            Status: 'Completed',
            UserId: 1,
            ItemId: 78146,
            DateCreated: '2026-10-20T17:11:31.0000000Z',
            DateLastModified: '2026-10-20T17:13:28.0000000Z',
          },
        ],
        TotalRecordCount: 1,
      })
    ).toEqual([
      {
        id: 1,
        userId: '1',
        itemId: '78146',
        name: 'Mentally Divergent',
        targetId: '22D01846-6841-432B-9C71-8CF676E49F0E',
        targetName: 'iPhone (Emby for iOS) - connor@example.com',
        quality: '1500000',
        status: 'Completed',
        dateCreated: '2026-10-20T17:11:31.0000000Z',
        dateLastModified: '2026-10-20T17:13:28.0000000Z',
      },
    ]);
  });

  it('reads the delivered file of a synced item, its dimensions from the video stream', () => {
    const [synced, converting] = parseSyncJobItems({
      Items: [
        {
          Id: 1,
          JobId: 1,
          ItemId: 78146,
          MediaSourceId: 'mediasource_78146',
          Status: 'Synced',
          DateCreated: '2026-10-20T17:11:31.0000000Z',
          MediaSource: {
            Container: 'mkv',
            Size: 192015871,
            Bitrate: 591668,
            MediaStreams: [
              { Type: 'Video', Codec: 'h264', Width: 720, Height: 404, BitRate: 591668 },
              { Type: 'Audio', Codec: 'aac', BitRate: 192000 },
              { Type: 'Subtitle', Codec: 'subrip' },
            ],
          },
        },
        {
          Id: 2,
          JobId: 1,
          ItemId: 78147,
          Status: 'Converting',
          DateCreated: '2026-10-20T17:12:00Z',
        },
      ],
    });

    expect(synced).toEqual({
      id: 1,
      jobId: 1,
      itemId: '78146',
      status: 'Synced',
      dateCreated: '2026-10-20T17:11:31.0000000Z',
      mediaSource: {
        size: 192015871,
        bitrate: 591668,
        container: 'mkv',
        videoCodec: 'h264',
        audioCodec: 'aac',
        width: 720,
        height: 404,
      },
    });
    expect(converting).toMatchObject({ id: 2, status: 'Converting', mediaSource: null });
  });
});
