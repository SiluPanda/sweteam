# sweteam — Autonomous Coding Agent Orchestrator

## Spec v0.2 · March 2026

---

## 1. What This Is

sweteam is a terminal-based orchestrator that turns a high-level coding goal into committed, PR'd code — and keeps iterating on your feedback until you're satisfied. It sits **on top of** existing coding CLIs (Claude Code, Codex CLI, OpenCode) and wires them into a persistent, session-based workflow:

```
/create repo goal
    │
    ▼
 Planning Chat  ←──── user + planner agent go back and forth
    │
    │  user signals: @build
    ▼
 Decompose → Code (parallel) → Review → Fix → PR
    │
    ▼
 Session stays open — user can give feedback
    │
    ▼
 Agents pick up feedback → iterate → update PR
    │
    ▼
 User satisfied → /stop or session lives on
```

**It is not another coding agent.** It orchestrates the ones that already exist on your machine, using their default configs and auth. Zero extra setup.

---

## 2. Core Principles

| Principle                          | What it means                                                                |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| **Session-first**                  | Every interaction lives inside a persistent session with full history        |
| **Zero config by default**         | Discovers installed CLIs, uses their existing auth/config                    |
| **Human-in-the-loop for planning** | Interactive chat to finalize the plan, then hands-off for building           |
| **Continuous feedback**            | Session doesn't end at PR — user can keep giving feedback and agents iterate |
| **Parallel execution**             | Independent tasks run concurrently across multiple agent instances           |
| **Git CLI native**                 | All git operations via `git` and `gh` CLI directly — no abstractions         |
| **Fail-safe**                      | Stuck task → isolate, continue others, escalate to user in session           |

---

## 3. Architecture

### 3.1 System Components

```
┌──────────────────────────────────────────────────────────┐
│                      sweteam CLI                        │
│                     (TypeScript/Node)                     │
├──────────┬──────────────┬──────────────┬─────────────────┤
│ Session  │   Planner    │ Orchestrator │    Reporter      │
│ Manager  │  (chat mode) │ (autonomous) │  (TUI dashboard) │
├──────────┴──────────────┴──────────────┴─────────────────┤
│                   Agent Adapter Layer                      │
│      ┌──────────┐  ┌──────────┐  ┌──────────────┐        │
│      │ Claude   │  │ Codex    │  │ OpenCode     │        │
│      │ Code     │  │ CLI      │  │ CLI          │        │
│      └──────────┘  └──────────┘  └──────────────┘        │
├──────────────────────────────────────────────────────────┤
│              SQLite (Drizzle ORM) — Session Store          │
├──────────────────────────────────────────────────────────┤
│           Git CLI + GitHub CLI (gh) — native calls         │
└──────────────────────────────────────────────────────────┘
```

### 3.2 Component Responsibilities

**Session Manager** — The top-level controller. Manages session lifecycle: create, enter, list, stop, delete. Persists everything to SQLite. Each session is a self-contained world with its own plan, tasks, chat history, diffs, PR link, and status.

**Planner** — Runs inside a session in chat mode. The user and the planner agent have a conversation to refine the plan. The user signals `@build` when the plan is final.

**Orchestrator** — Takes the finalized plan and runs it autonomously. Creates branches, dispatches tasks to coding agents, runs review loops, creates/updates PRs. Also handles feedback iterations after the initial build.

**Agent Adapter Layer** — Thin wrappers that normalize how sweteam invokes each CLI. Each adapter knows how to: invoke the CLI with a prompt, capture output, detect completion vs error, and let the CLI modify files in the working directory.

**Reporter** — Streams real-time agent output during builds via the agent log and panel system. Users can attach/detach from live output using `@watch`.

---

## 4. Data Model (SQLite + Drizzle)

### 4.1 Schema

