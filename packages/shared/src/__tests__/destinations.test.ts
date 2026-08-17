import { describe, expect, it } from 'vitest';
import {
  DESTINATION_KINDS,
  DESTINATION_TYPES,
  destinationConfigSchema,
  createDestinationSchema,
  updateDestinationSchema,
  sendActionSchema,
  actionSchema,
} from '../index.js';

describe('DESTINATION_TYPES', () => {
  it('has a descriptor for every kind, and every descriptor names its kind', () => {
    for (const kind of DESTINATION_KINDS) {
      expect(DESTINATION_TYPES[kind].kind).toBe(kind);
    }
  });
  it('built-ins have no fields and cannot receive plugin updates', () => {
    for (const kind of ['push', 'web_toast'] as const) {
      expect(DESTINATION_TYPES[kind].builtin).toBe(true);
      expect(DESTINATION_TYPES[kind].fields).toEqual([]);
      expect(DESTINATION_TYPES[kind].events).not.toContain('plugin_update_available');
    }
  });
  it('every url field is secret and every secret field is marked', () => {
    for (const kind of DESTINATION_KINDS) {
      for (const f of DESTINATION_TYPES[kind].fields) {
        if (f.input === 'url') expect(f.secret).toBe(true);
        if (f.input === 'secret') expect(f.secret).toBe(true);
      }
    }
  });
});

describe('destinationConfigSchema', () => {
  it('discord requires a webhook url', () => {
    expect(destinationConfigSchema('discord').safeParse({}).success).toBe(false);
    expect(
      destinationConfigSchema('discord').safeParse({
        webhookUrl: 'https://discord.com/api/webhooks/x',
      }).success
    ).toBe(true);
  });
  it('ntfy: url required, topic defaults to tracearr, token optional', () => {
    const r = destinationConfigSchema('ntfy').safeParse({ url: 'https://ntfy.sh' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.topic).toBe('tracearr');
    expect(
      destinationConfigSchema('ntfy').safeParse({ url: 'https://ntfy.sh', topic: '' }).success
    ).toBe(false);
  });
  it('pushover requires both keys and has no url', () => {
    expect(destinationConfigSchema('pushover').safeParse({ userKey: 'u' }).success).toBe(false);
    expect(
      destinationConfigSchema('pushover').safeParse({ userKey: 'u', apiToken: 't' }).success
    ).toBe(true);
    expect(DESTINATION_TYPES.pushover.fields.some((f) => f.input === 'url')).toBe(false);
  });
  it('rejects unknown keys', () => {
    expect(
      destinationConfigSchema('discord').safeParse({ webhookUrl: 'https://x', extra: 1 }).success
    ).toBe(false);
  });
});

describe('createDestinationSchema', () => {
  it('rejects built-in types; events are checked against the type by the route, not here', () => {
    expect(
      createDestinationSchema.safeParse({
        name: 'x',
        type: 'push',
        config: {},
        events: [],
        enabled: true,
      }).success
    ).toBe(false);
    expect(
      createDestinationSchema.safeParse({
        name: 'x',
        type: 'discord',
        config: { webhookUrl: 'https://x' },
        events: ['plugin_update_available'],
        enabled: true,
      }).success
    ).toBe(true);
    expect(
      updateDestinationSchema.safeParse({ events: ['stream_started'], enabled: false }).success
    ).toBe(true);
  });
});

describe('send action', () => {
  it('requires at least one destination id and accepts cooldown', () => {
    expect(sendActionSchema.safeParse({ type: 'send', to: [] }).success).toBe(false);
    expect(
      actionSchema.safeParse({
        type: 'send',
        to: ['3f2c8f0e-1c4d-4c1a-9c2e-6f0b6f5c9a11'],
        cooldown_minutes: 5,
      }).success
    ).toBe(true);
    expect(actionSchema.safeParse({ type: 'notify', channels: ['push'] }).success).toBe(false);
  });
});
