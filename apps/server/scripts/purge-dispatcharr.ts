#!/usr/bin/env node
/**
 * Dispatcharr data purge script.
 *
 * Removes every Dispatcharr server from the database before switching a forked
 * install back to the official Tracearr image. Related data is deleted through
 * existing database cascades.
 *
 * Usage:
 *   Interactive:
 *     docker exec -it tracearr node apps/server/dist/scripts/purge-dispatcharr.js
 *
 *   Non-interactive:
 *     docker exec tracearr node apps/server/dist/scripts/purge-dispatcharr.js -y
 */

import readline from 'node:readline';
import { listDispatcharrServers, purgeDispatcharrCommand, shutdown } from './lib/commands.ts';

const USAGE = `Tracearr Dispatcharr Data Purge

Usage:
  purge-dispatcharr
  purge-dispatcharr -y

Options:
  -y    Skip confirmation prompt. Intended for non-interactive shells.
`;

function askConfirmation(): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolvePrompt) => {
    rl.question('Type Y to permanently delete all Dispatcharr data: ', (answer) => {
      rl.close();
      resolvePrompt(answer);
    });
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const assumeYes = args.length === 1 && args[0] === '-y';

  if (args.length > 1 || (args.length === 1 && !assumeYes)) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  Tracearr Dispatcharr Data Purge');
  console.log('═══════════════════════════════════════════════════\n');

  try {
    const dispatcharrServers = await listDispatcharrServers();

    if (dispatcharrServers.length === 0) {
      console.log('No Dispatcharr servers found. Nothing to purge.\n');
      return;
    }

    console.log('This will permanently delete all Dispatcharr servers and related data.');
    console.log(
      'Deleted data includes Dispatcharr users, sessions, violations, rules, logs, and library rows.'
    );
    console.log('\nDispatcharr servers that will be deleted:');
    for (const server of dispatcharrServers) {
      console.log(`  - ${server.name} (${server.id})`);
      console.log(`    ${server.url}`);
    }
    console.log();

    if (assumeYes) {
      console.log('Confirmation supplied by -y.\n');
    } else {
      const answer = await askConfirmation();
      if (answer !== 'Y') {
        console.error('\nConfirmation failed. No data was deleted.\n');
        process.exitCode = 1;
        return;
      }
      console.log();
    }

    const result = await purgeDispatcharrCommand();
    console.log(`Deleted ${result.servers.length} Dispatcharr server(s).`);
    if (result.redisWarning) {
      console.warn(`WARNING: ${result.redisWarning}`);
      console.warn('Database purge succeeded; stale Redis entries should expire automatically.');
    }
    console.log('Stop this forked container before starting the official Tracearr image.\n');
  } catch (error) {
    console.error('\nERROR: Dispatcharr purge failed:\n');
    console.error(`   ${error instanceof Error ? error.message : 'Unknown error'}\n`);
    if (error instanceof Error && process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exitCode = 1;
  } finally {
    await shutdown();
  }
}

main().catch((error) => {
  console.error('\nFatal error:', error);
  process.exit(1);
});
