#!/usr/bin/env node

import { createRequire } from 'module';
import { Command } from 'commander';
import { installShutdownHandlers } from './lifecycle.js';
import { setConfigOverrides } from './config/loader.js';

installShutdownHandlers();

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

const program = new Command();

program
  .name('sweteam')
  .description("Autonomous coding agent orchestrator — turns high-level goals into PR'd code")
  .version(pkg.version)
  .option('--planner <agent>', 'Override planner agent for this session')
  .option('--coder <agent>', 'Override coder agent for this session')
  .option('--reviewer <agent>', 'Override reviewer agent for this session')
  .option('--parallel <count>', 'Override max parallel tasks', parseInt)
  .option('--config <path>', 'Use custom config file path')
  .option('--image <path...>', 'Image file paths to pass to the underlying CLI agent');

// Apply global CLI overrides before any command runs
program.hook('preAction', () => {
  const opts = program.opts();
  setConfigOverrides({
    planner: opts.planner,
    coder: opts.coder,
    reviewer: opts.reviewer,
    parallel: opts.parallel,
    configPath: opts.config,
  });
});

program
  .command('create')
  .description('Create a new session and enter planning chat')
  .argument('[repo]', 'Repository name or URL (defaults to current directory)')
  .action(async (repo?: string) => {
    const { handleCreate } = await import('./commands/create.js');
    const result = await handleCreate(repo);
    if (result) {
      const { runRepl } = await import('./repl/repl.js');
      const globalOpts = program.opts();
      await runRepl({
        initialSession: { ...result, goal: '' },
        images: globalOpts.image,
      });
    }
  });

program
  .command('list')
  .description('List all sessions with status')
  .option('--status <status>', 'Filter by session status')
  .option('--repo <repo>', 'Filter by repository name')
  .action(async (opts: { status?: string; repo?: string }) => {
    const { handleList } = await import('./commands/list.js');
    await handleList(opts);
  });

program
  .command('enter')
  .description('Re-enter an existing session')
  .argument('<session_id>', 'Session ID to enter')
  .action(async (sessionId: string) => {
    try {
      const { getSession } = await import('./session/manager.js');
      const session = getSession(sessionId);
      if (!session) {
        console.error(`Session not found: ${sessionId}`);
        process.exit(1);
      }
      const { runRepl } = await import('./repl/repl.js');
      const globalOpts = program.opts();
      await runRepl({
        initialSession: {
          id: session.id,
          repo: session.repo,
          goal: session.goal,
          repoLocalPath: session.repoLocalPath ?? '.',
        },
        images: globalOpts.image,
      });
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command('show')
  .description('Show detailed status of a session')
  .argument('<session_id>', 'Session ID to inspect')
  .action(async (sessionId: string) => {
    try {
      const { handleShow } = await import('./commands/show.js');
      await handleShow(sessionId);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command('stop')
  .description('Stop the current session')
  .argument('<session_id>', 'Session ID to stop')
  .action(async (sessionId: string) => {
    try {
      const { handleStop } = await import('./commands/stop.js');
      await handleStop(sessionId);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command('delete')
  .description('Delete a session and its data (use --all to delete all)')
  .argument('<session_id>', 'Session ID to delete, or "--all" for all sessions')
  .action(async (sessionId: string) => {
    try {
      const { handleDelete } = await import('./commands/delete.js');
      await handleDelete(sessionId);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command('init')
  .description('Auto-discover installed CLIs and generate config')
  .option('--force', 'Overwrite existing config')
  .action(async (opts: { force?: boolean }) => {
    const { runInit, formatInitOutput } = await import('./commands/init.js');
    const result = runInit(undefined, { force: opts.force });
    console.log(formatInitOutput(result));
  });

// Apply overrides for REPL mode too (no subcommand)
function applyOverrides(): void {
  // Parse known options from argv without triggering command handlers
  const opts = program.opts();
  setConfigOverrides({
    planner: opts.planner,
    coder: opts.coder,
    reviewer: opts.reviewer,
    parallel: opts.parallel,
  });
}

// Detect if no subcommand was provided → launch interactive REPL
const args = process.argv.slice(2);
const knownCommands = new Set(program.commands.map((c) => c.name()));
const hasSubcommand = args.some((a) => !a.startsWith('-') && knownCommands.has(a));
const hasVersionOrHelp =
  args.includes('--version') ||
  args.includes('-V') ||
  args.includes('--help') ||
  args.includes('-h');

if (hasVersionOrHelp || hasSubcommand) {
  // Let Commander handle subcommands, --version, and --help
  program.parse();
} else {
  // No subcommand — launch interactive REPL
  program.parseOptions(args);
  applyOverrides();
  import('./repl/repl.js').then(({ runRepl }) => runRepl());
}
