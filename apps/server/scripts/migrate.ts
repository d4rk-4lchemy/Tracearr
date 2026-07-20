import { loadRuntime } from './lib/bootstrap.js';

const { closeDatabase, migrationFolders, runMigrations } = await loadRuntime();

try {
  await runMigrations(migrationFolders);
  console.log('Upstream and fork migrations complete.');
} finally {
  await closeDatabase();
}
