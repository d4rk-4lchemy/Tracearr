import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ViolationWithDetails } from '@tracearr/shared';
import { createMockActiveSession } from '../../../test/fixtures.js';
import { discordType, type DiscordEmbed } from '../destinations/discord.js';
import type { RenderContext } from '../destinations/types.js';

const config = { webhookUrl: 'https://discord.com/api/webhooks/123/abc' };
const destination = { id: 'dest-1', name: 'My Discord' };
const systemCtx: RenderContext = { destination, source: { kind: 'system' } };
const deliverCtx = { destination, signal: AbortSignal.timeout(5000) };

const violation: ViolationWithDetails = {
  id: 'violation-123',
  ruleId: 'rule-456',
  serverUserId: 'user-789',
  sessionId: 'session-123',
  severity: 'warning',
  data: { reason: 'test violation' },
  acknowledgedAt: null,
  createdAt: new Date('2026-01-02T03:04:05.000Z'),
  user: {
    id: 'user-789',
    username: 'testuser',
    serverId: 'server-id',
    thumbUrl: null,
    identityName: 'Test User',
  },
  rule: { id: 'rule-456', name: 'Test Rule', type: 'concurrent_streams' },
};

const session = createMockActiveSession({ durationMs: 3_725_000 });

const fieldNames = (embed: DiscordEmbed): string[] => (embed.fields ?? []).map((f) => f.name);

const render = async (
  event: Parameters<typeof discordType.render>[0],
  ctx: RenderContext = systemCtx
): Promise<DiscordEmbed> => discordType.render(event, config, ctx);

describe('discordType.render', () => {
  it('builds the violation embed with severity color and rule fields', async () => {
    const embed = await render({ type: 'violation', payload: violation });

    expect(embed.title).toBe('Violation Detected');
    expect(embed.color).toBe(0xf39c12);
    expect(fieldNames(embed)).toEqual(['User', 'Rule', 'Severity']);
    expect(embed.fields?.[0]).toEqual({ name: 'User', value: 'Test User', inline: true });
    expect(embed.fields?.[1]).toEqual({ name: 'Rule', value: 'Test Rule', inline: true });
  });

  it('builds the stream started embed', async () => {
    const embed = await render({ type: 'session_started', payload: session });

    expect(embed.title).toBe('Stream Started');
    expect(embed.color).toBe(0x3498db);
    expect(fieldNames(embed)).toEqual([
      'User',
      'Media',
      'Episode',
      'Playback',
      'Location',
      'Player',
    ]);
    expect(embed.fields?.[3]?.value).toBe('Direct Play');
    expect(embed.fields?.[4]?.value).toBe('New York, US');
  });

  it('builds the stream stopped embed with a formatted duration', async () => {
    const embed = await render({ type: 'session_stopped', payload: session });

    expect(embed.title).toBe('Stream Ended');
    expect(embed.color).toBe(0x95a5a6);
    expect(fieldNames(embed)).toEqual(['User', 'Media', 'Episode', 'Duration']);
    expect(embed.fields?.[3]?.value).toBe('1h 2m');
  });

  it('builds the server down embed', async () => {
    const embed = await render({
      type: 'server_down',
      payload: { serverName: 'Plex Server', serverId: 's1' },
    });

    expect(embed).toEqual({
      title: 'Server Connection Lost',
      description: 'Lost connection to Plex Server',
      color: 0xff0000,
    });
  });

  it('builds the server up embed', async () => {
    const embed = await render({
      type: 'server_up',
      payload: { serverName: 'Plex Server', serverId: 's1' },
    });

    expect(embed).toEqual({
      title: 'Server Back Online',
      description: 'Plex Server is back online',
      color: 0x2ecc71,
    });
  });

  it('builds the plugin update embed', async () => {
    const embed = await render({
      type: 'plugin_update_available',
      payload: {
        serverId: 'server-1',
        serverName: 'Jellyfin',
        serverType: 'jellyfin',
        installedVersion: '0.2.0',
        latestVersion: '0.3.0',
        downloadUrl: 'https://example.com/plugin.zip',
      },
    });

    expect(embed.title).toBe('Plugin Update Available');
    expect(embed.color).toBe(0xf39c12);
    expect(embed.description).toContain('Jellyfin: ');
    expect(embed.description).toContain('latest 0.3.0');
  });

  it('uses the rule source title for a rule send', async () => {
    const embed = await render(
      { type: 'violation', payload: violation },
      { destination, source: { kind: 'rule', title: 'Rule fired', message: 'Too many streams' } }
    );

    expect(embed.title).toBe('Rule fired');
    expect(fieldNames(embed)).toEqual(['User', 'Rule', 'Severity']);
  });
});

describe('discordType.deliver', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the embed as a Tracearr webhook message', async () => {
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', f);

    await discordType.deliver({ title: 'Stream Started', color: 0x3498db }, config, deliverCtx);

    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] ?? [];
    expect(url).toBe(config.webhookUrl);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    const body = JSON.parse(init.body);
    expect(body.username).toBe('Tracearr');
    expect(body.embeds).toHaveLength(1);
    expect(body.embeds[0]).toMatchObject({ title: 'Stream Started', color: 0x3498db });
    expect(typeof body.embeds[0].timestamp).toBe('string');
  });

  it('throws when Discord rejects the webhook', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad payload', { status: 400 })));

    await expect(
      discordType.deliver({ title: 'Stream Started', color: 0x3498db }, config, deliverCtx)
    ).rejects.toThrow(/400 bad payload/);
  });

  it('posts the test embed', async () => {
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', f);

    await discordType.test(config, deliverCtx);

    const body = JSON.parse(f.mock.calls[0]?.[1].body);
    expect(body.embeds[0].title).toBe('Test Notification');
    expect(body.embeds[0].description).toBe('This is a test notification from Tracearr');
    expect(body.embeds[0].color).toBe(0x3498db);
  });
});
