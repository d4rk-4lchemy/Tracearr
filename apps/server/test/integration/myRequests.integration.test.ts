/**
 * listUserRequests against a real database: the poster lateral join on library_items and the
 * availableThisWeek count. requests.test.ts mocks db.execute, so it cannot prove either.
 *
 * Run with: pnpm --filter @tracearr/server test:integration myRequests
 */

import { beforeAll, describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  createTestLibraryItem,
  createTestServer,
  createTestServerUser,
  createTestUser,
} from '@tracearr/test-utils/factories';
import { db } from '../../src/db/client.js';
import { resolveMediaForItem } from '../../src/services/library/mediaResolutionService.js';
import { initDestinationCrypto } from '../../src/services/notifications/destinationCrypto.js';
import { listUserRequests } from '../../src/services/requests/reads.js';
import { createRequestService } from '../../src/services/requests/store.js';

const MACHINE_ID = 'my-requests-machine';
const THUMB = '/library/metadata/4242/thumb/1';

describe("a person's own requests", () => {
  beforeAll(() => {
    initDestinationCrypto();
  });

  it('carry a proxied poster and count what became available this week', async () => {
    const server = await createTestServer({ type: 'plex' });
    await db.execute(
      sql`UPDATE servers SET machine_identifier = ${MACHINE_ID} WHERE id = ${server.id}`
    );
    const account = await createTestServerUser({
      serverId: server.id,
      userId: (await createTestUser({ role: 'member' })).id,
    });
    const someoneElse = await createTestServerUser({
      serverId: server.id,
      userId: (await createTestUser({ role: 'member' })).id,
    });

    const movieId = await resolveMediaForItem({
      mediaType: 'movie',
      tmdbId: 820_001,
      title: 'Poster Movie',
      year: 2022,
      serverId: server.id,
      ratingKey: 'mr-movie',
    });
    await createTestLibraryItem({
      serverId: server.id,
      ratingKey: 'mr-movie',
      title: 'Poster Movie',
      mediaType: 'movie',
      mediaId: movieId,
    });
    await db.execute(
      sql`UPDATE library_items SET thumb_path = ${THUMB} WHERE media_id = ${movieId}`
    );

    const service = await createRequestService({
      serverId: server.id,
      type: 'seerr',
      name: 'My Requests Seerr',
      url: 'http://seerr.mine.test',
      apiKey: 'mine-api-key',
      remoteServerId: MACHINE_ID,
      version: '1.33.2',
    });
    const insert = (remoteId: number, serverUserId: string, availableDaysAgo: number) =>
      db.execute(sql`
        INSERT INTO media_requests (
          service_id, remote_id, remote_media_id, media_type, media_id, server_user_id,
          remote_user_id, remote_username, status, requested_at, available_at,
          remote_updated_at, synced_at
        ) VALUES (
          ${service.id}, ${remoteId}, ${remoteId}, 'movie', ${movieId}, ${serverUserId},
          ${remoteId}, 'requester', 'completed',
          now() - interval '40 days', now() - make_interval(days => ${availableDaysAgo}),
          now(), now()
        )
      `);
    await insert(9101, account.id, 2);
    await insert(9102, account.id, 30);
    await insert(9103, someoneElse.id, 1);

    const result = await listUserRequests({
      serverUserIds: [account.id],
      showOthers: false,
      serverIds: [server.id],
      page: 1,
      pageSize: 4,
    });

    expect(result.total).toBe(2);
    expect(result.summary.availableThisWeek).toBe(1);
    const posterUrl = result.data[0]?.media.posterUrl ?? '';
    expect(posterUrl).toMatch(/^\/api\/v1\/images\/proxy\?/);
    const params = new URLSearchParams(posterUrl.split('?')[1]);
    expect(params.get('server')).toBe(server.id);
    expect(params.get('url')).toBe(THUMB);
  });
});