```typescript
// db/schema.ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// ─── Sessions ───────────────────────────────────────────
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(), // nanoid, e.g. "s_a1b2c3d4"
  repo: text('repo').notNull(), // fully qualified: "SiluPanda/weav"
  repoLocalPath: text('repo_local_path'), // local clone path
  goal: text('goal').notNull(), // original user goal
  status: text('status').notNull(), // planning | building | awaiting_feedback | iterating | stopped
  planJson: text('plan_json'), // the finalized plan (JSON string)
  prUrl: text('pr_url'), // github PR link once created
  prNumber: integer('pr_number'), // PR number
  workingBranch: text('working_branch'), // e.g. "sw/s_a1b2c3d4-dark-theme"
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  stoppedAt: integer('stopped_at', { mode: 'timestamp' }),
});

// ─── Chat Messages ──────────────────────────────────────
// Full conversation history: user messages, agent responses,
// system events, and feedback — all in one ordered stream.
export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(), // nanoid
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // user | agent | system
  content: text('content').notNull(), // message text
  metadata: text('metadata'), // JSON: { agent: "claude-code", phase: "planning" } etc.
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// ─── Tasks ──────────────────────────────────────────────
// Individual coding tasks decomposed from the plan.
export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(), // e.g. "task-001"
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description').notNull(),
  status: text('status').notNull(), // queued | running | reviewing | fixing | done | failed | blocked
  dependsOn: text('depends_on'), // JSON array of task IDs
  filesLikelyTouched: text('files_likely_touched'), // JSON array
  acceptanceCriteria: text('acceptance_criteria'), // JSON array
  branchName: text('branch_name'), // e.g. "sw/task-001-oauth-config"
  reviewVerdict: text('review_verdict'), // approve | request_changes
  reviewIssues: text('review_issues'), // JSON array of review issues
  reviewCycles: integer('review_cycles').default(0),
  diffPatch: text('diff_patch'), // stored diff after completion
  agentOutput: text('agent_output'), // full agent response
  order: integer('order').notNull(), // execution order
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// ─── Feedback Iterations ────────────────────────────────
// When user gives feedback after a build, each round is tracked.
export const iterations = sqliteTable('iterations', {
  id: text('id').primaryKey(), // nanoid
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  iterationNumber: integer('iteration_number').notNull(),
  feedback: text('feedback').notNull(), // user's feedback text
  planDelta: text('plan_delta'), // what changed in the plan (JSON)
  status: text('status').notNull(), // planning | building | done | failed
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});
```

### 4.2 Database Location

```
~/.sweteam/
├── sweteam.db              # SQLite database
├── config.toml               # global config
└── repos/                    # cloned repos (or symlinks to existing clones)
    └── SiluPanda--weav/      # repo working copies
```

---

## 5. Session Lifecycle & Commands

### 5.1 Commands

```
/create <repo> <goal>     Create a new session, clone repo, enter planning chat
/enter <session_id>       Re-enter an existing session
/list                     List all sessions with status
/stop                     Stop the current session (pauses, can resume later)
/delete <session_id>      Delete a session and its data
```

### 5.2 In-Session Commands (available once inside a session)

```
@build                    Signal that the plan is final — start autonomous coding
@status                   Show current task progress dashboard
@plan                     Re-display the current plan
@feedback <text>          Give feedback on completed work (triggers new iteration)
@watch                    Re-attach to live agent output
@diff                     Show the current cumulative diff
@pr                       Show the PR link
@tasks                    List all tasks and their statuses
@ask                      Ask the architect about the development process
@cancel                   Cancel the current planner run (session stays active)
@image <path>             Attach image file(s) to pass to the underlying CLI agent
@images                   List attached images (@images clear to remove all)
@stop                     Stop this session
@help                     Show available commands
```

### 5.3 `/create` Flow

```bash
$ sweteam
> /create weav Add dark theme support with system preference detection
```

**Step 1 — Repo Resolution**

```
Input: "weav"
  → Run: gh api user → get logged-in username (e.g. "SiluPanda")
  → Resolve to: "SiluPanda/weav"

Input: "SiluPanda/weav"
  → Already fully qualified, use as-is

Input: "https://github.com/SiluPanda/weav"
  → Parse to: "SiluPanda/weav"
```

**Step 2 — Clone / Locate**

