import type { LocationStats } from '@tracearr/shared';
import type { HistoryFilters } from '@/hooks/queries/useHistory';
import { getCountryName } from '@/lib/utils';

export function locationKey(
  l: Pick<LocationStats, 'city' | 'region' | 'country' | 'isLocal'>
): string {
  return JSON.stringify([l.country, l.region, l.city, l.isLocal]);
}

export function locationName(l: Pick<LocationStats, 'city' | 'region' | 'country'>): string {
  return l.city ?? l.region ?? getCountryName(l.country) ?? '';
}

export interface MapContext {
  serverIds?: string[];
  serverUserIds?: string[];
  mediaType?: 'movie' | 'episode' | 'track';
  /** The current period/from/to keys, copied verbatim. */
  range: URLSearchParams;
}

/** The History filters that match exactly the sessions behind one location. */
export function locationHistoryFilters(
  l: LocationStats
): Pick<
  HistoryFilters,
  'geoCountries' | 'geoCity' | 'geoCityMissing' | 'geoRegion' | 'geoRegionMissing' | 'network'
> {
  return {
    ...(l.country === null ? {} : { geoCountries: [l.country] }),
    ...(l.city === null ? { geoCityMissing: true } : { geoCity: l.city }),
    ...(l.region === null ? { geoRegionMissing: true } : { geoRegion: l.region }),
    network: l.isLocal ? 'local' : 'remote',
  };
}

export function locationHistoryParams(l: LocationStats, ctx: MapContext): URLSearchParams {
  const f = locationHistoryFilters(l);
  const params = new URLSearchParams();
  if (f.geoCountries) params.set('countries', f.geoCountries.join(','));
  if (f.geoCity !== undefined) params.set('city', f.geoCity);
  if (f.geoCityMissing) params.set('noCity', 'true');
  if (f.geoRegion !== undefined) params.set('region', f.geoRegion);
  if (f.geoRegionMissing) params.set('noRegion', 'true');
  if (f.network) params.set('network', f.network);
  if (ctx.serverIds?.length) params.set('serverIds', ctx.serverIds.join(','));
  if (ctx.serverUserIds?.length) params.set('userIds', ctx.serverUserIds.join(','));
  if (ctx.mediaType) params.set('mediaTypes', ctx.mediaType);
  for (const key of ['period', 'from', 'to']) {
    const value = ctx.range.get(key);
    if (value !== null) params.set(key, value);
  }
  return params;
}
