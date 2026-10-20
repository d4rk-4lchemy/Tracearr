export interface MediaVerbKeys {
  watched: string;
  watchTime: string;
}

const MUSIC_VERB_KEYS = {
  watched: 'common:playback.played',
  watchTime: 'common:labels.listenTime',
} as const satisfies MediaVerbKeys;

/** Translation keys for the "watched" and "watch time" wording, by media type. */
export const MEDIA_VERB_KEYS = {
  track: MUSIC_VERB_KEYS,
  album: MUSIC_VERB_KEYS,
  artist: MUSIC_VERB_KEYS,
  default: {
    watched: 'common:playback.watched',
    watchTime: 'common:labels.watchTime',
  },
} as const satisfies Record<'track' | 'album' | 'artist' | 'default', MediaVerbKeys>;

/** The literal key pairs, so callers can hand them straight to a typed `t`. */
export type MediaVerbKeySet = (typeof MEDIA_VERB_KEYS)[keyof typeof MEDIA_VERB_KEYS];

export function verbKeysFor(mediaType: string | null | undefined): MediaVerbKeySet {
  return mediaType && Object.hasOwn(MEDIA_VERB_KEYS, mediaType)
    ? MEDIA_VERB_KEYS[mediaType as keyof typeof MEDIA_VERB_KEYS]
    : MEDIA_VERB_KEYS.default;
}
