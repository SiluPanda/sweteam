import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// ─── Sessions ───────────────────────────────────────────
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(), // nanoid, e.g. "s_a1b2c3d4"
  repo: text("repo").notNull(), // fully qualified: "SiluPanda/weav"
  repoLocalPath: text("repo_local_path"), // local clone path
  goal: text("goal").notNull(), // original user goal
  status: text("status").notNull(), // planning | building | awaiting_feedback | iterating | stopped
  planJson: text("plan_json"), // the finalized plan (JSON string)
  prUrl: text("pr_url"), // github PR link once created
  prNumber: integer("pr_number"), // PR number
  workingBranch: text("working_branch"), // e.g. "sw/s_a1b2c3d4-dark-theme"
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  stoppedAt: integer("stopped_at", { mode: "timestamp" }),
});

// ─── Chat Messages ──────────────────────────────────────
// Full conversation history: user messages, agent responses,
// system events, and feedback — all in one ordered stream.
export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(), // nanoid
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // user | agent | system
  content: text("content").notNull(), // message text
  metadata: text("metadata"), // JSON: { agent: "claude-code", phase: "planning" } etc.
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// ─── Tasks ──────────────────────────────────────────────
// Individual coding tasks decomposed from the plan.
export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(), // e.g. "task-001"
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull(), // queued | running | reviewing | fixing | done | failed | blocked
  dependsOn: text("depends_on"), // JSON array of task IDs
  filesLikelyTouched: text("files_likely_touched"), // JSON array
  acceptanceCriteria: text("acceptance_criteria"), // JSON array
  branchName: text("branch_name"), // e.g. "sw/task-001-oauth-config"
  reviewVerdict: text("review_verdict"), // approve | request_changes
  reviewIssues: text("review_issues"), // JSON array of review issues
  reviewCycles: integer("review_cycles").default(0),
  diffPatch: text("diff_patch"), // stored diff after completion
  agentOutput: text("agent_output"), // full agent response
  order: integer("order").notNull(), // execution order
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// ─── Feedback Iterations ────────────────────────────────
// When user gives feedback after a build, each round is tracked.
export const iterations = sqliteTable("iterations", {
  id: text("id").primaryKey(), // nanoid
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  iterationNumber: integer("iteration_number").notNull(),
  feedback: text("feedback").notNull(), // user's feedback text
  planDelta: text("plan_delta"), // what changed in the plan (JSON)
  status: text("status").notNull(), // planning | building | done | failed
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
