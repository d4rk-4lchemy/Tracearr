/**
 * One artist held on two servers, for the catalog, media detail and shelves
 * suites: two albums per copy, one track per album, and an orphan album and
 * track whose artist row is missing (the Emby case where AlbumArtists[0].Id
 * names an artist the server never lists).
 *
 * Plays: three counted chains in total. Account A plays "One More Time" as one
 * chain split across UTC midnight and "Da Funk" once; account B plays "One
 * More Time" on server B once. The orphan track's play counts toward no artist.
 */

import { sql } from 'drizzle-orm';
import {
  createTestServer,
  createTestUser,
  createTestServerUser,
  createTestSession,
  createTestLibraryItem,
} from '@tracearr/test-utils/factories';
import { db } from '../../src/db/client.js';
import { resolveMediaForItem } from '../../src/services/library/mediaResolutionService.js';

export interface MusicScenario {
  serverA: string;
  serverB: string;
  artistMediaId: string;
  /** Newest first, as the album shelf orders them; the orphan album is not here. */
  albumsNewestFirst: { serverId: string; ratingKey: string; title: string }[];
}

const ARTIST = 'Daft Punk';

const ALBUMS = [
  { title: 'Homework', year: 1997, track: 'Da Funk' },
  { title: 'Discovery', year: 2001, track: 'One More Time' },
] as const;

async function setArt(serverId: string, ratingKey: string, parentTitle: string | null) {
  await db.execute(sql`
    UPDATE library_items
    SET thumb_path = ${`/library/metadata/${ratingKey}/thumb/1`}, parent_title = ${parentTitle}
    WHERE server_id = ${serverId} AND rating_key = ${ratingKey}
  `);
}

async function playTrack(opts: {
  serverId: string;
  serverUserId: string;
  mediaId: string;
  ratingKey: string;
  artistRatingKey: string;
  startedAt: Date;
  referenceId?: string;
}): Promise<string> {
  const session = await createTestSession({
    serverId: opts.serverId,
    serverUserId: opts.serverUserId,
    mediaId: opts.mediaId,
    ratingKey: opts.ratingKey,
    grandparentRatingKey: opts.artistRatingKey,
    mediaType: 'track',
    playerName: 'Plexamp',
    platform: 'iOS',
    state: 'stopped',
    referenceId: opts.referenceId ?? null,
    durationMs: 200_000,
    totalDurationMs: 320_000,
    progressMs: 200_000,
    watched: true,
    startedAt: opts.startedAt,
    stoppedAt: new Date(opts.startedAt.getTime() + 200_000),
  });
  return session.id;
}

