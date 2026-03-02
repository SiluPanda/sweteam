# sweteam — Implementation Tasks

All tasks are in logical execution order. Each task should be small and self-contained.

---

## Phase 1 — Project Scaffolding & Foundation

### Task 1: Initialize Node.js project
- Create `package.json` with project metadata (name: sweteam, type: module, bin entry)
- Set up `.gitignore`
- **Status:** DONE

### Task 2: Set up TypeScript configuration
- Create `tsconfig.json` with strict mode, ES2022 target, Node module resolution
- Add `tsx` as dev dependency for development execution
- **Status:** DONE

### Task 3: Install core dependencies
- Install production deps: `drizzle-orm`, `better-sqlite3`, `nanoid`, `@iarna/toml`, `commander`, `ink`, `react`
- Install dev deps: `typescript`, `@types/better-sqlite3`, `@types/node`, `drizzle-kit`, `tsx`
- **Status:** OPEN

### Task 4: Create project directory structure
- Create all directories: `src/commands`, `src/session`, `src/planner`, `src/orchestrator`, `src/adapters`, `src/git`, `src/db`, `src/tui`, `src/config`
- Create placeholder `index.ts` files where needed
- **Status:** OPEN

---

## Phase 1 — Database Layer

### Task 5: Create Drizzle schema file
- Implement `src/db/schema.ts` with all four tables: `sessions`, `messages`, `tasks`, `iterations`
- Match schema exactly from spec section 4.1
- **Status:** OPEN

### Task 6: Create database client module
- Implement `src/db/client.ts` — SQLite connection via `better-sqlite3`
- Initialize Drizzle ORM instance
- Ensure `~/.sweteam/` directory is created if missing
- Database path: `~/.sweteam/sweteam.db`
- **Status:** OPEN

### Task 7: Set up Drizzle Kit config
- Create `drizzle.config.ts` for migration generation
- **Status:** OPEN

### Task 8: Create re-export schema for drizzle-kit
- Create `db/schema.ts` that re-exports from `src/db/schema.ts`
- **Status:** OPEN

### Task 9: Generate initial migration
- Run `drizzle-kit generate` to produce the initial migration SQL
- Implement auto-migration on app startup in `client.ts`
- **Status:** OPEN

---

## Phase 1 — Configuration System

### Task 10: Implement TOML config loader
- Create `src/config/loader.ts`
- Load config from `~/.sweteam/config.toml`
- Define TypeScript types for config shape (roles, execution, git, agents sections)
- Return defaults if config file doesn't exist
- **Status:** OPEN

### Task 11: Implement CLI auto-discovery
- Create `src/config/discovery.ts`
- Check for `claude`, `codex`, `opencode`, `gh`, `git` binaries via `which`
- Return availability + version info for each
- **Status:** OPEN

### Task 12: Implement `init` command
- Create `src/commands/init.ts`
- Run auto-discovery, print results with checkmarks/crosses
- Generate `~/.sweteam/config.toml` with discovered agents
- **Status:** OPEN

---

## Phase 1 — Git Wrapper

### Task 13: Implement core git CLI wrapper functions
- Create `src/git/git.ts`
- Implement `git()` and `gh()` helper functions using `execSync`
- **Status:** OPEN

### Task 14: Implement repo resolution function
- Add `resolveRepo()` to `src/git/git.ts`
- Handle three input forms: short name, `owner/repo`, full GitHub URL
- Use `gh api user -q .login` for short name resolution
- **Status:** OPEN

### Task 15: Implement branch operation functions
- Add `createBranch()`, `squashMerge()` to `src/git/git.ts`
- **Status:** OPEN

### Task 16: Implement diff and commit functions
- Add `getDiff()`, `getStagedDiff()`, `commitAll()` to `src/git/git.ts`
- **Status:** OPEN

### Task 17: Implement PR and push functions
- Add `createPR()`, `pushBranch()` to `src/git/git.ts`
- **Status:** OPEN

### Task 18: Implement repo clone/locate function
- Add `cloneOrLocateRepo()` to `src/git/git.ts`
- Check if `~/.sweteam/repos/{owner}--{name}` exists
- If yes: `git fetch origin`, checkout main, pull
- If no: `gh repo clone` to that path
- **Status:** OPEN

---

## Phase 1 — Agent Adapter Layer

### Task 19: Define AgentAdapter interface
- Create `src/adapters/adapter.ts`
- Define `AgentAdapter` interface and `AgentResult` type as per spec section 8
- **Status:** OPEN

