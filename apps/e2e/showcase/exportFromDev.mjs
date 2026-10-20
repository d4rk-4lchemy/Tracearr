#!/usr/bin/env node
/**
 * Pulls artwork and title metadata out of a real Tracearr install so the
 * showcase seed can render a library that looks lived-in. Reads the dev
 * database and the server's image cache (data/image-cache); square music art
 * the cache lacks is requested through the dev server's image proxy, and a
 * title whose art cannot be had is left out. Nothing about users, sessions or
 * servers is read. Output lands in apps/e2e/showcase/assets/ (git-ignored):
 *
 *   assets/titles.json         [{ type, title, year, genres, resolution, dynamicRange, fileSize, poster }]
 *   assets/music.json          [{ name, genres, art, albums: [{ title, year, genres, art, tracks: [{ title }] }] }]
 *   assets/posters/<n>.webp    360x540 poster already resized by the proxy
 *   assets/posters/sq<n>.webp  360x360 artist or album art
 *
 *   node apps/e2e/showcase/exportFromDev.mjs [--movies 80] [--shows 30] [--artists 24]
 *
 * DEV_DATABASE_URL defaults to the root .env DATABASE_URL, DEV_SERVER_ID to
 * the first plex server, DEV_MUSIC_SERVER_ID to the server with the most
 * artists, DEV_IMAGE_CACHE to apps/server/data/image-cache and DEV_SERVER_URL
 * to http://localhost:3000.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
try {
  process.loadEnvFile(resolve(repoRoot, '.env'));
} catch {
  // .env is optional when DEV_DATABASE_URL is given
}

/**
 * @typedef {{ type: 'movie' | 'show', title: string, year: number, genres: string[] | null,
 *   resolution: string | null, dynamicRange: string | null, fileSize: string | null,
 *   thumbPath: string, ratingKey: string }} ItemRow
 * @typedef {Omit<ItemRow, 'thumbPath' | 'ratingKey' | 'fileSize' | 'genres'> &
 *   { genres: string[], fileSize: number | null, poster: string }} Title
 * @typedef {{ title: string, year: number | null, genres: string[] | null, thumbPath: string,
 *   ratingKey: string }} MusicRow
 * @typedef {{ title: string, year: number | null, genres: string[], art: string,
 *   tracks: { title: string }[] }} Album
 * @typedef {{ name: string, genres: string[], art: string, albums: Album[] }} Artist
 */

const args = process.argv.slice(2);
/** @param {string} name @param {number} fallback */
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(args[i + 1]);
};
const movieCount = arg('movies', 80);
const showCount = arg('shows', 30);
const artistCount = arg('artists', 24);
const ALBUMS_PER_ARTIST = 4;
const TRACKS_PER_ALBUM = 12;

const databaseUrl = process.env.DEV_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DEV_DATABASE_URL or DATABASE_URL is required');
  process.exit(1);
}
const cacheDir = process.env.DEV_IMAGE_CACHE ?? resolve(repoRoot, 'apps/server/data/image-cache');
const proxyBase = process.env.DEV_SERVER_URL ?? 'http://localhost:3000';
const outDir = resolve(here, 'assets');
const posterDir = resolve(outDir, 'posters');
rmSync(posterDir, { recursive: true, force: true });
mkdirSync(posterDir, { recursive: true });

// Mirrors apps/server/src/services/imageProxy.ts: key is the first 16 hex of
// sha256(server:path:width:height), sharded by its first two chars, and
// posters carry a version suffix of the first 8 hex of sha1(path).
/** @param {string} thumbPath */
const versionOf = (thumbPath) => createHash('sha1').update(thumbPath).digest('hex').slice(0, 8);

/** @param {string} serverId @param {string} thumbPath @param {number} height */
function cachedPosterPath(serverId, thumbPath, height = 540) {
  const key = createHash('sha256')
    .update(`${serverId}:${thumbPath}:360:${height}`)
    .digest('hex')
    .slice(0, 16);
  return resolve(cacheDir, key.slice(0, 2), `${key}:v${versionOf(thumbPath)}.webp`);
}

