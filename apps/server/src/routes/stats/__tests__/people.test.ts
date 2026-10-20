/**
 * People route tests
 *
 * The service is mocked: these assert the permission gate and the parsed query it receives.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import { randomUUID } from 'node:crypto';
import type { AuthUser } from '@tracearr/shared';
import type * as PeopleStatsModule from '../../../services/stats/peopleStats.js';

vi.mock('../../../db/client.js', () => ({ db: {} }));

vi.mock('../../../services/stats/peopleStats.js', async (importActual) => ({
  ...(await importActual<typeof PeopleStatsModule>()),
  queryPeopleRanked: vi.fn(async () => ({ data: [], summary: {}, meta: {} })),
}));

import { queryPeopleRanked } from '../../../services/stats/peopleStats.js';
import { peopleRoutes } from '../people.js';
import { permissionGuard } from '../../../lib/scope.js';

const mockPeople = vi.mocked(queryPeopleRanked);

async function buildTestApp(authUser: AuthUser): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(sensible);
  app.decorate('authenticate', async (request: any) => {
    request.user = authUser;
  });
  app.decorate('requirePermission', permissionGuard(app));
  await app.register(peopleRoutes, { prefix: '/stats' });
  return app;
}

describe('GET /stats/people', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 404 for a member calling /stats/people', async () => {
    app = await buildTestApp({
      userId: randomUUID(),
      username: 'member',
      role: 'member',
      serverIds: [],
    });
    const response = await app.inject({ url: '/stats/people' });
    expect(response.statusCode).toBe(404);
    expect(mockPeople).not.toHaveBeenCalled();
  });

  it('defaults rank to plays, page to 1 and pageSize to 20', async () => {
    app = await buildTestApp({
      userId: randomUUID(),
      username: 'owner',
      role: 'owner',
      serverIds: [],
    });
    const response = await app.inject({ url: '/stats/people' });
    expect(response.statusCode).toBe(200);
    expect(mockPeople).toHaveBeenCalledWith(
      expect.objectContaining({ rank: 'plays', page: 1, pageSize: 20, search: undefined })
    );
    expect(mockPeople.mock.calls[0]?.[0].window.period).toBe('week');
  });
});
