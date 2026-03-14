# Bug Bash — sweteam

Audit of codebase against README and spec.md. Generated 2026-03-14.

---

## Bugs / Incorrect Documentation

### 1. Spec claims Ink/React TUI — removed from codebase

**Spec** (Section 15): Lists `TUI: Ink (React for CLI)` as the TUI framework.
**Spec** (Section 14): Lists `src/tui/` directory with `dashboard.ts`, `session-list.ts`, `chat-ui.ts`.
**Code**: Ink and React dependencies were removed in commit `293f11c`. No `src/tui/` directory exists. TUI is now custom chalk-based components in `src/ui/`.

**Impact**: Spec is materially wrong about the rendering stack.

### 2. Spec project structure is stale

**Spec** (Section 14) lists:
- `src/session/chat.ts` — does not exist (logic is in `interactive.ts`)
- `src/session/manager.ts` — does not exist (logic is in `session-manager.ts`)
- `src/tui/` directory — does not exist
- `db/schema.ts` re-export — does not exist at root level
- Missing: `src/lifecycle.ts`, `src/ui/`, `src/utils/`, `src/__tests__/`, `src/session/agent-log.ts`, `src/session/in-session-commands.ts`, `src/orchestrator/build-handler.ts`, `src/orchestrator/reviewer.ts`, `src/orchestrator/error-handling.ts`, `src/orchestrator/dag.ts`, `src/orchestrator/parallel-runner.ts`

**Impact**: Anyone using the spec as a code map will be lost.

### 3. README tech stack lists "Custom (chalk, raw-mode prompt)" — incomplete

**Code**: The UI now also uses `gradient-string` for brand gradients (added as a dependency). The README tech stack table doesn't mention it. Minor, but technically inaccurate.

### 4. Spec lists CLI framework as "Commander.js or yargs"

**Code**: Only Commander.js is used (`src/index.ts`). Spec is ambiguous; should say Commander.js.

---

## Gaps — Features in Spec but Not Implemented

### 5. No `Reporter` / TUI dashboard component

**Spec** (Section 3.2): Describes a `Reporter` component — "TUI dashboard showing real-time status of all tasks within the active session."
**Code**: No such component exists. Live output is streamed via `agent-log.ts` + `watchBuildLive()` in the REPL, but there's no persistent dashboard view (e.g., a split-pane showing task progress alongside output).

### 6. Spec commands vs README commands gap

**Spec** (Section 5.2) lists only 9 in-session commands: `@build`, `@status`, `@plan`, `@feedback`, `@diff`, `@pr`, `@tasks`, `@stop`, `@help`.
**Code** implements 14: the above plus `@watch`, `@ask`, `@cancel`, `@image`, `@images`.
**Spec is outdated** — doesn't reflect the commands added after spec v0.2.

### 7. No merge conflict auto-resolution

**Spec** (Section 12): "Merge conflict → Attempt auto-resolve via coder agent, escalate if still stuck."
**Code**: `attemptMergeConflictResolution()` exists in `error-handling.ts` but is dead code — never called from the build pipeline. Merge conflicts will cause task failures without auto-resolution attempts.

### 8. No test runner integration

**Spec** (Section 16, Phase 4): Lists "Test runner integration (run tests as part of review)."
**Code**: `test-runner.ts` exists but is dead code — never called from the build or review pipeline.

### 9. No export session as markdown report

**Spec** (Section 16, Phase 3): Lists "Export session as markdown report."
**Code**: Not implemented.

### 10. No cost tracking

**Spec** (Section 16, Phase 4): Lists "Cost tracking per session."
**Code**: Not implemented.

### 11. No supervisor agent

**Spec** (Section 16, Phase 4): Lists "Supervisor agent (watches whole run, can re-plan mid-execution)."
**Code**: Not implemented.

### 12. No LSP integration

**Spec** (Section 16, Phase 4): Lists "LSP integration (type-check after generation)."
**Code**: Not implemented.

---

## Gaps — README vs Code Discrepancies

### 13. `--image` CLI flag not documented in README

**Code** (`src/index.ts` line 23): `.option('--image <path...>', 'Image file(s) to attach')` is implemented and used in both `create` and `enter` flows.
**README**: CLI flags section does not list `--image`.

### 14. `/quit` REPL command not documented

**Code** (`src/repl/repl.ts`): `/quit` is an alias for `/exit`.
**README**: Only lists `/exit`.

### 15. No `--planner` CLI flag

**README** (config section): Documents `planner` as a configurable role in `[roles]`.
**Code**: CLI flags only support `--coder` and `--reviewer` overrides. No `--planner` flag exists. Users cannot override the planner agent from the command line.

### 16. Auto-escalation behavior differs from README

**README**: Shows `task-006` as "ESCALATED" in the build report, implying manual review.
**Code** (`reviewer.ts` lines 245-289): Tasks that exhaust `max_review_cycles` are **force-accepted and merged automatically**, not marked as escalated for manual review. The task status shows as `done`, not `escalated`.

---

## Code Quality Issues

### 17. No database indexes on session_id columns

**Schema** (`src/db/schema.ts`): Foreign keys reference `sessions.id` but no explicit indexes on `session_id` in `tasks`, `messages`, or `iterations` tables. Every query filtering by session does a full table scan.

### 18. Dead code remains in codebase

- `executeWithRetry()` in `error-handling.ts` — never called
- `attemptMergeConflictResolution()` in `error-handling.ts` — never called
- `test-runner.ts` — never imported or called

### 19. No `NO_COLOR` environment variable support

Terminal colors via chalk are always active. The `NO_COLOR` convention (https://no-color.org/) is not respected.

### 20. No terminal resize handling

REPL prompt and sidebar do not recalculate layout on `SIGWINCH` (terminal resize). Content can overflow or underflow after resize.

### 21. No AbortSignal / cancellation for in-flight agent tasks

`@stop` and `@cancel` kill tracked processes but there's no cooperative cancellation. If an agent process is mid-execution when stop is called, the spawned child process may continue running.

---

## Summary

| Category | Count |
|----------|-------|
| Incorrect documentation (bugs) | 4 |
| Spec features not implemented | 8 |
| README vs code discrepancies | 4 |
| Code quality issues | 5 |
| **Total findings** | **21** |
