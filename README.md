<p align="center">
<pre align="center">
┌─────────────────┐
│    ◉       ◉    │
│    ─────────    │
└─────────────────┘
</pre>
</p>

<h1 align="center">sweteam</h1>

<p align="center">
<strong>Autonomous coding agent orchestrator — turns high-level goals into PR'd code.</strong><br/>
<em>It is not another coding agent. It orchestrates the ones you already have.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/npm/v/sweteam?color=blue&label=npm" alt="npm version" />
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="node version" />
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="license" />
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen" alt="PRs welcome" />
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="#how-it-works">How It Works</a> &middot;
  <a href="#commands">Commands</a> &middot;
  <a href="#configuration">Configuration</a> &middot;
  <a href="#contributing">Contributing</a>
</p>

---

## Why sweteam?

Real software isn't built by a single person typing in a terminal. It's built by **teams** — a tech lead breaks down the work, engineers pick up tasks, reviewers catch mistakes, and the whole thing ships through a structured process. That's what makes production code robust.

sweteam brings that same discipline to AI coding agents:

```
              How a real engineering team works
              ─────────────────────────────────

 ┌───────────┐    You describe what you want. The planner
 │  You      │    asks questions, proposes an architecture,
 │  (PM)     │    and breaks it into scoped tasks — just like
 └─────┬─────┘    a tech lead running a planning session.
       │
       ▼
 ┌────────────┐   The planner decomposes your goal into small
 │  Planner   │   tasks with acceptance criteria, dependency
 │ (Tech Lead)│   order, and file-level scope. You review
 └─────┬──────┘   and refine before anything gets built.
       │
       │  @build
       ▼
 ┌───────────┐    Each task is assigned to a coding agent on
 │  Coders   │    its own branch. Independent tasks run in
 │(Engineers)│    parallel — like engineers on a team working
 └─────┬─────┘    on separate features simultaneously.
       │
       ▼
 ┌───────────┐    A separate agent reviews each task's diff
 │ Reviewer  │    against its acceptance criteria. If the
 │  (Senior) │    review fails, the coder automatically
 └─────┬─────┘    retries — this loop repeats until the
       │          reviewer is satisfied or the max cycle
       │          limit is reached, just like a real senior
       │          engineer blocking a PR until it's right.
       │
       ▼
 ┌───────────┐    Approved tasks are merged, the branch is
 │  Git + PR │    pushed, and a PR is opened. The session
 │  (CI/CD)  │    stays open — give feedback, agents iterate
 └─────┬─────┘    on the same PR until you're satisfied.
       │
       ▼
      Done
```

The key ideas:

- **Granular task breakdown** — your goal is decomposed into small, scoped tasks with explicit acceptance criteria, so each agent call has a clear contract
- **DAG execution** — tasks are organized into a dependency graph and dispatched in the correct order, with independent tasks running in parallel
- **Multi-model review loop** — every task is reviewed by a separate agent against its acceptance criteria; failures are retried automatically, just like a real code review cycle
- **Session persistence** — sessions, plans, tasks, diffs, and full conversation history are stored in SQLite; crash, close the terminal, come back tomorrow — nothing is lost
- **Agent-agnostic** — works with Claude Code, Codex CLI, OpenCode, or any custom CLI that reads stdin and writes stdout

sweteam doesn't replace your coding agents. It gives them the same structure that makes real engineering teams ship reliable code.

## Terminal UI

When you launch `sweteam`, you're greeted with an interactive REPL:

```
╭─── sweteam v0.1.0 ────────────────────────────────────────────╮
│                                │                              │
│    Welcome to sweteam!         │ Getting started              │
│                                │ /create [repo]  Start new    │
│      ┌─────────────────┐       │ /list           See all      │
│      │    ◉       ◉    │       │ /enter <id>     Resume       │
│      │    ─────────    │       │ ──────────────────────────── │
│      └─────────────────┘       │ Recent sessions              │
│                                │ s_a1b2c3d4 Add dark theme    │
│  Orchestrator · v0.1.0         │ s_e5f6g7h8 Fix auth flow     │
│  ~/projects/myrepo             │                              │
╰───────────────────────────────────────────────────────────────╯

sweteam>
```

Inside a session, agents stream their work in real time:

