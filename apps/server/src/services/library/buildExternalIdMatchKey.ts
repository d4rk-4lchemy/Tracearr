import { sql, type SQL } from 'drizzle-orm';
import type { libraryItems } from '../../db/schema.js';

export function buildExternalIdMatchKey(table: typeof libraryItems): SQL {
  return sql`COALESCE(
    CASE WHEN ${table.imdbId} IS NOT NULL AND ${table.imdbId} <> '' THEN 'imdb:' || ${table.imdbId} END,
    CASE WHEN ${table.tmdbId} IS NOT NULL THEN 'tmdb:' || ${table.tmdbId}::text END,
    CASE WHEN ${table.tvdbId} IS NOT NULL THEN 'tvdb:' || ${table.tvdbId}::text END,
    NULLIF('title:' || LOWER(REGEXP_REPLACE(COALESCE(${table.title}, ''), '[^a-zA-Z0-9]', '', 'g')), 'title:')
  )`;
}
