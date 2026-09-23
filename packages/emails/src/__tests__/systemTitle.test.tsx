/**
 * The header name beside the logo and the attribution line beneath the footer.
 * Both templates carry their own shell, so both are checked here.
 */

import { describe, expect, it } from 'vitest';
import { defaultBranding, renderDigest, renderEvent, renderTest } from '../index.js';
import type { EmailBranding } from '../types.js';

function branding(overrides: Partial<EmailBranding> = {}): EmailBranding {
  return { ...defaultBranding('Basement Emby'), ...overrides };
}

const event = {
  subject: 'Added: Heat (1995)',
  title: 'Media added',
  message: 'Heat (1995) was added to Movies',
  severity: 'low' as const,
  timestamp: '2026-09-18T00:46:25Z',
  card: null,
  logoRef: null,
  appUrl: null,
};

const digest = {
  subject: 'This week',
  intro: null,
  outro: null,
  windowStart: 'Sep 1, 2026',
  windowEnd: 'Sep 8, 2026',
  movies: [],
  shows: [],
  artists: [],
  mostWatched: [],
  moreMovies: 0,
  moreShows: 0,
  moreAlbums: 0,
  moreWatched: 0,
  episodes: 0,
  logoRef: null,
  unsubscribeUrl: null,
  viewUrl: null,
  multiServer: false,
  serverNames: ['Basement Emby'],
  memberSend: true,
};

describe('system title', () => {
  it('heads an event email with the title over the sending server', async () => {
    const out = await renderEvent(event, branding({ systemTitle: 'Tracearr for Emby' }));

    expect(out.html).toContain('Tracearr for Emby');
    expect(out.html).toContain('Sent by Tracearr for Basement Emby.');
  });

  it('heads a digest with the title over the newsletter sender', async () => {
    const out = await renderDigest(digest, branding({ systemTitle: 'Tracearr for Emby' }));

    expect(out.html).toContain('Tracearr for Emby');
    expect(out.html).toContain('Sent by Tracearr for Basement Emby.');
  });

  it('falls back to the per-send name when no title is set', async () => {
    const titled = await renderEvent(event, branding({ systemTitle: 'Tracearr for Emby' }));
    const plain = await renderEvent(event, branding());

    expect(plain.html).toContain('Basement Emby');
    expect(plain.html).not.toContain('Tracearr for Emby');
    // Only the header differs; the attribution line names the server either way
    expect(titled.html.replace('Tracearr for Emby', 'Basement Emby')).toBe(plain.html);
  });

  it('drops the redundant "for" when the sender is Tracearr itself', async () => {
    const out = await renderTest(
      { destinationName: 'Ops inbox', logoRef: null },
      defaultBranding('Tracearr')
    );

    expect(out.html).toContain('Sent by Tracearr.');
    expect(out.html).not.toContain('Sent by Tracearr for Tracearr.');
  });
});
