/**
 * normalize_resolutions maintenance job integration tests.
 *
 * Sessions ingested before the resolution classifier fix could have `quality`
 * stamped wrong by the old strict width/height cutoffs (e.g. 1916x1036 landed
 * on "720p" instead of "1080p"). Confirms the job recomputes quality from
 * source_video_width/source_video_height using the shared dimension ladder,
 * leaves dimension-less rows untouched, and is safe to re-run.
 *
 * Run with: pnpm --filter @tracearr/server test:integration -- normalizeResolutions
 */

import { describe, it, expect } from 'vitest';
import type { Job } from 'bullmq';
import {
  createTestUser,
  createTestServer,
  createTestServerUser,
  createTestSession,
} from '@tracearr/test-utils/factories';
import { executeRawSql } from '@tracearr/test-utils/db';
import { db } from '../../src/db/client.js';
import { sessions } from '../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import {
  processNormalizeResolutionsJob,
  type MaintenanceJobData,
} from '../../src/jobs/maintenanceQueue.js';

function fakeJob(): Job<MaintenanceJobData> {
  return {
    id: 'test-normalize-resolutions',
    token: 'test-token',
    data: { type: 'normalize_resolutions', userId: 'owner' },
    updateProgress: async () => undefined,
    extendLock: async () => undefined,
  } as unknown as Job<MaintenanceJobData>;
}

async function setDimensions(sessionId: string, width: number | null, height: number | null) {
  await executeRawSql(`
    UPDATE sessions
    SET source_video_width = ${width ?? 'NULL'}, source_video_height = ${height ?? 'NULL'}
    WHERE id = '${sessionId}'
  `);
}

describe('normalize_resolutions maintenance job', () => {
  it('relabels widescreen sessions mislabeled by the old cutoff classifier', async () => {
    const server = await createTestServer({ type: 'jellyfin' });
    const user = await createTestUser({ role: 'member' });
    const serverUser = await createTestServerUser({ userId: user.id, serverId: server.id });

    // Old bug: 1916x1036 landed on "720p" (width just under the 1920 cutoff,
    // height just under 1080). The shared ladder correctly calls this 1080p.
    const wrongLabel = await createTestSession({
      serverId: server.id,
      serverUserId: serverUser.id,
      quality: '720p',
    });
    await setDimensions(wrongLabel.id, 1916, 1036);

    // Already correct - should be left alone (counted as skipped, not updated).
    const alreadyCorrect = await createTestSession({
      serverId: server.id,
      serverUserId: serverUser.id,
      quality: '1080p',
    });
    await setDimensions(alreadyCorrect.id, 1920, 1080);

    // No dimensions stored - the job must never touch this row.
    const noDims = await createTestSession({
      serverId: server.id,
      serverUserId: serverUser.id,
      quality: '720p',
    });
    await setDimensions(noDims.id, null, null);

    const result = await processNormalizeResolutionsJob(fakeJob());

    expect(result.success).toBe(true);
    expect(result.updated).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.errors).toBe(0);

    const [fixed] = await db.select().from(sessions).where(eq(sessions.id, wrongLabel.id));
    expect(fixed?.quality).toBe('1080p');

    const [unchanged] = await db.select().from(sessions).where(eq(sessions.id, alreadyCorrect.id));
    expect(unchanged?.quality).toBe('1080p');

    const [untouched] = await db.select().from(sessions).where(eq(sessions.id, noDims.id));
    expect(untouched?.quality).toBe('720p');
  });

  it('is idempotent - a second run updates nothing', async () => {
    const server = await createTestServer({ type: 'jellyfin' });
    const user = await createTestUser({ role: 'member' });
    const serverUser = await createTestServerUser({ userId: user.id, serverId: server.id });

    const session = await createTestSession({
      serverId: server.id,
      serverUserId: serverUser.id,
      quality: '720p',
    });
    await setDimensions(session.id, 1916, 1036);

    const first = await processNormalizeResolutionsJob(fakeJob());
    expect(first.updated).toBe(1);

    const second = await processNormalizeResolutionsJob(fakeJob());
    expect(second.updated).toBe(0);
    expect(second.skipped).toBe(1);

    const [row] = await db.select().from(sessions).where(eq(sessions.id, session.id));
    expect(row?.quality).toBe('1080p');
  });

  it('relabels 4:3 content mislabeled by the width-only Jellyfin/Emby bug', async () => {
    const server = await createTestServer({ type: 'emby' });
    const user = await createTestUser({ role: 'member' });
    const serverUser = await createTestServerUser({ userId: user.id, serverId: server.id });

    // 4:3 content: 1440 wide is only "720p" by width, but 1080 tall is 1080p.
    const session = await createTestSession({
      serverId: server.id,
      serverUserId: serverUser.id,
      quality: '720p',
    });
    await setDimensions(session.id, 1440, 1080);

    const result = await processNormalizeResolutionsJob(fakeJob());
    expect(result.updated).toBe(1);

    const [row] = await db.select().from(sessions).where(eq(sessions.id, session.id));
    expect(row?.quality).toBe('1080p');
  });
});