### Task 20: Implement Claude Code adapter
- Create `src/adapters/claude-code.ts`
- Implement `isAvailable()` using `which claude`
- Implement `execute()` using `spawn("claude", ["-p", "--output-format", "json"])`
- Handle stdin prompt piping, stdout collection, timeout, exit code
- **Status:** OPEN

### Task 21: Implement Codex adapter
- Create `src/adapters/codex.ts`
- Same pattern as Claude Code but using `codex` with `-q` flag
- **Status:** OPEN

### Task 22: Implement OpenCode adapter
- Create `src/adapters/opencode.ts`
- Same pattern but using `opencode` with `--non-interactive` flag
- **Status:** OPEN

### Task 23: Implement custom adapter (config-driven)
- Create `src/adapters/custom.ts`
- Read command, args, prompt_via, output_from from config
- Support stdin/arg/file prompt delivery and stdout/file output capture
- **Status:** OPEN

### Task 24: Create adapter registry/factory
- Add function to resolve adapter by name from config
- Returns the correct adapter instance based on config `[agents.*]` section
- **Status:** OPEN

---

## Phase 1 — Session State Machine

### Task 25: Implement session state machine
- Create `src/session/state-machine.ts`
- Define valid states: `planning`, `building`, `awaiting_feedback`, `iterating`, `stopped`
- Define valid transitions as per spec section 10
- Implement `validateTransition(from, to)` function
- Implement `transition(sessionId, newStatus)` that validates + updates DB
- **Status:** OPEN

---

## Phase 1 — Session Manager

### Task 26: Implement session creation logic
- Create `src/session/manager.ts`
- `createSession(repo, goal)`: resolve repo, clone/locate, generate nanoid, create working branch, insert into DB, insert system message
- **Status:** OPEN

### Task 27: Implement session retrieval and listing
- Add `getSession(id)`, `listSessions()` to session manager
- `listSessions()` returns all sessions with id, repo, goal, status
- **Status:** OPEN

### Task 28: Implement session stop and delete
- Add `stopSession(id)` — set status to `stopped`, set `stoppedAt`
- Add `deleteSession(id)` — delete session and all related data (cascade)
- **Status:** OPEN

### Task 29: Implement message persistence helpers
- Add `addMessage(sessionId, role, content, metadata)` to session manager
- Add `getMessages(sessionId, limit?)` to retrieve chat history
- **Status:** OPEN

---

## Phase 1 — CLI Entry Point & Command Routing

### Task 30: Set up CLI entry point with Commander.js
- Create `src/index.ts`
- Set up Commander program with name, description, version
- Add shebang line for bin execution
- **Status:** OPEN

### Task 31: Implement `/create` command handler
- Create `src/commands/create.ts`
- Parse `<repo>` and `<goal>` arguments
- Call session manager to create session
- Transition into planning chat
- **Status:** OPEN

### Task 32: Implement `/list` command handler
- Create `src/commands/list.ts`
- Fetch all sessions from DB
- Render formatted table output (as per spec section 5.4)
- **Status:** OPEN

### Task 33: Implement `/enter` command handler
- Create `src/commands/enter.ts`
- Load session from DB
- Display session summary (repo, goal, status, PR, tasks, last activity)
- Display last 10 messages
- Enter interactive session loop
- **Status:** OPEN

### Task 34: Implement `/stop` command handler
- Wire `/stop` to session manager's `stopSession()`
- **Status:** OPEN

### Task 35: Implement `/delete` command handler
- Create `src/commands/delete.ts`
- Confirm with user before deleting
- Call session manager's `deleteSession()`
- **Status:** OPEN

---

## Phase 1 — Planning Chat Loop

### Task 36: Implement interactive chat loop
- Create `src/session/chat.ts`
- Read user input in a loop (stdin readline or Ink-based input)
- Detect `@build` command to exit planning and trigger build
- Detect `@stop`, `@help`, `@plan` commands
- For regular messages: send to planner agent, display response, persist both
- **Status:** OPEN

### Task 37: Implement planner agent orchestration
- Create `src/planner/planner.ts`
- Build planner system prompt from template (spec section 11) with repo context
- Gather repo context: file tree, package manifest, recent commits
- Send prompt + chat history to configured planner CLI via adapter
- Return agent response
- **Status:** OPEN

