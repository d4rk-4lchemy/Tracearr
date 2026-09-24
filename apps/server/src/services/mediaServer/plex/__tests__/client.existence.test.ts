import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as HttpModule from '../../../../utils/http.js';
import { PlexClient } from '../client.js';

vi.mock('../../../../utils/http.js', async (importOriginal) => ({
  ...(await importOriginal<typeof HttpModule>()),
  fetchJson: vi.fn(),
  fetchText: vi.fn(),
  plexHeaders: vi.fn().mockReturnValue({ 'X-Plex-Token': 'test-token' }),
}));

import { fetchJson, HttpClientError } from '../../../../utils/http.js';

const mockFetchJson = vi.mocked(fetchJson);

function makeClient() {
  return new PlexClient({ url: 'http://plex.local:32400', token: 'test-token' });
}

function notFound() {
  return new HttpClientError({
    service: 'plex',
    statusCode: 404,
    statusText: 'Not Found',
    url: 'http://plex.local:32400/library/metadata/1',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PlexClient findExistingRatingKeys', () => {
  it('returns the keys the section still has, dropping the ones the lookup left out', async () => {
    mockFetchJson.mockResolvedValue({
      MediaContainer: { Metadata: [{ ratingKey: '2733', librarySectionID: 3 }] },
    });

    const existing = await makeClient().findExistingRatingKeys(['2733', '999999999'], {
      id: '3',
      type: 'movie',
    });

    expect([...existing]).toEqual(['2733']);
    expect(mockFetchJson.mock.calls[0]?.[0]).toBe(
      'http://plex.local:32400/library/metadata/2733,999999999'
    );
  });

  it('treats a 404 as a batch with no survivors and keeps going', async () => {
    mockFetchJson.mockRejectedValue(notFound());

    const existing = await makeClient().findExistingRatingKeys(['1', '2'], {
      id: '3',
      type: 'movie',
    });

    expect(existing.size).toBe(0);
  });

  it('rethrows any other failure so the scan keeps its items', async () => {
    mockFetchJson.mockRejectedValue(new Error('ECONNRESET'));

    await expect(
      makeClient().findExistingRatingKeys(['1'], { id: '3', type: 'movie' })
    ).rejects.toThrow('ECONNRESET');
  });
});

describe('PlexClient checkFilesExist', () => {
  it('reports each version by Media id and asks with checkFiles', async () => {
    mockFetchJson.mockResolvedValue({
      MediaContainer: {
        Metadata: [
          {
            ratingKey: '2733',
            Media: [
              { id: 42858, Part: [{ file: '/data/a.mkv', accessible: true, exists: true }] },
              { id: 42859, Part: [{ file: '/data/b.mkv', accessible: false, exists: false }] },
            ],
          },
        ],
      },
    });

    const result = await makeClient().checkFilesExist(['2733']);

    expect(mockFetchJson.mock.calls[0]?.[0]).toBe(
      'http://plex.local:32400/library/metadata/2733?checkFiles=1'
    );
    expect([...(result.get('2733') ?? [])]).toEqual([
      ['42858', true],
      ['42859', false],
    ]);
  });

  // Plex omits the attributes on servers that don't run the check; a file we
  // cannot prove missing must read as present.
  it('treats a version with no exists attribute as present', async () => {
    mockFetchJson.mockResolvedValue({
      MediaContainer: {
        Metadata: [{ ratingKey: '7', Media: [{ id: 11, Part: [{ file: '/data/c.mkv' }] }] }],
      },
    });

    const result = await makeClient().checkFilesExist(['7']);

    expect(result.get('7')?.get('11')).toBe(true);
  });

  it('counts a multi-part version as missing when any part is gone', async () => {
    mockFetchJson.mockResolvedValue({
      MediaContainer: {
        Metadata: [
          {
            ratingKey: '9',
            Media: [
              {
                id: 21,
                Part: [
                  { file: '/data/cd1.avi', exists: true, accessible: true },
                  { file: '/data/cd2.avi', exists: false, accessible: false },
                ],
              },
            ],
          },
        ],
      },
    });

    const result = await makeClient().checkFilesExist(['9']);

    expect(result.get('9')?.get('21')).toBe(false);
  });

  it('returns nothing for a batch the server 404s instead of failing the check', async () => {
    mockFetchJson.mockRejectedValue(notFound());

    const result = await makeClient().checkFilesExist(['1', '2']);

    expect(result.size).toBe(0);
  });
});