```bash
# Check if repo already cloned locally
if [ -d ~/.sweteam/repos/SiluPanda--weav ]; then
    cd ~/.sweteam/repos/SiluPanda--weav
    git fetch origin
    git checkout main && git pull
else
    gh repo clone SiluPanda/weav ~/.sweteam/repos/SiluPanda--weav
    cd ~/.sweteam/repos/SiluPanda--weav
fi
```

**Step 3 — Session Creation**

```
→ Generate session ID: "s_x7k9m2p4"
→ Create working branch: "sw/s_x7k9m2p4-dark-theme"
→ Insert into sessions table
→ Insert system message: "Session created for SiluPanda/weav"
→ Auto-enter the session
```

**Step 4 — Planning Chat Begins**

sweteam immediately enters the session and sends the goal to the planner agent. The user is now in a chat loop.

### 5.4 `/list` Output

```
╔══════════════════════════════════════════════════════════════════════╗
║  sweteam Sessions                                                  ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                      ║
║  ID          Repo                Goal                    Status      ║
║  ─────────── ─────────────────── ────────────────────── ──────────── ║
║  s_x7k9m2p4  SiluPanda/weav      Add dark theme         building     ║
║  s_p3q8r1w5  SiluPanda/ferrox    Fix memory leak in...  awaiting_feedback ║
║  s_m2n5v8k1  acme/api            Add rate limiting      stopped      ║
║  s_j4h7f2d9  SiluPanda/weav      Refactor query eng...  done (PR #42)║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
```

### 5.5 `/enter` Flow

```bash
> /enter s_p3q8r1w5
```

```
→ Load session from DB
→ Display session summary:
    Repo: SiluPanda/ferrox
    Goal: Fix memory leak in graph traversal
    Status: awaiting_feedback
    PR: https://github.com/SiluPanda/ferrox/pull/17
    Tasks: 3/3 done
    Last activity: 2h ago
→ Display last 10 messages from chat history
→ User is now in session, can chat or give @feedback
```

---

## 6. Workflow — The Full Loop

### Phase 1: Planning Chat (Interactive)

Once inside a session after `/create`, the user and planner agent chat:

```
╭─ Session s_x7k9m2p4 · SiluPanda/weav · planning ─────────────────╮
│                                                                     │
│  [system] Session created. Analyzing repository...                  │
│                                                                     │
│  [agent]  I've looked at the weav codebase. It's a Rust project    │
│           with a CLI interface. Currently there's no theming system. │
│           Here's my initial plan for adding dark theme:              │
│                                                                     │
│           1. Add a ThemeConfig struct with color definitions         │
│           2. Create dark and light theme presets                     │
│           3. Detect system preference via the `dark-light` crate    │
│           4. Wire theme into all TUI render paths                   │
│           5. Add --theme CLI flag and config file support            │
│                                                                     │
│           Does this scope look right? Any specific UI elements      │
│           you want to prioritize?                                   │
│                                                                     │
│  [you]    Yeah but also add a toggle keybinding, like 't' to       │
│           switch between dark/light while running                    │
│                                                                     │
│  [agent]  Good call. Updated plan:                                  │
│           ...                                                       │
│           6. Add runtime theme toggle (keybinding: 't')             │
│                                                                     │
│           Shall I break this into detailed tasks with file targets   │
│           and acceptance criteria?                                   │
│                                                                     │
│  [you]    Yes                                                        │
│                                                                     │
│  [agent]  Here's the task breakdown:                                │
│           ┌─────────────────────────────────────────────────────┐   │
│           │ task-001: Add ThemeConfig and color definitions      │   │
│           │   Files: src/theme/mod.rs, src/theme/colors.rs      │   │
│           │   Deps: none                                        │   │
│           │                                                     │   │
│           │ task-002: Implement system preference detection      │   │
│           │   Files: src/theme/detect.rs, Cargo.toml            │   │
│           │   Deps: task-001                                    │   │
│           │ ...                                                 │   │
│           └─────────────────────────────────────────────────────┘   │
│           Ready to build? Type @build to start.                     │
│                                                                     │
│  [you]    @build                                                    │
│                                                                     │
│  [system] Plan finalized. Starting autonomous build...              │
│                                                                     │
╰─────────────────────────────────────────────────────────────────────╯
```

