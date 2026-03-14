import { describe, it, expect } from 'vitest';
import { formatSessionTable, formatStatus } from '../commands/list.js';
import { stripAnsi } from '../ui/theme.js';
import type { EnrichedSession } from '../session/manager.js';

function makeSession(overrides: Partial<EnrichedSession> = {}): EnrichedSession {
  return {
    id: 's_abc12345',
    repo: 'owner/myrepo',
    goal: 'Add dark theme',
    status: 'building',
    prUrl: null,
    prNumber: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    planReady: true,
    messageCount: 5,
    tasksDone: 2,
    tasksTotal: 5,
    ...overrides,
  };
}

/** Strip ANSI codes from formatStatus output for text-content assertions. */
function statusText(session: EnrichedSession): string {
  return stripAnsi(formatStatus(session));
}

describe('commands/list — formatStatus', () => {
  it("should show 'planning (new)' for sessions with 0-1 messages", () => {
    expect(statusText(makeSession({ status: 'planning', messageCount: 0, planReady: false }))).toBe(
      'planning (new)',
    );
    expect(statusText(makeSession({ status: 'planning', messageCount: 1, planReady: false }))).toBe(
      'planning (new)',
    );
  });

  it("should show 'planning (N msgs)' for active conversations without a plan", () => {
    expect(statusText(makeSession({ status: 'planning', messageCount: 3, planReady: false }))).toBe(
      'planning (3 msgs)',
    );
  });

  it("should show 'planning (plan ready)' when plan is finalized", () => {
    expect(statusText(makeSession({ status: 'planning', messageCount: 5, planReady: true }))).toBe(
      'planning (plan ready)',
    );
  });

  it("should show 'building (done/total)' during build", () => {
    expect(statusText(makeSession({ status: 'building', tasksDone: 2, tasksTotal: 5 }))).toBe(
      'building (2/5)',
    );
  });

  it("should show 'building' when no tasks yet", () => {
    expect(statusText(makeSession({ status: 'building', tasksTotal: 0 }))).toBe('building');
  });

  it("should show 'feedback (PR #N)' for awaiting_feedback with PR", () => {
    expect(statusText(makeSession({ status: 'awaiting_feedback', prNumber: 42 }))).toBe(
      'feedback (PR #42)',
    );
  });

  it("should show 'awaiting feedback' without PR", () => {
    expect(statusText(makeSession({ status: 'awaiting_feedback', prNumber: null }))).toBe(
      'awaiting feedback',
    );
  });

  it("should show 'iterating (done/total)' during iteration", () => {
    expect(statusText(makeSession({ status: 'iterating', tasksDone: 3, tasksTotal: 5 }))).toBe(
      'iterating (3/5)',
    );
  });

  it("should show 'stopped' for stopped sessions", () => {
    expect(statusText(makeSession({ status: 'stopped' }))).toBe('stopped');
  });
});

describe('commands/list — formatSessionTable', () => {
  it('should show empty message when no sessions', () => {
    const output = formatSessionTable([]);
    expect(output).toContain('No sessions found');
  });

  it('should render a table with sessions', () => {
    const sessions = [makeSession()];
    const output = formatSessionTable(sessions);
    expect(output).toContain('sweteam Sessions');
    expect(output).toContain('s_abc12345');
    expect(output).toContain('owner/myrepo');
    expect(output).toContain('Add dark theme');
    expect(output).toContain('building');
  });

  it('should truncate long goals', () => {
    const sessions = [
      makeSession({
        id: 's_xyz',
        repo: 'owner/repo',
        goal: 'This is a very long goal that should be truncated properly',
        status: 'planning',
      }),
    ];
    const output = formatSessionTable(sessions);
    expect(output).toContain('…');
  });

  it('should show status badge in table', () => {
    const sessions = [makeSession({ status: 'planning', messageCount: 5, planReady: true })];
    const output = formatSessionTable(sessions);
    expect(output).toContain('planning');
  });

  it('should show Updated column with relative time', () => {
    const sessions = [makeSession()];
    const output = formatSessionTable(sessions);
    expect(output).toContain('Updated');
    expect(output).toContain('just now');
  });

  it('should handle multiple sessions', () => {
    const sessions = [
      makeSession({
        id: 's_1',
        repo: 'a/b',
        goal: 'Goal 1',
        status: 'planning',
        messageCount: 0,
        planReady: false,
      }),
      makeSession({ id: 's_2', repo: 'c/d', goal: 'Goal 2', status: 'stopped' }),
    ];
    const output = formatSessionTable(sessions);
    expect(output).toContain('s_1');
    expect(output).toContain('s_2');
  });

  it('should show summary footer with session count', () => {
    const sessions = [
      makeSession({ id: 's_1', status: 'building' }),
      makeSession({ id: 's_2', status: 'stopped' }),
    ];
    const output = formatSessionTable(sessions);
    expect(output).toContain('2 sessions');
  });
});
