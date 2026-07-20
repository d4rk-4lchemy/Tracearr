import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MigrationFolders } from './client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveMigrationFolder(folderName: string): string {
  // Development/test source: apps/server/src/db/<folderName>
  const sourceFolder = resolve(__dirname, folderName);
  if (existsSync(sourceFolder)) return sourceFolder;

  // Production: apps/server/dist/db -> apps/server/src/db/<folderName>
  return resolve(__dirname, '../../src/db', folderName);
}

export const migrationFolders: MigrationFolders = {
  upstream: resolveMigrationFolder('migrations'),
  fork: resolveMigrationFolder('fork-migrations'),
};