### Task 38: Implement repo context gathering
- Add helpers to gather filtered file tree (exclude node_modules, .git, etc.)
- Read package manifest (package.json / Cargo.toml / etc.)
- Get last 20 commits via `git log --oneline -20`
- **Status:** OPEN

### Task 39: Implement plan parser
- Create `src/planner/plan-parser.ts`
- Parse agent's task breakdown output into structured `Task[]` objects
- Extract: id, title, description, files_likely_touched, depends_on, acceptance_criteria
- Handle both JSON and markdown formatted responses
- **Status:** OPEN

---

## Phase 1 — Task Execution (Sequential)

### Task 40: Implement single task runner
- Create `src/orchestrator/task-runner.ts`
- For a given task: create task branch from session branch, build coder prompt, invoke coder adapter, capture output, capture diff, commit, update DB
- **Status:** OPEN

### Task 41: Build coder task prompt
- Implement prompt template from spec section 11 (Coder Task Prompt)
- Include task title, description, acceptance criteria, files, context diffs from dependency tasks
- **Status:** OPEN

### Task 42: Implement review step for a task
- Build reviewer prompt from spec section 11 (Reviewer Prompt)
- Send diff to reviewer adapter
- Parse JSON response (verdict + issues)
- On `approve` → proceed to merge
- On `request_changes` → re-invoke coder with issues, loop up to `max_review_cycles`
- **Status:** OPEN

### Task 43: Implement task merge step
- After review approval: squash-merge task branch into session branch
- Delete task branch
- Update task status to `done` in DB
- **Status:** OPEN

### Task 44: Implement sequential orchestrator
- Create `src/orchestrator/orchestrator.ts`
- Take finalized plan, insert tasks into DB
- Execute tasks sequentially in dependency order
- Handle failed tasks: mark as `failed`, mark dependents as `blocked`
- **Status:** OPEN

---

## Phase 1 — @build Command & PR Creation

### Task 45: Implement @build handler
- On `@build`: save plan JSON to session, transition status to `building`
- Parse plan into tasks, insert into DB
- Kick off orchestrator
- **Status:** OPEN

### Task 46: Implement PR creation after build
- After all tasks complete (or all possible tasks done): push session branch
- Create PR via `gh pr create` with title from goal and generated body
- Store PR URL and number in session
- Transition to `awaiting_feedback`
- **Status:** OPEN

### Task 47: Generate PR body
- Build markdown PR body from completed tasks, their diffs, and any escalation notes
- Include task list with status checkmarks
- **Status:** OPEN

### Task 48: Implement build completion report
- Print summary to chat: tasks done/failed/escalated, PR link
- Store as system message in session
- **Status:** OPEN

---

## Phase 2 — Feedback & Iteration

### Task 49: Implement @feedback handler
- Create `src/orchestrator/feedback-handler.ts`
- Store feedback as user message + new iteration record
- Transition session to `iterating`
- **Status:** OPEN

### Task 50: Implement feedback iteration prompt
- Build iteration prompt from spec section 11 (Feedback Iteration Prompt)
- Include original plan, current task states/diffs, feedback text, iteration history
- Send to planner adapter, get plan delta
- **Status:** OPEN

### Task 51: Implement plan delta processing
- Parse plan delta JSON (modified_tasks, new_tasks)
- Update modified tasks in DB
- Insert new tasks in DB
- **Status:** OPEN

### Task 52: Implement incremental build from plan delta
- Re-run orchestrator on modified + new tasks only
- Push updates to existing PR branch
- Transition back to `awaiting_feedback`
- **Status:** OPEN

### Task 53: Implement iteration record tracking
- Insert iteration into `iterations` table with iteration number, feedback, plan delta, status
- Update iteration status as it progresses
- **Status:** OPEN

---

## Phase 2 — Additional Adapters

### Task 54: Test and validate Codex adapter end-to-end
- Verify Codex adapter works with real `codex` CLI
- Handle any output format differences
- **Status:** OPEN

### Task 55: Test and validate OpenCode adapter end-to-end
- Verify OpenCode adapter works with real `opencode` CLI
- Handle any output format differences
- **Status:** OPEN

### Task 56: Test custom adapter with a sample config
- Verify custom adapter correctly reads config and spawns arbitrary CLI
- Test stdin/arg/file prompt delivery modes
- **Status:** OPEN

---

## Phase 2 — Error Handling & Resilience

