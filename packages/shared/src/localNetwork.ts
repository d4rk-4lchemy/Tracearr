/** geo_country on a local session with no server location, and the suffix automation text puts on a placed one. */
export const LOCAL_NETWORK_COUNTRY = 'Local Network';

/** A local session carrying its server's location instead of the Local Network label. */
export function isPlacedLocal(location: { isLocal: boolean; country: string | null }): boolean {
  return (
    location.isLocal && location.country !== null && location.country !== LOCAL_NETWORK_COUNTRY
  );
}
