import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../db/client.js', () => ({
  db: {
    select: vi.fn(),
  },
}));

import { db } from '../../../db/client.js';
import { albumArtForTracks, hasKnownImage } from '../trackArt.js';
import type { MediaLibraryItem } from '../../mediaServer/types.js';

const SERVER = '33333333-3333-4333-8333-333333333333';
const ALBUM_ART = '/Items/100/Images/Primary?tag=cover';

const item = (
  ratingKey: string,
  mediaType: MediaLibraryItem['mediaType'],
  thumbPath?: string,
  parentRatingKey?: string
): MediaLibraryItem => ({
  ratingKey,
  title: ratingKey,
  mediaType,
  addedAt: new Date(0),
  thumbPath,
  parentRatingKey,
});

let selected: { ratingKey: string; thumbPath: string | null }[];

beforeEach(() => {
  selected = [];
  vi.mocked(db.select).mockReset();
  vi.mocked(db.select).mockReturnValue({
    from: () => ({ where: async () => selected }),
  } as never);
});

describe('hasKnownImage', () => {
  it('trusts non-Items paths and tagged Items paths only', () => {
    expect(hasKnownImage('/library/metadata/1/thumb/2')).toBe(true);
    expect(hasKnownImage(ALBUM_ART)).toBe(true);
    expect(hasKnownImage('/Items/100/Images/Primary')).toBe(false);
  });
});

describe('albumArtForTracks', () => {
  it('reads albums from the batch first and skips the db when the batch covers every track', async () => {
    const art = await albumArtForTracks(SERVER, [
      item('100', 'album', ALBUM_ART, '1'),
      item('101', 'track', '/Items/101/Images/Primary?tag=a', '100'),
      item('200', 'album', '/Items/200/Images/Primary', '1'),
    ]);
    expect(art).toEqual(new Map([['100', ALBUM_ART]]));
    expect(db.select).not.toHaveBeenCalled();
  });

  it('looks up the albums of tracks the batch lacks and drops artless ones', async () => {
    selected = [{ ratingKey: '300', thumbPath: ALBUM_ART }];
    const art = await albumArtForTracks(SERVER, [
      item('301', 'track', '/Items/301/Images/Primary?tag=b', '300'),
      item('401', 'track', '/Items/401/Images/Primary?tag=c', '400'),
      item('500', 'episode', '/Items/500/Images/Primary?tag=d', '50'),
    ]);
    expect(art).toEqual(new Map([['300', ALBUM_ART]]));
    expect(db.select).toHaveBeenCalledTimes(1);
  });
});
