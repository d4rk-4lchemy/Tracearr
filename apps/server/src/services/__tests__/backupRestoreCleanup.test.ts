import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnCalls: Array<{ cmd: string; args: string[] }> = [];

// Replace only spawn; other modules in backup.ts's import graph use execFile etc.
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: vi.fn((cmd: string, args: string[]) => {
    spawnCalls.push({ cmd, args });
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    process.nextTick(() => child.emit('close', 0));
    return child;
  }),
}));

vi.mock('../../db/client.js', () => ({
  db: {},
  runMigrations: vi.fn(),
  closeDatabase: vi.fn(),
  recreatePool: vi.fn(),
}));
vi.mock('../settings.js', () => ({
  getSetting: vi.fn(),
}));

import { restoreDatabase } from '../backup.js';

describe('restoreDatabase cleanup', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    spawnCalls.length = 0;
    process.env.DATABASE_URL = 'postgres://tracearr:secret@localhost:5432/tracearr';
  });

  afterEach(() => {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it('drops the fork migration ledger schema before restoring the dump', async () => {
    await restoreDatabase('/tmp/backup.dump');

    const cleanup = spawnCalls.find(
      (call) => call.cmd === 'psql' && call.args.join(' ').includes('DROP SCHEMA public CASCADE')
    );
    expect(cleanup).toBeDefined();

    const sql = cleanup!.args[cleanup!.args.indexOf('-c') + 1] ?? '';
    expect(sql).toContain('DROP SCHEMA IF EXISTS tracearr_fork CASCADE;');
    // Must run before pg_restore, which would otherwise hit "schema already exists".
    const cleanupIndex = spawnCalls.indexOf(cleanup!);
    const restoreIndex = spawnCalls.findIndex((call) => call.cmd === 'pg_restore');
    expect(restoreIndex).toBeGreaterThan(cleanupIndex);
  });
});
