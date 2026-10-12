import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as HttpModule from '../../../../utils/http.js';

vi.mock('../../../../utils/http.js', async (importActual) => {
  const actual = await importActual<typeof HttpModule>();
  return { ...actual, fetchJson: vi.fn() };
});

import { fetchJson, HttpClientError } from '../../../../utils/http.js';
import { JellyfinClient } from '../client.js';

const mockFetchJson = vi.mocked(fetchJson);

const URL = 'http://jellyfin.local:8096';

function httpError(statusCode: number): HttpClientError {
  return new HttpClientError({
    service: 'jellyfin',
    statusCode,
    statusText: 'error',
    url: `${URL}/x`,
  });
}

/** Ordered resolver for the sequence of fetchJson calls a verify makes. */
function sequence(...steps: Array<{ resolve?: unknown; reject?: Error }>) {
  let call = 0;
  mockFetchJson.mockImplementation(async () => {
    const step = steps[call++];
    if (!step) throw new Error('unexpected fetchJson call');
    if (step.reject) throw step.reject;
    return step.resolve;
  });
}

describe('JellyfinClient.verifyServerAdmin', () => {
  beforeEach(() => {
    mockFetchJson.mockReset();
  });

  it('uses the standard Authorization header', async () => {
    sequence(
      { resolve: {} },
      { resolve: { Id: 'u1', Name: 'a', Policy: { IsAdministrator: true } } }
    );

    await JellyfinClient.verifyServerAdmin('key', URL);

    const usersMeCall = mockFetchJson.mock.calls[1];
    const headers = (usersMeCall?.[1]?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toContain('MediaBrowser');
    expect(headers).not.toHaveProperty('X-Emby-Authorization');
  });

  it('succeeds for an admin user token via /Users/Me', async () => {
    sequence(
      { resolve: {} },
      { resolve: { Id: 'u1', Name: 'a', Policy: { IsAdministrator: true } } }
    );

    const result = await JellyfinClient.verifyServerAdmin('key', URL);
    expect(result).toEqual({ success: true });
  });

  it('returns NOT_ADMIN for a non-admin user token', async () => {
    sequence(
      { resolve: {} },
      { resolve: { Id: 'u1', Name: 'a', Policy: { IsAdministrator: false } } }
    );

    const result = await JellyfinClient.verifyServerAdmin('key', URL);
    expect(result).toEqual({
      success: false,
      code: JellyfinClient.AdminVerifyError.NOT_ADMIN,
      message: expect.any(String),
    });
  });

  it('succeeds for an admin API key via /Auth/Keys (after /Users/Me 400)', async () => {
    sequence({ resolve: {} }, { reject: httpError(400) }, { resolve: {} });

    const result = await JellyfinClient.verifyServerAdmin('key', URL);
    expect(result).toEqual({ success: true });
  });

  it('returns INVALID_KEY when /Users/Me responds 401', async () => {
    sequence({ resolve: {} }, { reject: httpError(401) });

    const result = await JellyfinClient.verifyServerAdmin('bad', URL);
    expect(result).toMatchObject({
      success: false,
      code: JellyfinClient.AdminVerifyError.INVALID_KEY,
    });
  });

  it('returns INVALID_KEY when /Auth/Keys responds 401', async () => {
    sequence({ resolve: {} }, { reject: httpError(400) }, { reject: httpError(401) });

    const result = await JellyfinClient.verifyServerAdmin('bad', URL);
    expect(result).toMatchObject({
      success: false,
      code: JellyfinClient.AdminVerifyError.INVALID_KEY,
    });
  });

  it('returns NOT_ADMIN when /Auth/Keys responds 403', async () => {
    sequence({ resolve: {} }, { reject: httpError(400) }, { reject: httpError(403) });

    const result = await JellyfinClient.verifyServerAdmin('key', URL);
    expect(result).toMatchObject({
      success: false,
      code: JellyfinClient.AdminVerifyError.NOT_ADMIN,
    });
  });

  it('returns CONNECTION_FAILED when the server is unreachable', async () => {
    sequence({ reject: new Error('ECONNREFUSED') });

    const result = await JellyfinClient.verifyServerAdmin('key', URL);
    expect(result).toMatchObject({
      success: false,
      code: JellyfinClient.AdminVerifyError.CONNECTION_FAILED,
    });
  });
});

describe('JellyfinClient member sign-in', () => {
  beforeEach(() => {
    mockFetchJson.mockReset();
    vi.unstubAllGlobals();
  });

  function call(index = 0) {
    const [url, options] = mockFetchJson.mock.calls[index] ?? [];
    return { url, headers: (options?.headers ?? {}) as Record<string, string>, options };
  }

  it('posts Pw with the member device and the browser address', async () => {
    sequence({ resolve: { User: { Id: 'ext-1' }, AccessToken: 'member-token' } });

    const auth = await JellyfinClient.authenticateByName(
      URL,
      'alice',
      'pw',
      'tracearr-u1',
      '1.2.3.4'
    );

    expect(auth).toEqual({ externalId: 'ext-1', token: 'member-token' });
    const { url, headers, options } = call();
    expect(url).toBe(`${URL}/Users/AuthenticateByName`);
    expect(JSON.parse(String(options?.body))).toEqual({ Username: 'alice', Pw: 'pw' });
    expect(headers.Authorization).toBe(
      'MediaBrowser Client="Tracearr", Device="Tracearr Web", DeviceId="tracearr-u1", Version="1.0.0"'
    );
    expect(headers['X-Forwarded-For']).toBe('1.2.3.4');
  });

  it('answers null for a rejected password and leaves out an unknown address', async () => {
    sequence({ reject: httpError(401) });
    await expect(JellyfinClient.authenticateByName(URL, 'a', 'b', 'd', '')).resolves.toBeNull();
    expect(call().headers).not.toHaveProperty('X-Forwarded-For');
  });

  it('never follows a redirect on a call that carries a member password, secret or token', async () => {
    sequence(
      { resolve: { User: { Id: 'ext-1' }, AccessToken: 'member-token' } },
      { resolve: { Secret: 's', Code: 'c' } },
      { resolve: { Authenticated: false } },
      { resolve: { Id: 'ext-1' } }
    );

    await JellyfinClient.authenticateByName(URL, 'a', 'b', 'd', '');
    await JellyfinClient.quickConnectInitiate(URL, 'd');
    await JellyfinClient.quickConnectStatus(URL, 's');
    await JellyfinClient.fetchSelf(URL, 'tok');

    expect(mockFetchJson).toHaveBeenCalledTimes(4);
    for (const [, options] of mockFetchJson.mock.calls) expect(options?.redirect).toBe('manual');
  });

  it('refuses a link-local server url before any request', async () => {
    await expect(
      JellyfinClient.authenticateByName('http://169.254.169.254', 'a', 'b', 'd', '')
    ).rejects.toThrow();
    expect(mockFetchJson).not.toHaveBeenCalled();
  });

  it('reads a gone Quick Connect request as gone', async () => {
    sequence({ reject: httpError(404) });
    await expect(JellyfinClient.quickConnectStatus(URL, 'secret')).resolves.toBe('gone');
  });

  it('checks a member token with the token alone and reads a 401 as invalid', async () => {
    sequence(
      { resolve: { Id: 'ext-1', Policy: { IsDisabled: true } } },
      { reject: httpError(401) }
    );

    await expect(JellyfinClient.fetchSelf(URL, 'tok')).resolves.toEqual({
      id: 'ext-1',
      isDisabled: true,
    });
    expect(call().headers.Authorization).toBe('MediaBrowser Token="tok"');
    await expect(JellyfinClient.fetchSelf(URL, 'tok')).resolves.toBeNull();
  });

  it('logs a token out against an empty 204 and never fetches a link-local url', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await JellyfinClient.logoutUserToken(URL, 'tok');
    expect(fetchMock).toHaveBeenCalledWith(
      `${URL}/Sessions/Logout`,
      expect.objectContaining({ method: 'POST' })
    );

    await expect(JellyfinClient.logoutUserToken('http://169.254.169.254', 'tok')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
