#!/usr/bin/env node

import { Command } from "commander";

const program = new Command();

program
  .name("sweteam")
  .description(
    "Autonomous coding agent orchestrator — turns high-level goals into PR'd code",
  )
  .version("0.1.0");

program
  .command("create")
  .description("Create a new session, clone repo, enter planning chat")
  .argument("<repo>", "Repository name or URL")
  .argument("<goal...>", "The coding goal for this session")
  .action(async (repo: string, goalParts: string[]) => {
    const { handleCreate } = await import("./commands/create.js");
    await handleCreate(repo, goalParts.join(" "));
  });

program
  .command("list")
  .description("List all sessions with status")
  .action(async () => {
    const { handleList } = await import("./commands/list.js");
    await handleList();
  });

program
  .command("enter")
  .description("Re-enter an existing session")
  .argument("<session_id>", "Session ID to enter")
  .action(async (sessionId: string) => {
    const { handleEnter } = await import("./commands/enter.js");
    await handleEnter(sessionId);
  });

program
  .command("stop")
  .description("Stop the current session")
  .argument("<session_id>", "Session ID to stop")
  .action(async (sessionId: string) => {
    const { handleStop } = await import("./commands/stop.js");
    await handleStop(sessionId);
  });

program
  .command("delete")
  .description("Delete a session and its data")
  .argument("<session_id>", "Session ID to delete")
  .action(async (sessionId: string) => {
    const { handleDelete } = await import("./commands/delete.js");
    await handleDelete(sessionId);
  });

program
  .command("init")
  .description("Auto-discover installed CLIs and generate config")
  .option("--force", "Overwrite existing config")
  .action(async (opts: { force?: boolean }) => {
    const { runInit, formatInitOutput } = await import("./commands/init.js");
    const result = runInit(undefined, { force: opts.force });
    console.log(formatInitOutput(result));
  });

program.parse();