let squareCount = 0;

/**
 * Copies one 360x360 entry out of the cache, or asks the proxy for it. The
 * proxy answers a dead upstream with an svg placeholder, which counts as no
 * art. Returns the file name under posters/, or null.
 * @param {string} serverId @param {string} thumbPath
 */
async function squareArt(serverId, thumbPath) {
  const name = `sq${squareCount + 1}.webp`;
  const target = resolve(posterDir, name);
  const cached = cachedPosterPath(serverId, thumbPath, 360);
  if (existsSync(cached)) {
    copyFileSync(cached, target);
  } else {
    const params = new URLSearchParams({
      server: serverId,
      url: thumbPath,
      width: '360',
      height: '360',
      fallback: 'poster',
      v: versionOf(thumbPath),
    });
    let response = await fetch(`${proxyBase}/api/v1/images/proxy?${params}`);
    while (response.status === 429) {
      await response.body?.cancel();
      const resetSeconds = Number(response.headers.get('x-ratelimit-reset') ?? 60);
      await new Promise((done) => setTimeout(done, (resetSeconds + 1) * 1000));
      response = await fetch(`${proxyBase}/api/v1/images/proxy?${params}`);
    }
    if (!response.ok || response.headers.get('content-type') !== 'image/webp') {
      await response.body?.cancel();
      return null;
    }
    writeFileSync(target, Buffer.from(await response.arrayBuffer()));
  }
  squareCount += 1;
  return name;
}