**Planner Agent Prompt** (sent to configured planner CLI):

```
You are a senior software architect helping plan a coding task.
You are in a conversation with the user. Be concise and direct.

## Repository Context
- Repo: {repo}
- File tree: {filtered_file_tree}
- Package manifest: {manifest_contents}
- Recent commits: {last_20_commits}

## User's Goal
{goal}

## Conversation So Far
{chat_history}

Respond conversationally. When the user seems happy with the direction:
1. Propose a structured task breakdown
2. Each task needs: title, description, files_likely_touched, depends_on, acceptance_criteria
3. Tell the user to type @build when ready

Do NOT generate code. Only plan.
```

### Phase 2: Autonomous Build

Once the user types `@build`:

**Step 1 — Save Plan**

```sql
UPDATE sessions SET plan_json = '{...}', status = 'building' WHERE id = 's_x7k9m2p4';
INSERT INTO tasks (id, session_id, title, ...) VALUES (...);
```

**Step 2 — Dependency Resolution & Scheduling**

Build a DAG from task `depends_on`. Tasks with no unmet deps run immediately, up to `max_parallel`.

```
task-001 ──→ task-002 ──→ task-005
         └─→ task-003 ──→ task-006
         └─→ task-004 ──┘
```

**Step 3 — Task Execution (per task)**

For each task, using raw git CLI:

```bash
# 1. Branch
cd ~/.sweteam/repos/SiluPanda--weav
git checkout -b sw/task-001-theme-config sw/s_x7k9m2p4-dark-theme

# 2. Run coder agent (configured CLI, e.g. claude code)
echo "{task_prompt}" | claude -p

# 3. Capture diff
git diff > /tmp/task-001.patch
git add -A
git commit -m "feat(task-001): add ThemeConfig and color definitions"

# 4. Update DB
# → store diff, agent output, set status = "reviewing"
```

**Step 4 — Review**

Send diff to the reviewer agent (possibly a different CLI):

```bash
echo "{review_prompt}" | codex -q
```

Review response is parsed. On `approve` → merge. On `request_changes` → feed issues back to coder, loop up to `max_review_cycles`.

**Step 5 — Merge**

```bash
git checkout sw/s_x7k9m2p4-dark-theme
git merge --squash sw/task-001-theme-config
git commit -m "feat: add ThemeConfig and color definitions (#task-001)"
git branch -D sw/task-001-theme-config
```

**Step 6 — Create/Update PR**

After all tasks complete (or on first mergeable result):

```bash
git push origin sw/s_x7k9m2p4-dark-theme

# First time: create PR
gh pr create \
  --title "Add dark theme support with system preference detection" \
  --body "$(cat pr_body.md)" \
  --base main \
  --head sw/s_x7k9m2p4-dark-theme

# Subsequent: just push, PR auto-updates
git push origin sw/s_x7k9m2p4-dark-theme
```

Store PR URL and number in the session:

```sql
UPDATE sessions SET pr_url = '...', pr_number = 42, status = 'awaiting_feedback' WHERE id = '...';
```

**Step 7 — Report & Wait**

```
[system] Build complete. 5/6 tasks done, 1 escalated.

         ✓ task-001  Add ThemeConfig and color definitions
         ✓ task-002  Implement system preference detection
         ✓ task-003  Create dark theme preset
         ✓ task-004  Create light theme preset
         ✓ task-005  Wire theme into TUI render paths
         ⚠ task-006  Add runtime theme toggle — ESCALATED

         PR: https://github.com/SiluPanda/weav/pull/42

         Review the PR and type @feedback with any changes needed.
         The session stays open until you /stop it.
```

### Phase 3: Feedback Loop (Back to Interactive)

Session status is now `awaiting_feedback`. The user can come back anytime:

```bash
> /enter s_x7k9m2p4

# or if already in the session:
> @feedback The dark theme colors are too muted. Make the accent color
  brighter (#00BFFF). Also task-006 failed — the toggle should use
  Ctrl+T not just 't' to avoid conflicts with text input.
```

**What happens on `@feedback`:**

