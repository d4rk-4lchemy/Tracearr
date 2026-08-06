import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import type { AuthUser } from '@tracearr/shared';
import type { SQL } from 'drizzle-orm';
import { renderSql } from '../../../test/helpers.js';

vi.mock('../../../db/client.js', () => ({
  db: {
    execute: vi.fn(),
  },
}));

vi.mock('../../../utils/serverFiltering.js', async () => {
  const { sql } = await import('drizzle-orm');
  return {
    resolveServerIds: vi.fn(() => undefined),
    buildMultiServerFragment: vi.fn(() => sql``),
    buildServerAccessCondition: vi.fn(),
  };
});

import { db } from '../../../db/client.js';
import { usersRoutes } from '../users.js';

const owner: AuthUser = {
  userId: 'owner-id',
  username: 'owner',
  role: 'owner',
  serverIds: [],
};

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(sensible);
  app.decorate('authenticate', async (request: { user: AuthUser }) => {
    request.user = owner;
  });
  await app.register(usersRoutes, { prefix: '/stats' });
  return app;
}

describe('User activity stats routes', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.execute).mockResolvedValue({ rows: [] } as never);
  });

  afterEach(async () => {
    await app?.close();
  });

  it.each(['/stats/users?period=all', '/stats/top-users?period=all'])(
    'includes Live TV in %s',
    async (url) => {
      app = await buildTestApp();
      const response = await app.inject({ method: 'GET', url });

      expect(response.statusCode).toBe(200);
      const { sql: query } = renderSql(vi.mocked(db.execute).mock.calls[0]![0] as SQL);
      expect(query).toContain("s.media_type IN ('movie', 'episode', 'live')");
      expect(query).not.toContain("s.media_type IN ('movie', 'episode')");
    }
  );
});