/** @param {string[] | null} genres */
const firstGenres = (genres) => (genres ?? []).slice(0, 3);

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  const serverId =
    process.env.DEV_SERVER_ID ??
    /** @type {{ rows: { id: string }[] }} */ (
      await client.query(
        `SELECT id FROM servers WHERE type = 'plex' ORDER BY display_order LIMIT 1`
      )
    ).rows[0]?.id;
  if (!serverId) throw new Error('no plex server in the dev database');

  const { rows } = /** @type {{ rows: ItemRow[] }} */ (
    await client.query(
      `SELECT media_type AS type, title, year, genres, video_resolution AS resolution,
            video_dynamic_range AS "dynamicRange", file_size AS "fileSize", thumb_path AS "thumbPath",
            rating_key AS "ratingKey"
     FROM library_items
     WHERE server_id = $1 AND media_type IN ('movie', 'show') AND thumb_path IS NOT NULL
       AND removed_at IS NULL AND year IS NOT NULL
     ORDER BY created_at DESC`,
      [serverId]
    )
  );

  /** @type {{ movie: Title[], show: Title[] }} */
  const picked = { movie: [], show: [] };
  const limits = { movie: movieCount, show: showCount };
  const seenTitles = new Set();
  let n = 0;
  for (const row of rows) {
    if (picked[row.type].length >= limits[row.type]) continue;
    const key = `${row.type}:${row.title}:${row.year}`;
    if (seenTitles.has(key)) continue;
    const source = cachedPosterPath(serverId, row.thumbPath);
    if (!existsSync(source)) continue;
    seenTitles.add(key);
    n += 1;
    const poster = `${n}.webp`;
    copyFileSync(source, resolve(posterDir, poster));
    picked[row.type].push({
      type: row.type,
      title: row.title,
      year: row.year,
      genres: row.genres ?? [],
      resolution: row.resolution,
      dynamicRange: row.dynamicRange,
      fileSize: row.fileSize === null ? null : Number(row.fileSize),
      poster,
    });
  }

  const titles = [...picked.movie, ...picked.show];
  writeFileSync(resolve(outDir, 'titles.json'), JSON.stringify(titles, null, 2) + '\n');
  console.log(
    `${picked.movie.length} movies and ${picked.show.length} shows with cached posters written to ${outDir}`
  );

  const musicServerId =
    process.env.DEV_MUSIC_SERVER_ID ??
    /** @type {{ rows: { server_id: string }[] }} */ (
      await client.query(
        `SELECT server_id FROM library_items
          WHERE media_type = 'artist' AND removed_at IS NULL
          GROUP BY server_id ORDER BY count(*) DESC LIMIT 1`
      )
    ).rows[0]?.server_id;
  if (!musicServerId) throw new Error('no artists in the dev database');

  // Artists with the most albums first: the seed features the first one.
  const { rows: artistRows } = /** @type {{ rows: MusicRow[] }} */ (
    await client.query(
      `SELECT ar.title, ar.genres, ar.thumb_path AS "thumbPath", ar.rating_key AS "ratingKey"
         FROM library_items ar
         JOIN library_items al ON al.server_id = ar.server_id AND al.parent_rating_key = ar.rating_key
          AND al.media_type = 'album' AND al.removed_at IS NULL AND al.thumb_path IS NOT NULL
        WHERE ar.server_id = $1 AND ar.media_type = 'artist' AND ar.removed_at IS NULL
          AND ar.thumb_path IS NOT NULL
        GROUP BY ar.id
        ORDER BY count(*) DESC, ar.title`,
      [musicServerId]
    )
  );

  /** @type {Artist[]} */
  const artists = [];
  const seenArtists = new Set();
  for (const artistRow of artistRows) {
    if (artists.length >= artistCount) break;
    if (seenArtists.has(artistRow.title)) continue;
    const { rows: albumRows } = /** @type {{ rows: MusicRow[] }} */ (
      await client.query(
        `SELECT title, year, genres, thumb_path AS "thumbPath", rating_key AS "ratingKey"
           FROM library_items
          WHERE server_id = $1 AND parent_rating_key = $2 AND media_type = 'album'
            AND removed_at IS NULL AND thumb_path IS NOT NULL
          ORDER BY year DESC NULLS LAST, title`,
        [musicServerId, artistRow.ratingKey]
      )
    );
    /** @type {Album[]} */
    const albums = [];
    const seenAlbums = new Set();
    for (const albumRow of albumRows) {
      if (albums.length >= ALBUMS_PER_ARTIST) break;
      if (seenAlbums.has(albumRow.title)) continue;
      const { rows: trackRows } = /** @type {{ rows: { title: string }[] }} */ (
        await client.query(
          `SELECT title FROM library_items
            WHERE server_id = $1 AND parent_rating_key = $2 AND media_type = 'track'
              AND removed_at IS NULL
            ORDER BY parent_index NULLS FIRST, item_index NULLS LAST, title
            LIMIT ${TRACKS_PER_ALBUM}`,
          [musicServerId, albumRow.ratingKey]
        )
      );
      if (trackRows.length === 0) continue;
      const albumArt = await squareArt(musicServerId, albumRow.thumbPath);
      if (!albumArt) continue;
      seenAlbums.add(albumRow.title);
      albums.push({
        title: albumRow.title,
        year: albumRow.year,
        genres: firstGenres(albumRow.genres),
        art: albumArt,
        tracks: trackRows.map((track) => ({ title: track.title })),
      });
    }
    if (albums.length === 0) continue;
    const art = await squareArt(musicServerId, artistRow.thumbPath);
    if (!art) {
      for (const album of albums) rmSync(resolve(posterDir, album.art));
      continue;
    }
    seenArtists.add(artistRow.title);
    artists.push({
      name: artistRow.title,
      genres: artistRow.genres?.length
        ? firstGenres(artistRow.genres)
        : (albums.find((album) => album.genres.length > 0)?.genres ?? []),
      art,
      albums,
    });
  }

  artists.sort((a, b) => b.albums.length - a.albums.length);
  writeFileSync(resolve(outDir, 'music.json'), JSON.stringify(artists, null, 2) + '\n');
  console.log(
    `${artists.length} artists and ${artists.reduce((sum, a) => sum + a.albums.length, 0)} albums with square art written to ${outDir}`
  );
} finally {
  await client.end();
}