1. Feedback is stored as a message + new iteration record
2. Session status → `iterating`
3. Feedback + existing plan + current codebase state are sent to the planner agent
4. Planner produces a **plan delta** — which tasks need to change, any new tasks
5. The delta is shown to the user in chat (no `@build` needed for iterations — feedback implies intent to build)
6. Orchestrator picks up changed/new tasks and runs them
7. Pushes updates to the existing PR branch
8. Session returns to `awaiting_feedback`

```typescript
// Iteration record
{
  iterationNumber: 2,
  feedback: "Dark theme colors too muted. Make accent #00BFFF...",
  planDelta: {
    modified: ["task-003"],      // update dark theme preset
    added: ["task-007"],         // retry toggle with Ctrl+T
    unchanged: ["task-001", "task-002", "task-004", "task-005"]
  },
  status: "building"
}
```

This loop repeats until the user is satisfied. The PR accumulates all changes across iterations.

---

## 7. Configuration

### 7.1 Config File: `~/.sweteam/config.toml`

```toml
[roles]
planner = "claude-code"       # which CLI generates the plan
coder = "claude-code"         # which CLI writes code
reviewer = "codex"            # which CLI reviews code

[execution]
max_parallel = 3              # concurrent coding agents
max_review_cycles = 3         # review→fix loops before escalating
branch_prefix = "sw/"         # prefix for all branches

[git]
commit_style = "conventional" # conventional | simple
squash_on_merge = true

[agents.claude-code]
command = "claude"
args = ["-p"]                 # print mode, prompt via stdin

[agents.codex]
command = "codex"
args = ["-q"]                 # quiet mode

[agents.opencode]
command = "opencode"
args = ["--non-interactive"]
```

### 7.2 CLI Flags Override Config

```bash
sweteam --coder codex       # override coder for this session
sweteam --reviewer claude-code
sweteam --parallel 5
sweteam --config ./custom.toml
```

### 7.3 Auto-Discovery

```bash
$ sweteam init
✓ Found claude (Claude Code v1.x)
✓ Found codex (Codex CLI v0.x)
✗ opencode not found
✓ Found gh (GitHub CLI v2.x)
✓ Found git (v2.43)
Generated ~/.sweteam/config.toml
```

---

## 8. Agent Adapter Interface

```typescript
interface AgentAdapter {
  name: string;
  isAvailable(): Promise<boolean>;

  execute(opts: {
    prompt: string;
    cwd: string;
    timeout?: number;
    onOutput?: (chunk: string) => void;
  }): Promise<{
    output: string;
    exitCode: number;
    durationMs: number;
  }>;
}
```

**Implementation — all adapters call CLIs via `child_process.spawn`:**

```typescript
// Claude Code adapter
import { spawn } from 'child_process';

class ClaudeCodeAdapter implements AgentAdapter {
  name = 'claude-code';

  async isAvailable(): Promise<boolean> {
    // spawn: which claude
    // return exitCode === 0
  }

  async execute(opts): Promise<AgentResult> {
    const proc = spawn('claude', ['-p', '--output-format', 'json'], {
      cwd: opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    proc.stdin.write(opts.prompt);
    proc.stdin.end();
    // collect stdout, handle timeout, return result
  }
}
```

**Custom Adapter** via config:

```toml
[agents.my-agent]
command = "my-coding-tool"
args = ["--mode", "autonomous"]
prompt_via = "stdin"          # stdin | arg | file
output_from = "stdout"       # stdout | file
```

---

## 9. Git Operations (Raw CLI)

All git operations are raw shell commands via `child_process.execSync` or `spawn`. No libraries.

