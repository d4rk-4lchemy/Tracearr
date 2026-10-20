/**
 * Jellyfin and Emby give every track its own image path even when the bytes are
 * the album's cover, so the cache held one copy of each cover per track. Tracks
 * take their album's path at sync instead; a track whose album has no art keeps
 * its own.
 */

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { libraryItems } from '../../db/schema.js';
import type { MediaLibraryItem } from '../mediaServer/types.js';

// Jellyfin/Emby paths carry ?tag= only when the item had a Primary image at
// sync; an untagged /Items path 404s.
export function hasKnownImage(thumbPath: string): boolean {
  return !thumbPath.startsWith('/Items/') || thumbPath.includes('?tag=');
}

/** Album rating key to cover path, for the albums the batch's tracks belong to. */
export async function albumArtForTracks(
  serverId: string,
  items: MediaLibraryItem[]
): Promise<Map<string, string>> {
  const art = new Map<string, string>();
  const wanted = new Set<string>();
  for (const item of items) {
    if (item.mediaType === 'album') {
      if (item.thumbPath && hasKnownImage(item.thumbPath)) art.set(item.ratingKey, item.thumbPath);
    } else if (item.mediaType === 'track' && item.parentRatingKey) {
      wanted.add(item.parentRatingKey);
    }
  }
  for (const key of art.keys()) wanted.delete(key);
  if (wanted.size === 0) return art;

  const rows = await db
    .select({ ratingKey: libraryItems.ratingKey, thumbPath: libraryItems.thumbPath })
    .from(libraryItems)
    .where(
      and(
        eq(libraryItems.serverId, serverId),
        inArray(libraryItems.ratingKey, [...wanted]),
        eq(libraryItems.mediaType, 'album'),
        isNull(libraryItems.removedAt),
        sql`(${libraryItems.thumbPath} NOT LIKE '/Items/%' OR ${libraryItems.thumbPath} LIKE '%?tag=%')`
      )
    );
  for (const row of rows) {
    if (row.thumbPath) art.set(row.ratingKey, row.thumbPath);
  }
  return art;
}
