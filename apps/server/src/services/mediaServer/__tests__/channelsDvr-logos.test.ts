import { beforeEach, describe, expect, it, vi } from 'vitest';

const lookupMock = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', () => ({ lookup: lookupMock }));

import {
  channelLogoPath,
  parseChannelLogoPath,
  parseGuideChannelLogos,
  resolveLogoUrl,
} from '../channelsDvr/logos.js';
import { SsrfBlockedError } from '../../../utils/ssrf.js';

const BASE = 'http://192.168.1.50:8089';

describe('channel logo routes', () => {
  it('round-trips safe channel numbers', () => {
    for (const n of ['1', '1429', '35.1', 'ABC_7']) {
      expect(parseChannelLogoPath(channelLogoPath(n)!)).toBe(n);
    }
  });

  it('rejects unsafe channel numbers and paths', () => {
    expect(channelLogoPath('../x')).toBeNull();
    expect(channelLogoPath('')).toBeNull();
    expect(channelLogoPath('a/b')).toBeNull();
    expect(parseChannelLogoPath('/dvr/guide/channels/../logo')).toBeNull();
    expect(parseChannelLogoPath('/dvr/guide/channels/1/logo?x=1')).toBeNull();
    expect(parseChannelLogoPath('/poster.jpg')).toBeNull();
  });
});

describe('parseGuideChannelLogos', () => {
  it('maps channel numbers to Image URLs and skips entries without one', () => {
    const logos = parseGuideChannelLogos({
      '1': { Number: '1', Name: 'ABC KOCO', Image: 'https://cdn.example.com/ABCKOCO.png' },
      '2': { Number: '2', Name: 'No logo' },
      '3': { Number: '3', Image: '   ' },
    });
    expect([...logos.entries()]).toEqual([['1', 'https://cdn.example.com/ABCKOCO.png']]);
  });

  it('returns nothing for malformed responses', () => {
    expect(parseGuideChannelLogos(null).size).toBe(0);
    expect(parseGuideChannelLogos([]).size).toBe(0);
    expect(parseGuideChannelLogos('nope').size).toBe(0);
  });
});

describe('resolveLogoUrl', () => {
  beforeEach(() => {
    lookupMock.mockReset();
    lookupMock.mockResolvedValue([{ address: '104.18.0.1', family: 4 }]);
  });

  it('allows paths on the Channels DVR server itself', async () => {
    await expect(resolveLogoUrl(BASE, '/tmsimg/assets/s1_ll_h15_aa.png')).resolves.toBe(
      `${BASE}/tmsimg/assets/s1_ll_h15_aa.png`
    );
    await expect(resolveLogoUrl(BASE, `${BASE}/dvr/uploads/3/content`)).resolves.toBe(
      `${BASE}/dvr/uploads/3/content`
    );
  });

  it('rejects other local paths and protocol-relative URLs', async () => {
    await expect(resolveLogoUrl(BASE, '/dvr/settings')).rejects.toThrow(SsrfBlockedError);
    await expect(resolveLogoUrl(BASE, '//evil.example/x.png')).rejects.toThrow();
  });

  it('allows https logos on public hostnames', async () => {
    await expect(resolveLogoUrl(BASE, 'https://cdn.iptvboss.pro/logos/USA/ABCKOCO.us.png')).resolves.toBe(
      'https://cdn.iptvboss.pro/logos/USA/ABCKOCO.us.png'
    );
  });

  it.each([
    'http://cdn.example.com/logo.png',
    'https://127.0.0.1/logo.png',
    'https://192.168.1.10/logo.png',
    'https://[::1]/logo.png',
    'https://localhost/logo.png',
    'https://intranet/logo.png',
    'https://user:pass@cdn.example.com/logo.png',
    'file:///etc/passwd',
  ])('rejects %s', async (raw) => {
    await expect(resolveLogoUrl(BASE, raw)).rejects.toThrow();
  });

  it('rejects hostnames that resolve to private addresses', async () => {
    lookupMock.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    await expect(resolveLogoUrl(BASE, 'https://cdn.example.com/logo.png')).rejects.toThrow(
      SsrfBlockedError
    );
    lookupMock.mockResolvedValue([
      { address: '104.18.0.1', family: 4 },
      { address: '::ffff:7f00:1', family: 6 },
    ]);
    await expect(resolveLogoUrl(BASE, 'https://cdn.example.com/logo.png')).rejects.toThrow(
      SsrfBlockedError
    );
  });
});