```typescript
// git.ts — thin wrapper, every function is a CLI call
import { execSync } from 'child_process';

function git(args: string, cwd: string): string {
  return execSync(`git ${args}`, { cwd, encoding: 'utf-8' }).trim();
}

function gh(args: string, cwd: string): string {
  return execSync(`gh ${args}`, { cwd, encoding: 'utf-8' }).trim();
}

// ─── Repo Resolution ───
function resolveRepo(input: string): string {
  // "weav" → get current user from `gh api user -q .login` → "SiluPanda/weav"
  // "SiluPanda/weav" → use as-is
  // "https://github.com/SiluPanda/weav" → parse to "SiluPanda/weav"
  if (input.startsWith('https://')) {
    const match = input.match(/github\.com\/([^/]+\/[^/]+)/);
    return match ? match[1].replace(/\.git$/, '') : input;
  }
  if (input.includes('/')) return input;
  const user = gh('api user -q .login', '.');
  return `${user}/${input}`;
}

// ─── Branch Operations ───
function createBranch(name: string, base: string, cwd: string) {
  git(`checkout -b ${name} ${base}`, cwd);
}

function squashMerge(source: string, target: string, msg: string, cwd: string) {
  git(`checkout ${target}`, cwd);
  git(`merge --squash ${source}`, cwd);
  git(`commit -m "${msg}"`, cwd);
  git(`branch -D ${source}`, cwd);
}

// ─── Diff ───
function getDiff(cwd: string): string {
  return git('diff', cwd);
}

function getStagedDiff(cwd: string): string {
  return git('diff --cached', cwd);
}

// ─── Commit ───
function commitAll(msg: string, cwd: string) {
  git('add -A', cwd);
  git(`commit -m "${msg}"`, cwd);
}

// ─── PR ───
function createPR(title: string, body: string, base: string, head: string, cwd: string): string {
  return gh(`pr create --title "${title}" --body "${body}" --base ${base} --head ${head}`, cwd);
}

function pushBranch(branch: string, cwd: string) {
  git(`push origin ${branch}`, cwd);
}
```

---

## 10. Session State Machine

```
                  /create
                     │
                     ▼
              ┌─────────────┐
              │   planning   │ ◄─── user + agent chat
              └──────┬──────┘
                     │ @build
                     ▼
              ┌─────────────┐
              │  building    │ ◄─── autonomous: code → review → merge
              └──────┬──────┘
                     │ all tasks done
                     ▼
              ┌──────────────────┐
              │ awaiting_feedback │ ◄─── PR is up, user can review
              └──────┬───────────┘
                     │ @feedback
                     ▼
              ┌─────────────┐
              │  iterating   │ ◄─── plan delta → code → review → push
              └──────┬──────┘
                     │ done
                     ▼
              ┌──────────────────┐
              │ awaiting_feedback │  (loops back)
              └──────┬───────────┘
                     │ /stop
                     ▼
              ┌─────────────┐
              │   stopped    │ ◄─── can /enter and resume later
              └─────────────┘
```

**Transitions:**

| From                | Trigger                            | To                                          |
| ------------------- | ---------------------------------- | ------------------------------------------- |
| (none)              | `/create`                          | `planning`                                  |
| `planning`          | `@build`                           | `building`                                  |
| `building`          | all tasks complete                 | `awaiting_feedback`                         |
| `building`          | critical failure                   | `awaiting_feedback` (with escalation notes) |
| `awaiting_feedback` | `@feedback`                        | `iterating`                                 |
| `iterating`         | iteration complete                 | `awaiting_feedback`                         |
| any                 | `/stop`                            | `stopped`                                   |
| `stopped`           | `/enter` + `@build` or `@feedback` | resumes to `building` or `iterating`        |

---

## 11. Prompt Templates

### Planner System Prompt

```
You are a senior software architect helping plan a coding task.
Be concise and direct. You're in a conversation with the user.

## Repository
- Name: {repo}
- File tree: {filtered_file_tree}
- Package manifest: {manifest_contents}
- Recent commits: {last_20_commits}

## Conversation History
{chat_history_from_db}

When the user seems happy with the direction, propose a task breakdown.
Each task needs: id, title, description, files_likely_touched, depends_on,
acceptance_criteria. Tell the user to type @build when ready.

Do NOT generate code. Only plan.
```

### Coder Task Prompt

```
You are implementing a specific task in a larger project.

## Task
{task.title}

## Description
{task.description}

## Acceptance Criteria
{task.acceptance_criteria as bullet list}

## Files You'll Likely Touch
{task.files_likely_touched}

## Context from Completed Tasks
{diffs_from_dependency_tasks}

Implement this task completely. Create or modify files as needed.
Do not implement anything outside the scope of this task.
```

