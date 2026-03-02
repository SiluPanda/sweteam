<p align="center">
<pre align="center">
┌─────────────────┐
│                 │
│    ◉       ◉    │
│                 │
│    ─────────    │
│                 │
└─────────────────┘
</pre>
</p>

<h1 align="center">sweteam</h1>

<p align="center">
<strong>Autonomous coding agent orchestrator — turns high-level goals into PR'd code.</strong>
</p>

<p align="center">
  <a href="#installation">Installation</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#how-it-works">How It Works</a> •
  <a href="#commands">Commands</a> •
  <a href="#configuration">Configuration</a>
</p>

---

## What is sweteam?

sweteam sits **on top of** existing coding CLIs (Claude Code, Codex CLI, OpenCode) and orchestrates them into a persistent, session-based workflow. Give it a repo and a goal — it plans, codes, reviews, and opens a PR. Then it stays open for your feedback.

```
You: "Add dark theme with system preference detection"
         │
         ▼
  Planning Chat ◄── you refine the plan with an AI architect
         │
         │  @build
         ▼
  Decompose → Code (parallel) → Review → Fix → PR
         │
         ▼
  Session stays open — give feedback, agents iterate
         │
         ▼
  You're satisfied → done
```

**It is not another coding agent.** It orchestrates the ones you already have installed.

## Features

- **Session-based** — every interaction lives in a persistent session with full history
- **Zero config** — discovers installed CLIs, uses their existing auth
- **Human-in-the-loop planning** — chat with the planner, refine the plan, then hands-off
- **Parallel execution** — independent tasks run concurrently across multiple agents
- **Review loop** — built-in code review with configurable retry cycles
- **Feedback iterations** — session stays open, you give feedback, agents iterate
- **Git native** — all git/GitHub operations via `git` and `gh` CLI directly
- **Multiple agents** — supports Claude Code, Codex CLI, OpenCode, and custom CLIs

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

After `npm link`, the `sweteam` command is available globally on your machine.

## Quick Start

### 1. Initialize

```bash
sweteam init
```

This auto-discovers your installed CLIs and generates `~/.sweteam/config.toml`:

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
sweteam create myrepo "Add dark theme with system preference detection"
```

This will:
- Resolve `myrepo` to your GitHub username (e.g. `YourName/myrepo`)
- Clone the repo (or fetch latest if already cloned)
- Create a working branch
- Enter the **planning chat**

### 3. Plan interactively

You're now chatting with the planner agent:

```
> I want the toggle to use Ctrl+T not just 't'

[agent] Good call. Updated the plan:
        ...
        6. Add runtime theme toggle (keybinding: Ctrl+T)

        Ready to build? Type @build when ready.

> @build
```

### 4. Watch it build

sweteam decomposes the plan into tasks, dispatches them to coding agents, reviews each result, and merges into the session branch — all autonomously.

```
[system] Build complete.

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
> @feedback The dark theme colors are too muted. Make accent brighter (#00BFFF).
```

Agents pick up your feedback, iterate, and push updates to the same PR.

## Commands

### Top-level commands

| Command | Description |
|---|---|
| `sweteam init` | Auto-discover CLIs and generate config |
| `sweteam create <repo> <goal>` | Create a new session |
| `sweteam list` | List all sessions |
| `sweteam enter <session_id>` | Re-enter an existing session |
| `sweteam stop <session_id>` | Stop a session |
| `sweteam delete <session_id>` | Delete a session |

### In-session commands

Once inside a session, use these `@` commands:

| Command | Description |
|---|---|
| `@build` | Finalize plan and start autonomous coding |
| `@status` | Show current task progress dashboard |
| `@plan` | Re-display the current plan |
| `@feedback <text>` | Give feedback on completed work |
| `@diff` | Show cumulative diff |
| `@pr` | Show the PR link |
| `@tasks` | List all tasks and their statuses |
| `@stop` | Stop this session |
| `@help` | Show available commands |

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
┌──────────────────────────────────────────────────────┐
│                    sweteam CLI                        │
├──────────┬──────────────┬──────────────┬─────────────┤
│ Session  │   Planner    │ Orchestrator │  Reporter    │
│ Manager  │  (chat mode) │ (autonomous) │ (TUI)        │
├──────────┴──────────────┴──────────────┴─────────────┤
│                 Agent Adapter Layer                    │
│    ┌──────────┐  ┌──────────┐  ┌──────────────┐      │
│    │ Claude   │  │ Codex    │  │ OpenCode     │      │
│    │ Code     │  │ CLI      │  │ CLI          │      │
│    └──────────┘  └──────────┘  └──────────────┘      │
├──────────────────────────────────────────────────────┤
│          SQLite (Drizzle ORM) — Session Store          │
├──────────────────────────────────────────────────────┤
│       Git CLI + GitHub CLI (gh) — native calls        │
└──────────────────────────────────────────────────────┘
```

### Session lifecycle

```
/create → planning → @build → building → awaiting_feedback
                                              │
                                    @feedback ▼
                                          iterating
                                              │
                                              ▼
                                     awaiting_feedback (loops)
                                              │
                                        /stop ▼
                                           stopped
```

### Task execution

1. **Plan** — the planner agent decomposes your goal into tasks with dependencies
2. **DAG** — tasks are organized into a dependency graph
3. **Parallel dispatch** — independent tasks run concurrently (up to `max_parallel`)
4. **Code** — each task is assigned to a coding agent in its own git branch
5. **Review** — a reviewer agent checks the diff against acceptance criteria
6. **Fix loop** — if review finds issues, the coder retries (up to `max_review_cycles`)
7. **Merge** — approved tasks are squash-merged into the session branch
8. **PR** — the session branch is pushed and a PR is created

## Configuration

Config lives at `~/.sweteam/config.toml`. Generated by `sweteam init`.

```toml
[roles]
planner = "claude-code"       # Which CLI generates the plan
coder = "claude-code"         # Which CLI writes code
reviewer = "claude-code"      # Which CLI reviews code

[execution]
max_parallel = 3              # Concurrent coding agents
max_review_cycles = 3         # Review→fix loops before escalating
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

You can add any CLI as a coding agent:

```toml
[agents.my-agent]
command = "my-coding-tool"
args = ["--mode", "autonomous"]
prompt_via = "stdin"          # stdin | arg | file
output_from = "stdout"        # stdout | file
```

## Data storage

All data is local:

```
~/.sweteam/
├── sweteam.db          # SQLite database (sessions, tasks, messages)
├── config.toml         # Global config
└── repos/              # Cloned repos
    └── YourName--myrepo/
```

- **No API keys stored** — coding CLIs manage their own auth
- **No network calls** — sweteam itself makes zero API requests
- **Full audit trail** — every prompt and response is stored per session

## Development

```bash
# Clone and install
git clone https://github.com/SiluPanda/sweteam.git
cd sweteam
npm install

# Run in dev mode (no build needed)
npm run dev -- create myrepo "my goal"

# Run tests
npm test

# Build
npm run build

# Link globally for testing
npm link
```

## Tech Stack

| Component | Choice |
|---|---|
| Language | TypeScript (Node.js) |
| ORM | Drizzle |
| Database | SQLite (better-sqlite3) |
| TUI | Ink (React for CLI) |
| CLI framework | Commander.js |
| Git | `git` + `gh` CLI directly |
| IDs | nanoid |
| Config | TOML |

## License

MIT
