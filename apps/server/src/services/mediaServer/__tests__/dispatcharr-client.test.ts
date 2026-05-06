import { afterEach, describe, expect, it, vi } from 'vitest';
import { DispatcharrClient } from '../dispatcharr/client.js';

function jsonResponse(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DispatcharrClient', () => {
  it('fetches users, expands channel details, and filters anonymous sessions', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.['X-API-Key']).toBe('api-key');

      if (url.endsWith('/api/accounts/users/')) {
        return jsonResponse([
          { id: 7, first_name: 'Valid', last_name: 'User', username: 'valid' },
          { id: 8, first_name: 'Anonymous', last_name: '', username: 'anonymous' },
        ]);
      }
      if (url.endsWith('/proxy/ts/status')) {
        return jsonResponse({
          channels: [
            { channel_id: 'channel-1', client_count: 2 },
            { channel_id: 'channel-2', client_count: 1 },
          ],
        });
      }
      if (url.endsWith('/proxy/ts/status/channel-1')) {
        return jsonResponse({
          channel_id: 'channel-1',
          channel_name: 'Channel One',
          clients: [
            { client_id: 'client-1', user_id: '7', ip_address: '198.51.100.10' },
            { client_id: 'anon-client', user_id: '8', ip_address: '198.51.100.11' },
          ],
        });
      }
      if (url.endsWith('/proxy/ts/status/channel-2')) {
        return jsonResponse({
          channel_id: 'channel-2',
          channel_name: 'Channel Two',
          clients: [{ client_id: 'anonymous-zero', user_id: '0' }],
        });
      }

      return jsonResponse({ error: 'not found' }, { status: 404 });
    });

    const client = new DispatcharrClient({ url: 'http://dispatcharr.local/', token: 'api-key' });
    const sessions = await client.getSessions();

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.sessionKey).toBe('channel-1:client-1');
    expect(sessions[0]?.user.username).toBe('Valid User');
  });

  it('uses bearer auth for JWT-like tokens', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.Authorization).toBe('Bearer a.b.c');
      return jsonResponse([]);
    });

    const client = new DispatcharrClient({ url: 'http://dispatcharr.local', token: 'a.b.c' });
    await client.getUsers();
  });

  it('terminates sessions using stop_client endpoint', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ success: true }));
    const client = new DispatcharrClient({ url: 'http://dispatcharr.local', token: 'api-key' });

    await expect(client.terminateSession('channel-1:client-1')).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://dispatcharr.local/proxy/ts/stop_client/channel-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ client_id: 'client-1' }),
      })
    );
  });
});
