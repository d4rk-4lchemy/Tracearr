import { describe, expect, it, vi } from 'vitest';

const { mockLimit, mockWhere } = vi.hoisted(() => ({
  mockLimit: vi.fn(),
  mockWhere: vi.fn(),
}));

vi.mock('../../db/client.js', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (...args: unknown[]) => {
          mockWhere(...args);
          return Object.assign(Promise.resolve([{ id: 'live-1' }]), { limit: mockLimit });
        },
      }),
    }),
  },
}));

import { renderSql } from '../../test/helpers.js';
import {
  HISTORICAL_EDIT_MESSAGE,
  HISTORICAL_IMPORT_MESSAGE,
  ServerHistoricalError,
  isLiveRow,
  isLiveServer,
  liveServerCondition,
  liveServers,
} from '../liveServers.js';
import type { SQL } from 'drizzle-orm';

describe('liveServers', () => {
  it('treats a null or absent historicalAt as live and a date as historical', () => {
    expect(isLiveRow({ historicalAt: null })).toBe(true);
    expect(isLiveRow({})).toBe(true);
    expect(isLiveRow({ historicalAt: new Date('2026-09-01T00:00:00Z') })).toBe(false);
  });

  it('filters on historical_at is null', async () => {
    await liveServers();
    const where = mockWhere.mock.calls[0]?.[0] as SQL;
    expect(renderSql(where).sql).toContain('servers.historical_at is null');
    expect(renderSql(liveServerCondition).sql).toBe('servers.historical_at is null');
  });

  it('answers isLiveServer from a one-row lookup that carries the same condition', async () => {
    mockLimit.mockResolvedValueOnce([{ id: 'srv-1' }]);
    expect(await isLiveServer('srv-1')).toBe(true);
    mockLimit.mockResolvedValueOnce([]);
    expect(await isLiveServer('srv-2')).toBe(false);
    const where = mockWhere.mock.calls.at(-1)?.[0] as SQL;
    const rendered = renderSql(where);
    expect(rendered.sql).toContain('servers.historical_at is null');
    expect(rendered.params).toContain('srv-2');
  });

  it('names the server in the error and carries the 409 copy', () => {
    const error = new ServerHistoricalError('srv-1');
    expect(error.serverId).toBe('srv-1');
    expect(error.name).toBe('ServerHistoricalError');
    expect(HISTORICAL_EDIT_MESSAGE).toBe('Resume this server to change its address or key');
    expect(HISTORICAL_IMPORT_MESSAGE).toBe('Resume this server to import into it');
  });
});
