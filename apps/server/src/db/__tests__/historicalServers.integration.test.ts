import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetTestDb } from '@tracearr/test-utils/db';
import { db } from '../client.js';
import { servers } from '../schema.js';
import { isLiveServer, liveServers } from '../../services/liveServers.js';
import { serverOrderBy } from '../../utils/serverOrder.js';

describe('historical servers', () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it('adds a nullable historical_at that liveServers() filters on', async () => {
    const column = await db.execute(sql`
      SELECT data_type, is_nullable FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'servers' AND column_name = 'historical_at'
    `);
    expect(column.rows[0]).toEqual({
      data_type: 'timestamp with time zone',
      is_nullable: 'YES',
    });

    const [attic, basement] = await db
      .insert(servers)
      .values([
        { name: 'Attic', type: 'jellyfin', url: 'http://192.168.1.20:8096', token: 'tok' },
        {
          name: 'Basement',
          type: 'plex',
          url: 'http://192.168.1.10:32400',
          token: 'tok',
          historicalAt: new Date('2026-09-01T00:00:00Z'),
        },
      ])
      .returning({ id: servers.id });
    if (!attic || !basement) throw new Error('insert returned no rows');

    expect((await liveServers()).map((s) => s.id)).toEqual([attic.id]);
    expect(await isLiveServer(attic.id)).toBe(true);
    expect(await isLiveServer(basement.id)).toBe(false);
  });

  it('lists live servers first whatever their display order', async () => {
    await db.insert(servers).values([
      {
        name: 'Old Plex',
        type: 'plex',
        url: 'http://10.0.0.1:32400',
        token: 'tok',
        displayOrder: 0,
        historicalAt: new Date('2026-09-01T00:00:00Z'),
      },
      { name: 'Zeta', type: 'emby', url: 'http://10.0.0.3:8096', token: 'tok', displayOrder: 2 },
      {
        name: 'alpha',
        type: 'jellyfin',
        url: 'http://10.0.0.2:8096',
        token: 'tok',
        displayOrder: 2,
      },
    ]);

    const rows = await db
      .select({ name: servers.name })
      .from(servers)
      .orderBy(...serverOrderBy());
    expect(rows.map((r) => r.name)).toEqual(['alpha', 'Zeta', 'Old Plex']);
  });
});
