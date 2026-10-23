import { normalizeTitle } from '../library/mediaMatchKey.js';
import type { SessionIdentity } from '../../jobs/poller/database.js';

interface TitledPlay {
  mediaType: string;
  title: string | null | undefined;
  year: number | null | undefined;
}

/**
 * An imported play's rating key is only evidence while the key still names the same item.
 * The key is taken as reused only when that is provable: the item is of another media type,
 * or both the normalized title and the year disagree beyond the resolver's own tolerance of
 * a year either way. A renamed item or a year off by one still stamps by key.
 */
export function libraryKeyProvablyReused(item: TitledPlay, play: TitledPlay): boolean {
  const typed = (mediaType: string) => mediaType === 'movie' || mediaType === 'episode';
  if (typed(item.mediaType) && typed(play.mediaType) && item.mediaType !== play.mediaType) {
    return true;
  }
  if (normalizeTitle(item.title ?? '') === normalizeTitle(play.title ?? '')) return false;
  if (item.year == null || play.year == null) return false;
  return Math.abs(item.year - play.year) > 1;
}

/** The library identity a rating key gives an imported play, or none when the key is provably reused. */
export function importIdentityByKey(
  identity: SessionIdentity | undefined,
  play: TitledPlay
): SessionIdentity | undefined {
  if (!identity) return undefined;
  const item = {
    mediaType: identity.itemMediaType,
    title: identity.itemTitle ?? null,
    year: identity.itemYear ?? null,
  };
  return libraryKeyProvablyReused(item, play) ? undefined : identity;
}
