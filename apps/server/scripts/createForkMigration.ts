import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface MigrationJournalEntry {
  idx: number;
  version: '7';
  when: number;
  tag: string;
  breakpoints: true;
}

interface MigrationJournal {
  version: '7';
  dialect: 'postgresql';
  entries: MigrationJournalEntry[];
}

const __dirname = dirname(fileURLToPath(import.meta.url));

function forkMigrationsDirectory(): string {
  const sourceDirectory = resolve(__dirname, '../src/db/fork-migrations');
  if (existsSync(sourceDirectory)) return sourceDirectory;
  return resolve(__dirname, '../../src/db/fork-migrations');
}

function usage(): never {
  console.error('Usage: pnpm --filter @tracearr/server db:fork:generate -- <migration-name>');
  process.exit(1);
}

const name = process.argv[2];
if (!name) usage();

const slug = name
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');
if (!slug) usage();

const migrationsDirectory = forkMigrationsDirectory();
const metaDirectory = resolve(migrationsDirectory, 'meta');
const journalPath = resolve(metaDirectory, '_journal.json');
const journal = JSON.parse(await readFile(journalPath, 'utf-8')) as MigrationJournal;
const last = journal.entries.at(-1);
const idx = (last?.idx ?? -1) + 1;
const tag = `${String(idx).padStart(4, '0')}_${slug}`;
const sqlPath = resolve(migrationsDirectory, `${tag}.sql`);

if (existsSync(sqlPath)) {
  throw new Error(`Fork migration already exists: ${sqlPath}`);
}

const when = Math.max(Date.now(), (last?.when ?? 0) + 1);
journal.entries.push({ idx, version: '7', when, tag, breakpoints: true });

await mkdir(metaDirectory, { recursive: true });
await writeFile(sqlPath, `-- ${name}\n`, 'utf-8');
await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, 'utf-8');
console.log(`Created fork migration ${tag}.`);