### Reviewer Prompt

```
You are a senior code reviewer. Review this diff for:
1. Correctness — does it meet the acceptance criteria?
2. Quality — clean code, no obvious bugs, proper error handling
3. Scope — only changes what's needed

## Task
{task.title}: {task.description}

## Acceptance Criteria
{task.acceptance_criteria}

## Diff
{git_diff}

Respond with ONLY valid JSON:
{
  "verdict": "approve" | "request_changes",
  "issues": [
    { "file": "...", "line": 42, "severity": "error|warning", "message": "..." }
  ],
  "summary": "Overall assessment"
}
```

### Feedback Iteration Prompt

```
The user has reviewed the PR and has feedback. Determine what needs to change.

## Original Plan
{plan_json}

## Current State of Tasks
{all_tasks_with_status_and_diffs}

## User Feedback
{feedback_text}

## Previous Iterations
{iteration_history}

Respond with ONLY valid JSON — a plan delta:
{
  "modified_tasks": [
    { "id": "task-003", "changes": "Update accent color to #00BFFF in dark preset" }
  ],
  "new_tasks": [
    { "id": "task-007", "title": "...", "description": "...", ... }
  ],
  "summary": "What's changing and why"
}
```

---

## 12. Error Handling & Escalation

| Scenario               | Behavior                                                      |
| ---------------------- | ------------------------------------------------------------- |
| CLI not found          | Error at startup, suggest `sweteam init`                      |
| `gh` not authenticated | Error with: `run gh auth login first`                         |
| Repo not found         | Error with: `repo {repo} not found on GitHub`                 |
| Agent times out        | Retry once, then mark task failed                             |
| Agent non-zero exit    | Capture stderr, retry with error context, then escalate       |
| Review fails N times   | Force-accept and merge, continue others                       |
| Merge conflict         | Abort merge, mark task failed, continue others                |
| All tasks escalated    | Move to `awaiting_feedback` with failure report               |
| Dependency task failed | Downstream tasks → `blocked`                                  |

All errors are persisted as `system` messages in the session chat, so the user sees them when they `/enter`.

---

## 13. Security

- **No additional auth**: sweteam never stores API keys. CLIs manage their own auth.
- **Git branch isolation**: Each task runs in its own branch. Bad code is never on main.
- **No network calls**: sweteam itself makes zero API requests. Only `git`, `gh`, and coding CLIs do.
- **Audit trail**: Every prompt and response is stored in SQLite per session.
- **Local-only data**: SQLite DB is local. Nothing is sent anywhere.

---

## 14. Project Structure