### Task 57: Implement agent timeout handling
- Add configurable timeout to adapter execute calls
- On timeout: retry once, then mark task `failed`
- **Status:** OPEN

### Task 58: Implement agent error handling (non-zero exit)
- Capture stderr on non-zero exit
- Retry once with error context appended to prompt
- On second failure: mark task `failed`, store error in agent_output
- **Status:** OPEN

### Task 59: Implement dependency failure propagation
- When a task fails, mark all downstream dependent tasks as `blocked`
- Continue executing non-blocked tasks
- **Status:** OPEN

### Task 60: Implement merge conflict handling
- Detect merge conflicts during squash-merge
- Attempt auto-resolve by sending conflict to coder agent
- On failure: escalate task, continue others
- **Status:** OPEN

### Task 61: Persist all errors as system messages
- Every error/escalation gets stored as a `system` role message in the session
- User sees full error history when they `/enter`
- **Status:** OPEN

---

## Phase 3 — Parallel Execution

### Task 62: Build task dependency DAG
- Parse `depends_on` fields into a directed acyclic graph
- Implement topological sort
- Identify tasks with no unmet dependencies (ready to run)
- **Status:** OPEN

### Task 63: Implement parallel task dispatcher
- Run up to `max_parallel` tasks concurrently
- When a task completes, check if new tasks are unblocked
- Dispatch newly unblocked tasks
- **Status:** OPEN

### Task 64: Handle concurrent git branch operations
- Ensure parallel tasks use separate task branches safely
- Handle concurrent merges into session branch (serialize merge step)
- **Status:** OPEN

---

## Phase 3 — In-Session Commands

### Task 65: Implement @status command
- Show current task progress: task list with statuses, progress bar
- **Status:** OPEN

### Task 66: Implement @plan command
- Re-display the current plan from `planJson` in session
- **Status:** OPEN

### Task 67: Implement @diff command
- Show cumulative diff: `git diff main...{session_branch}`
- **Status:** OPEN

### Task 68: Implement @pr command
- Display PR URL from session, or "No PR created yet"
- **Status:** OPEN

### Task 69: Implement @tasks command
- List all tasks with their statuses, review verdicts, and cycle counts
- **Status:** OPEN

### Task 70: Implement @help command
- Print all available in-session commands with descriptions
- **Status:** OPEN

---

## Phase 3 — TUI Dashboard

### Task 71: Implement Ink-based chat UI component
- Create `src/tui/chat-ui.ts`
- Scrollable message list with role-based coloring (user/agent/system)
- Input field at bottom
- **Status:** OPEN

### Task 72: Implement Ink-based task dashboard component
- Create `src/tui/dashboard.ts`
- Real-time task status display with progress indicators
- Show running/queued/done/failed counts
- **Status:** OPEN

### Task 73: Implement Ink-based session list component
- Create `src/tui/session-list.ts`
- Formatted table of sessions (matches spec section 5.4 layout)
- **Status:** OPEN

---

## Phase 3 — Polish

### Task 74: Add CLI flag overrides
- Support `--coder`, `--reviewer`, `--parallel`, `--config` flags on sweteam command
- Merge CLI flags over config file values
- **Status:** OPEN

### Task 75: Implement session resume from stopped state
- On `/enter` a stopped session: allow `@build` or `@feedback` to resume
- Correctly transition from `stopped` back to `building` or `iterating`
- **Status:** OPEN

### Task 76: Add npm bin entry and build script
- Configure `package.json` `bin` field pointing to compiled entry point
- Add `build` script (tsc)
- Add `start` / `dev` scripts
- Test `npx sweteam` and global install
- **Status:** OPEN

### Task 77: Validate gh authentication on startup
- Check `gh auth status` before any operation that needs it
- Display clear error message if not authenticated
- **Status:** OPEN

### Task 78: Implement session search/filter
- Add `--status` and `--repo` filters to `/list` command
- **Status:** OPEN

---

## Phase 4 — Advanced Features

### Task 79: Implement test runner integration
- After code generation, run project test suite as part of review
- Parse test results, feed failures back to coder
- **Status:** OPEN

### Task 80: Implement cost tracking per session
- Track number of agent invocations and token counts (if available from CLI output)
- Store per-session, display in session summary
- **Status:** OPEN

### Task 81: Export session as markdown report
- Generate a markdown document summarizing: goal, plan, tasks, diffs, PR link, iterations
- Save to file or print to stdout
- **Status:** OPEN