export async function seedArtistOnTwoServers(): Promise<MusicScenario> {
  const serverA = (await createTestServer({ type: 'plex' })).id;
  const serverB = (await createTestServer({ type: 'jellyfin' })).id;
  const accountA = await createTestServerUser({
    serverId: serverA,
    userId: (await createTestUser()).id,
  });
  const accountB = await createTestServerUser({
    serverId: serverB,
    userId: (await createTestUser()).id,
  });

  const artistMediaId = await resolveMediaForItem({
    mediaType: 'artist',
    musicBrainzId: '056e4f3e-d505-4dad-8ec1-d04f521cbb56',
    title: ARTIST,
    serverId: serverA,
    ratingKey: 'artist-a',
  });
  const albumMediaIds = new Map<string, string>();
  const trackMediaIds = new Map<string, string>();
  for (const album of ALBUMS) {
    albumMediaIds.set(
      album.title,
      await resolveMediaForItem({
        mediaType: 'album',
        title: album.title,
        parentTitle: ARTIST,
        serverId: serverA,
        ratingKey: `${album.title}-a`,
      })
    );
    trackMediaIds.set(
      album.track,
      await resolveMediaForItem({
        mediaType: 'track',
        title: album.track,
        grandparentTitle: ARTIST,
        parentTitle: album.title,
        serverId: serverA,
        ratingKey: `${album.track}-a`,
        grandparentRatingKey: 'artist-a',
      })
    );
  }

  const albumsNewestFirst: MusicScenario['albumsNewestFirst'] = [];
  let addedMonth = 0;
  for (const [serverId, suffix] of [
    [serverA, 'a'],
    [serverB, 'b'],
  ] as const) {
    const artistKey = `artist-${suffix}`;
    await createTestLibraryItem({
      serverId,
      ratingKey: artistKey,
      title: ARTIST,
      mediaType: 'artist',
      mediaId: artistMediaId,
      genres: ['Electronic'],
      createdAt: new Date('2023-11-01T12:00:00Z'),
      withoutVersion: true,
    });
    await setArt(serverId, artistKey, null);
    for (const album of ALBUMS) {
      const albumKey = `${album.title}-${suffix}`;
      await createTestLibraryItem({
        serverId,
        ratingKey: albumKey,
        title: album.title,
        mediaType: 'album',
        year: album.year,
        parentRatingKey: artistKey,
        mediaId: albumMediaIds.get(album.title) ?? null,
        createdAt: new Date(Date.UTC(2024, addedMonth++, 10)),
        withoutVersion: true,
      });
      await setArt(serverId, albumKey, ARTIST);
      albumsNewestFirst.unshift({ serverId, ratingKey: albumKey, title: album.title });
      await createTestLibraryItem({
        serverId,
        ratingKey: `${album.track}-${suffix}`,
        title: album.track,
        mediaType: 'track',
        grandparentRatingKey: artistKey,
        parentRatingKey: albumKey,
        mediaId: trackMediaIds.get(album.track) ?? null,
        fileSize: 9_000_000,
      });
    }
  }

  const orphanTrackId = await resolveMediaForItem({
    mediaType: 'track',
    title: 'Lost Track',
    grandparentTitle: 'Steve Aoki, Rich the Kid',
    parentTitle: 'How Else (Remixes)',
    serverId: serverA,
    ratingKey: 'orphan-track',
    grandparentRatingKey: 'artist-missing',
  });
  await createTestLibraryItem({
    serverId: serverA,
    ratingKey: 'orphan-album',
    title: 'How Else (Remixes)',
    mediaType: 'album',
    year: 2017,
    parentRatingKey: 'artist-missing',
    mediaId: await resolveMediaForItem({
      mediaType: 'album',
      title: 'How Else (Remixes)',
      parentTitle: 'Steve Aoki, Rich the Kid',
      serverId: serverA,
      ratingKey: 'orphan-album',
    }),
    createdAt: new Date('2024-12-01T00:00:00Z'),
    withoutVersion: true,
  });
  await createTestLibraryItem({
    serverId: serverA,
    ratingKey: 'orphan-track',
    title: 'Lost Track',
    mediaType: 'track',
    grandparentRatingKey: 'artist-missing',
    parentRatingKey: 'orphan-album',
    mediaId: orphanTrackId,
    fileSize: 7_000_000,
  });

  const midnight = new Date();
  midnight.setUTCHours(0, 0, 0, 0);
  midnight.setUTCDate(midnight.getUTCDate() - 3);
  const oneMoreTime = trackMediaIds.get('One More Time') ?? '';
  const beforeMidnight = await playTrack({
    serverId: serverA,
    serverUserId: accountA.id,
    mediaId: oneMoreTime,
    ratingKey: 'One More Time-a',
    artistRatingKey: 'artist-a',
    startedAt: new Date(midnight.getTime() - 5 * 60_000),
  });
  await playTrack({
    serverId: serverA,
    serverUserId: accountA.id,
    mediaId: oneMoreTime,
    ratingKey: 'One More Time-a',
    artistRatingKey: 'artist-a',
    startedAt: new Date(midnight.getTime() + 60_000),
    referenceId: beforeMidnight,
  });
  await playTrack({
    serverId: serverA,
    serverUserId: accountA.id,
    mediaId: trackMediaIds.get('Da Funk') ?? '',
    ratingKey: 'Da Funk-a',
    artistRatingKey: 'artist-a',
    startedAt: new Date(midnight.getTime() + 6 * 3_600_000),
  });
  await playTrack({
    serverId: serverB,
    serverUserId: accountB.id,
    mediaId: oneMoreTime,
    ratingKey: 'One More Time-b',
    artistRatingKey: 'artist-b',
    startedAt: new Date(midnight.getTime() + 24 * 3_600_000),
  });
  await playTrack({
    serverId: serverA,
    serverUserId: accountA.id,
    mediaId: orphanTrackId,
    ratingKey: 'orphan-track',
    artistRatingKey: 'artist-missing',
    startedAt: new Date(midnight.getTime() + 8 * 3_600_000),
  });

  await db.execute(
    sql`CALL refresh_continuous_aggregate('user_media_plays_daily'::regclass, NULL, NULL)`
  );

  return { serverA, serverB, artistMediaId, albumsNewestFirst };
}