```
sweteam/
├── package.json
├── tsconfig.json
├── drizzle.config.ts
├── src/
│   ├── index.ts                 # CLI entry point (Commander.js)
│   ├── lifecycle.ts             # Process tracking and shutdown
│   ├── commands/
│   │   ├── create.ts            # /create handler
│   │   ├── enter.ts             # /enter handler
│   │   ├── list.ts              # /list handler
│   │   ├── show.ts              # /show handler
│   │   ├── stop.ts              # /stop handler
│   │   ├── delete.ts            # /delete handler
│   │   └── init.ts              # auto-discovery + config gen
│   ├── session/
│   │   ├── manager.ts           # session CRUD, state transitions
│   │   ├── interactive.ts       # interactive chat loop (planning + feedback)
│   │   ├── state-machine.ts     # status transition validation
│   │   ├── agent-log.ts         # agent output log (JSONL-based streaming)
│   │   └── in-session-commands.ts # @-command handlers
│   ├── planner/
│   │   ├── planner.ts           # plan generation + chat orchestration
│   │   └── plan-parser.ts       # parse agent output into structured plan
│   ├── orchestrator/
│   │   ├── orchestrator.ts      # DAG walker, parallel task dispatch
│   │   ├── task-runner.ts       # single task: branch → code → review → merge
│   │   ├── build-handler.ts     # full build pipeline orchestration
│   │   ├── reviewer.ts          # review loop with force-accept fallback
│   │   ├── feedback-handler.ts  # process @feedback, generate plan delta
│   │   ├── dag.ts               # task dependency graph
│   │   ├── parallel-runner.ts   # parallel task execution
│   │   └── error-handling.ts    # error pattern matching + friendly messages
│   ├── adapters/
│   │   ├── adapter.ts           # AgentAdapter interface
│   │   ├── claude-code.ts
│   │   ├── codex.ts
│   │   ├── opencode.ts
│   │   ├── custom.ts            # generic adapter from config
│   │   └── prompt-detection.ts  # detect prompt delivery method
│   ├── git/
│   │   └── git.ts               # raw git/gh CLI wrappers
│   ├── db/
│   │   ├── schema.ts            # Drizzle schema (sessions, messages, tasks, iterations)
│   │   └── client.ts            # SQLite connection + Drizzle instance
│   ├── ui/
│   │   ├── theme.ts             # color palette, icons, box-drawing, helpers
│   │   ├── banner.ts            # startup banner
│   │   ├── prompt.ts            # raw-mode input with autocomplete
│   │   ├── agent-panel.ts       # live agent output display
│   │   ├── sidebar.ts           # persistent session sidebar
│   │   └── markdown.ts          # markdown rendering
│   ├── repl/
│   │   └── repl.ts              # interactive REPL loop
│   ├── config/
│   │   ├── loader.ts            # TOML config loader + CLI flag merging
│   │   ├── discovery.ts         # auto-detect installed CLIs
│   │   └── gh-auth.ts           # GitHub authentication helper
│   ├── utils/
│   │   └── time.ts              # time formatting utilities
│   └── __tests__/               # test suite (Vitest)
└── drizzle/
    └── migrations/              # generated migration files
```

---

## 15. Tech Stack

| Component     | Choice                      | Why                                             |
| ------------- | --------------------------- | ----------------------------------------------- |
| Language      | TypeScript (Node.js)        | Same ecosystem as Claude Code, fast to iterate  |
| ORM           | Drizzle                     | Type-safe, lightweight, great SQLite support    |
| Database      | SQLite (via better-sqlite3) | Zero setup, local, perfect for CLI tool         |
| TUI           | Custom (chalk, gradient-string, raw-mode prompt) | Lightweight, no framework overhead    |
| Process mgmt  | `child_process` (native)    | No extra deps for spawning CLIs                 |
| Git           | `git` CLI directly          | No abstraction layer, user's git config applies |
| GitHub        | `gh` CLI directly           | Auth, PR creation, repo resolution              |
| Config        | TOML via `@iarna/toml`      | Standard for dev tools                          |
| CLI framework | Commander.js                | Command routing, flag parsing                   |
| IDs           | nanoid                      | Short, URL-safe, collision-resistant            |

---

## 16. Implementation Plan

### Phase 1 — MVP

1. Project scaffolding + Drizzle schema + migrations
2. Config loader + CLI auto-discovery (`sweteam init`)
3. Session manager: `/create`, `/list`, `/enter`, `/stop`, `/delete`
4. Git wrapper (raw CLI calls)
5. Claude Code adapter (single adapter)
6. Planning chat loop (interactive)
7. Sequential task execution (no parallelism)
8. Review loop
9. PR creation via `gh`
10. Basic completion report

### Phase 2 — Feedback + Multi-CLI

1. `@feedback` handler + iteration tracking
2. Plan delta generation + incremental builds
3. Codex and OpenCode adapters
4. Custom adapter support
5. ~~Merge conflict resolution~~ (descoped — merge failures mark task as failed)

### Phase 3 — Parallel + Polish

1. DAG-based parallel execution
2. ~~Full Ink TUI dashboard~~ (replaced by custom chalk-based UI)
3. `@status`, `@diff`, `@tasks` commands
4. Session search/filter
5. Export session as markdown report

### Phase 4 — Advanced

1. Test runner integration (run tests as part of review)
2. LSP integration (type-check after generation)
3. Cost tracking per session
4. Supervisor agent (watches whole run, can re-plan mid-execution)