```
▶ Coder ─ task-001: Add ThemeConfig and color definitions
──────────────────────────────────────────────────────────
│ Creating src/theme/config.ts with color palette...
│ Adding ThemeConfig interface with light/dark variants...
│ Defining CSS custom properties for runtime switching...
✓ Coder completed

▶ Reviewer ─ task-001: Add ThemeConfig and color definitions
──────────────────────────────────────────────────────────
│ Checking diff against acceptance criteria...
│ All criteria met. Approving.
✓ Reviewer completed
```

## Features

- **Session-based** — every interaction lives in a persistent session with full history
- **Zero config** — discovers installed CLIs automatically, uses their existing auth
- **Human-in-the-loop planning** — chat with the planner, refine the plan, then go hands-off
- **Parallel execution** — independent tasks run concurrently across multiple agents
- **Review loop** — built-in code review with configurable retry cycles
- **Feedback iterations** — session stays open; you give feedback, agents iterate on the same PR
- **Live attach** — re-enter any session and see agent output streaming in real time
- **Git native** — all git/GitHub operations via `git` and `gh` CLI directly
- **Pluggable agents** — supports Claude Code, Codex CLI, OpenCode, or any custom CLI

## Prerequisites

You need at least **one** coding CLI installed:

| CLI | Install |
|---|---|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `npm install -g @anthropic-ai/claude-code` |
| [Codex CLI](https://github.com/openai/codex) | `npm install -g @openai/codex` |
| [OpenCode](https://github.com/opencode-ai/opencode) | `go install github.com/opencode-ai/opencode@latest` |

Plus these required tools:

- **git** — version control
- **gh** — [GitHub CLI](https://cli.github.com/) (authenticated via `gh auth login`)
- **Node.js** — v18+

## Installation

### From npm

```bash
npm install -g sweteam
```

### From source

```bash
git clone https://github.com/SiluPanda/sweteam.git
cd sweteam
npm install
npm run build
npm link
```

## Quick Start

### 1. Initialize

```bash
sweteam init
```

Auto-discovers your installed CLIs and generates `~/.sweteam/config.toml`:

```
✓ Found claude (Claude Code v1.x)
✓ Found codex (Codex CLI v0.x)
✗ opencode not found
✓ Found gh (GitHub CLI v2.x)
✓ Found git (v2.43)
Generated ~/.sweteam/config.toml
```

### 2. Create a session

```bash
sweteam create myrepo
```

Or launch the interactive REPL and create from there:

```bash
sweteam
sweteam> /create myrepo
```

This will:
- Resolve `myrepo` to your GitHub username (e.g. `YourName/myrepo`)
- Clone the repo (or fetch latest if already cloned)
- Create a working branch
- Enter the **planning chat**

### 3. Plan interactively

You're now chatting with the planner agent. Describe your goal, ask questions, refine the approach:

```
crawlgator-ui> Add dark theme with system preference detection and a Ctrl+T toggle

▶ Planner ─ s_a1b2c3d4: Add dark theme
────────────────────────────────────────
│ I'll break this down into 6 tasks:
│
│ task-001: Add ThemeConfig and color definitions
│ task-002: Implement system preference detection
│ task-003: Create dark theme preset
│ ...
│
│ Type @build when you're ready.
✓ Planner completed

crawlgator-ui> @build
```

### 4. Watch it build

sweteam decomposes the plan into tasks, dispatches them to coding agents, reviews each result, and merges into the session branch — all autonomously.

```
Plan finalized. Starting autonomous build...

Found 6 tasks:

  task-001  Add ThemeConfig and color definitions
  task-002  Implement system preference detection
  task-003  Create dark theme preset (depends on: task-001)
  task-004  Create light theme preset (depends on: task-001)
  task-005  Wire theme into TUI render paths (depends on: task-002, task-003, task-004)
  task-006  Add runtime theme toggle (depends on: task-005)

▶ Coder ─ task-001: Add ThemeConfig and color definitions
──────────────────────────────────────────────────────────
│ Creating src/theme/config.ts...
│ ...
✓ Coder completed

▶ Reviewer ─ task-001: Add ThemeConfig and color definitions
──────────────────────────────────────────────────────────
│ Reviewing diff against acceptance criteria...
✓ Reviewer completed

Build complete.

  ✓ task-001  Add ThemeConfig and color definitions
  ✓ task-002  Implement system preference detection
  ✓ task-003  Create dark theme preset
  ✓ task-004  Create light theme preset
  ✓ task-005  Wire theme into TUI render paths
  ⚠ task-006  Add runtime theme toggle — ESCALATED

PR: https://github.com/YourName/myrepo/pull/42

Review the PR and type @feedback with any changes needed.
```

### 5. Give feedback

```
crawlgator-ui> @feedback The dark theme colors are too muted. Make the accent brighter (#00BFFF).
```

Agents pick up your feedback, iterate, and push updates to the same PR.

### 6. Re-enter a session

Come back later and pick up where you left off. If agents are still running, you'll see their output stream live:

```bash
sweteam enter s_a1b2c3d4
```

```
Entered session s_a1b2c3d4 (YourName/myrepo)
  Goal:   Add dark theme with system preference detection
  Status: building

Attaching to live build output... (press Enter to detach)

▶ Coder ─ task-005: Wire theme into TUI render paths
──────────────────────────────────────────────────────────
│ Integrating theme provider into the component tree...
```

## Commands

### Top-level commands

| Command | Description |
|---|---|
| `sweteam` | Launch interactive REPL |
| `sweteam init` | Auto-discover CLIs and generate config |
| `sweteam create [repo]` | Create a new session |
| `sweteam list` | List all sessions |
| `sweteam enter <session_id>` | Re-enter an existing session |
| `sweteam show <session_id>` | Show detailed session status |
| `sweteam stop <session_id>` | Stop a session |
| `sweteam delete <session_id>` | Delete a session |

### In-session commands

Once inside a session, use `@` commands:

| Command | Description |
|---|---|
| `@build` | Finalize plan and start autonomous coding |
| `@status` | Show task progress dashboard |
| `@plan` | Re-display the current plan |
| `@feedback <text>` | Give feedback on completed work (triggers new iteration) |
| `@diff` | Show cumulative diff |
| `@pr` | Show the PR link |
| `@tasks` | List all tasks with statuses and review info |
| `@stop` | Stop this session and return to REPL |
| `@help` | Show available commands |

Any other text is sent directly to the planner for conversation.

### REPL commands

Inside the interactive REPL, use `/` commands:

| Command | Description |
|---|---|
| `/create [repo]` | Start a new session |
| `/list` | See all sessions |
| `/enter <id>` | Resume a session |
| `/show <id>` | Inspect a session |
| `/stop <id>` | Stop a session |
| `/delete <id>` | Delete a session |
| `/init` | Re-run CLI discovery |
| `/help` | Show help |
| `/exit` | Quit |

### CLI flags

```bash
sweteam --coder codex          # Override coder agent
sweteam --reviewer claude-code # Override reviewer agent
sweteam --parallel 5           # Override max parallel tasks
sweteam --config ./custom.toml # Use custom config file
```

### List filters

```bash
sweteam list --status building    # Filter by status
sweteam list --repo myrepo        # Filter by repo name
```

## How It Works

### Architecture

```
┌──────────────────────────────────────────────────────────┐
│                       sweteam CLI                        │
│                                                          │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │ Session  │  │   Planner    │  │  Orchestrator      │  │
│  │ Manager  │  │  (chat mode) │  │  (autonomous)      │  │
│  └──────────┘  └──────────────┘  └────────────────────┘  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │          Agent Adapter Layer                       │  │
│  │ ┌────────────┐ ┌──────────┐ ┌────────────────────┐ │  │
│  │ │ Claude Code│ │ Codex CLI│ │ OpenCode / Custom  │ │  │
│  │ └────────────┘ └──────────┘ └────────────────────┘ │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌──────────────────────┐  ┌──────────────────────────┐  │
│  │  SQLite + Drizzle    │  │  git + gh CLI (native)   │  │
│  │  (session store)     │  │  (branches, PRs, commits)│  │
│  └──────────────────────┘  └──────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### Session lifecycle

```
                    /create
                       │
                       v
        ┌──────────────────────────┐
        │        planning          │ <── chat with planner
        └────────────┬─────────────┘
                     │ @build
                     v
        ┌──────────────────────────┐
        │        building          │ <── agents code + review
        └────────────┬─────────────┘
                     │
                     v
        ┌──────────────────────────┐
        │    awaiting_feedback     │ <── PR created, user reviews
        └────────────┬─────────────┘
                     │ @feedback
                     v
        ┌──────────────────────────┐
        │        iterating         │ <── agents apply feedback
        └────────────┬─────────────┘
                     │
                     v
              awaiting_feedback ─── (loops until satisfied)
                     │
                     │ /stop
                     v
        ┌──────────────────────────┐
        │         stopped          │
        └──────────────────────────┘
```

### Task execution pipeline

1. **Plan** — the planner agent decomposes your goal into tasks with dependencies
2. **DAG** — tasks are organized into a dependency graph
3. **Dispatch** — independent tasks run concurrently (up to `max_parallel`)
4. **Code** — each task is assigned to a coding agent on its own git branch
5. **Review** — a reviewer agent checks the diff against acceptance criteria
6. **Fix loop** — if review finds issues, the coder retries (up to `max_review_cycles`)
7. **Merge** — approved tasks are squash-merged into the session branch
8. **PR** — the session branch is pushed and a GitHub PR is created

## Configuration

Config lives at `~/.sweteam/config.toml`. Generated by `sweteam init`.

```toml
[roles]
planner = "claude-code"       # Which CLI generates the plan
coder = "claude-code"         # Which CLI writes code
reviewer = "claude-code"      # Which CLI reviews code

[execution]
max_parallel = 3              # Concurrent coding agents
max_review_cycles = 3         # Review/fix loops before escalating
branch_prefix = "sw/"         # Prefix for all branches

[git]
commit_style = "conventional" # conventional | simple
squash_on_merge = true

[agents.claude-code]
command = "claude"
args = ["-p"]

[agents.codex]
command = "codex"
args = ["-q"]

[agents.opencode]
command = "opencode"
args = ["--non-interactive"]
```

### Custom agents

Any CLI that accepts a prompt on stdin and writes output to stdout can be used as an agent:

```toml
[agents.my-agent]
command = "my-coding-tool"
args = ["--mode", "autonomous"]
prompt_via = "stdin"          # stdin | arg | file
output_from = "stdout"        # stdout | file
```

Then reference it in your roles:

```toml
[roles]
coder = "my-agent"
```

## Data storage

All data is stored locally:

```
~/.sweteam/
├── sweteam.db          # SQLite database (sessions, tasks, messages)
├── config.toml         # Global configuration
├── logs/               # Agent output logs (for live attach)
│   └── s_a1b2c3d4.jsonl
└── repos/              # Cloned repositories
    └── YourName--myrepo/
```

- **No API keys stored** — coding CLIs manage their own authentication
- **No network calls** — sweteam itself makes zero API requests; only the underlying agents and git/gh do
- **Full audit trail** — every prompt, response, and system event is stored per session

## Development

```bash
git clone https://github.com/SiluPanda/sweteam.git
cd sweteam
npm install

# Run in dev mode (no build step)
npm run dev

# Run with subcommands
npm run dev -- create myrepo

# Run tests
npm test

# Build
npm run build

# Link globally for testing
npm link
```

### Project structure

```
src/
├── index.ts                 # CLI entry point (Commander.js)
├── repl/                    # Interactive REPL loop
├── session/                 # Session manager, state machine, agent log
├── planner/                 # Planner agent and plan parser
├── orchestrator/            # Task runner, reviewer, build/feedback handlers
├── adapters/                # Agent adapters (claude-code, codex, opencode, custom)
├── commands/                # CLI subcommands (create, list, enter, etc.)
├── config/                  # Config loader and GitHub auth
├── git/                     # Git and GitHub CLI wrappers
├── ui/                      # Terminal UI (banner, prompt, agent panel, markdown)
├── db/                      # SQLite schema and client (Drizzle ORM)
└── __tests__/               # Test suite
```

### Tech stack

| Component | Choice |
|---|---|
| Language | TypeScript (ESM, Node.js 18+) |
| ORM | Drizzle |
| Database | SQLite via better-sqlite3 |
| CLI framework | Commander.js |
| Terminal UI | Custom (chalk, raw-mode prompt) |
| Git | `git` + `gh` CLI (child process) |
| IDs | nanoid |
| Config | TOML |
| Tests | Vitest |

## Contributing

Contributions are welcome. Please open an issue first to discuss what you'd like to change.

```bash
# Fork and clone
git clone https://github.com/your-name/sweteam.git
cd sweteam
npm install

# Create a branch
git checkout -b feat/my-feature

# Make changes, run tests
npm test

# Submit a PR
```

## License

[MIT](LICENSE)
