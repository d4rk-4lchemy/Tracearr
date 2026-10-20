import { describe, expect, it } from 'vitest';
import { verbKeysFor } from '../mediaVerbs.js';

describe('verbKeysFor', () => {
  it.each(['track', 'album', 'artist'])('uses played and listen time for %s', (mediaType) => {
    expect(verbKeysFor(mediaType)).toEqual({
      watched: 'common:playback.played',
      watchTime: 'common:labels.listenTime',
    });
  });

  it.each(['movie', 'episode', null, undefined])(
    'uses watched and watch time for %s',
    (mediaType) => {
      expect(verbKeysFor(mediaType)).toEqual({
        watched: 'common:playback.watched',
        watchTime: 'common:labels.watchTime',
      });
    }
  );
});
