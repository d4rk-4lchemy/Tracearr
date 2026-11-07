#!/usr/bin/env node
/**
 * Channels DVR data purge script.
 *
 * Removes every Channels DVR server from the database before switching a forked
 * install back to the official Tracearr image. Related data is deleted through
 * existing database cascades.
 *
 * Channels DVR needs no schema cleanup (it adds no fork columns), so unlike
 * purge-dispatcharr this script never alters tables. Run purge-dispatcharr
 * separately if you also added a Dispatcharr server.
 *
 * Usage:
 *   Interactive:
 *     docker exec -it tracearr node apps/server/dist/scripts/purge-channels-dvr.js
 *
 *   Non-interactive:
 *     docker exec tracearr node apps/server/dist/scripts/purge-channels-dvr.js -y
 */

import readline from 'node:readline';
import { listChannelsDvrServers, purgeChannelsDvrCommand, shutdown } from './lib/commands.ts';

const USAGE = `Tracearr Channels DVR Data Purge

Usage:
  purge-channels-dvr
  purge-channels-dvr -y

Options:
  -y    Skip confirmation prompt. Intended for non-interactive shells.
`;

function askConfirmation(): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolvePrompt) => {
    rl.question('Type Y to permanently delete all Channels DVR data: ', (answer) => {
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
  console.log('  Tracearr Channels DVR Data Purge');
  console.log('═══════════════════════════════════════════════════\n');

  try {
    const channelsDvrServers = await listChannelsDvrServers();

    if (channelsDvrServers.length === 0) {
      console.log('No Channels DVR servers found. Nothing to purge.\n');
      return;
    }

    console.log('This will permanently delete all Channels DVR servers and related data.');
    console.log(
      'Deleted data includes Channels DVR users, sessions, violations, rules, logs, and library rows.'
    );
    console.log('\nChannels DVR servers that will be deleted:');
    for (const server of channelsDvrServers) {
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

    const result = await purgeChannelsDvrCommand();
    console.log(`Deleted ${result.servers.length} Channels DVR server(s).`);
    if (result.redisWarning) {
      console.warn(`WARNING: ${result.redisWarning}`);
      console.warn('Database purge succeeded; stale Redis entries should expire automatically.');
    }
    console.log('Stop this forked container before starting the official Tracearr image.\n');
  } catch (error) {
    console.error('\nERROR: Channels DVR purge failed:\n');
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
