const command = process.argv[2] ?? 'This command';

console.error(
  `${command} is disabled in the Dispatcharr fork. ` +
    'Merge upstream migration files as-is, or create a fork overlay migration with db:fork:generate.'
);
process.exitCode = 1;
