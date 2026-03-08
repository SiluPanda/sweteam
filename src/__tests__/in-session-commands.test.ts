import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getDb, closeDb } from '../db/client.js';
import { sessions, tasks as tasksTable } from '../db/schema.js';
import {
  getStatusDisplay,
  getPlanDisplay,
  getPrDisplay,
  getTasksDisplay,
  getHelpDisplay,
} from '../session/in-session-commands.js';

describe('in-session-commands', () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'sweteam-isc-test-'));
    tempDirs.push(dir);
    const db = getDb(join(dir, 'test.db'));

    db.insert(sessions)
      .values({
        id: 's_cmd',
        repo: 'owner/repo',
        goal: 'Add feature',
        status: 'building',
        planJson: JSON.stringify({
          tasks: [
            { id: 't-1', title: 'First task', description: 'Do first' },
            { id: 't-2', title: 'Second task', description: 'Do second' },
          ],
        }),
        prUrl: 'https://github.com/owner/repo/pull/42',
        prNumber: 42,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();

    const now = new Date();
    db.insert(tasksTable)
      .values([
        {
          id: 't-1',
          sessionId: 's_cmd',
          title: 'First task',
          description: 'D1',
          status: 'done',
          reviewVerdict: 'approve',
          reviewCycles: 1,
          order: 1,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 't-2',
          sessionId: 's_cmd',
          title: 'Second task',
          description: 'D2',
          status: 'running',
          order: 2,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 't-3',
          sessionId: 's_cmd',
          title: 'Third task',
          description: 'D3',
          status: 'queued',
          order: 3,
          createdAt: now,
          updatedAt: now,
        },
      ])
      .run();
  });

  afterEach(() => {
    closeDb();
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  describe('@status', () => {
    it('should show task statuses with icons', () => {
      const output = getStatusDisplay('s_cmd');
      expect(output).toContain('✓ t-1');
      expect(output).toContain('▶ t-2');
      expect(output).toContain('○ t-3');
    });

    it('should show progress bar', () => {
      const output = getStatusDisplay('s_cmd');
      expect(output).toContain('Progress:');
      expect(output).toContain('1/3');
    });

    it('should count reviewing and fixing tasks as Running', () => {
      const db = getDb();
      const now = new Date();

      db.insert(sessions)
        .values({
          id: 's_review',
          repo: 'owner/repo',
          goal: 'Test review states',
          status: 'building',
          createdAt: now,
          updatedAt: now,
        })
        .run();

      db.insert(tasksTable)
        .values([
          {
            id: 't-r1',
            sessionId: 's_review',
            title: 'Task running',
            description: 'D',
            status: 'running',
            order: 1,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 't-r2',
            sessionId: 's_review',
            title: 'Task reviewing',
            description: 'D',
            status: 'reviewing',
            order: 2,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 't-r3',
            sessionId: 's_review',
            title: 'Task fixing',
            description: 'D',
            status: 'fixing',
            order: 3,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 't-r4',
            sessionId: 's_review',
            title: 'Task done',
            description: 'D',
            status: 'done',
            order: 4,
            createdAt: now,
            updatedAt: now,
          },
        ])
        .run();

      const output = getStatusDisplay('s_review');
      // All three active states (running, reviewing, fixing) count as Running
      expect(output).toContain('Running: 3');
      expect(output).toContain('Done: 1');
      expect(output).toContain('1/4');
      // Individual task lines still show exact status
      expect(output).toContain('[running]');
      expect(output).toContain('[reviewing]');
      expect(output).toContain('[fixing]');
    });

    it('should show empty message when no tasks', () => {
      const output = getStatusDisplay('nonexistent');
      expect(output).toContain('No tasks yet');
    });
  });

  describe('@plan', () => {
    it('should display plan tasks', () => {
      const output = getPlanDisplay('s_cmd');
      expect(output).toContain('First task');
      expect(output).toContain('Second task');
    });

    it('should show message when no plan', () => {
      const db = getDb();
      db.insert(sessions)
        .values({
          id: 's_noplan',
          repo: 'r',
          goal: 'g',
          status: 'planning',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .run();

      const output = getPlanDisplay('s_noplan');
      expect(output).toContain('No plan finalized');
    });
  });

  describe('@pr', () => {
    it('should display PR URL and number', () => {
      const output = getPrDisplay('s_cmd');
      expect(output).toContain('PR #42');
      expect(output).toContain('https://github.com/owner/repo/pull/42');
    });

    it('should show message when no PR', () => {
      const db = getDb();
      db.insert(sessions)
        .values({
          id: 's_nopr',
          repo: 'r',
          goal: 'g',
          status: 'planning',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .run();

      const output = getPrDisplay('s_nopr');
      expect(output).toContain('No PR created');
    });
  });

  describe('@tasks', () => {
    it('should list all tasks with review info', () => {
      const output = getTasksDisplay('s_cmd');
      expect(output).toContain('t-1: First task [done] (review: approve, cycles: 1)');
      expect(output).toContain('t-2: Second task [running]');
    });

    it('should show message when no tasks', () => {
      const output = getTasksDisplay('nonexistent');
      expect(output).toContain('No tasks defined');
    });
  });

  describe('@help', () => {
    it('should list all commands', () => {
      const output = getHelpDisplay();
      expect(output).toContain('@build');
      expect(output).toContain('@status');
      expect(output).toContain('@plan');
      expect(output).toContain('@feedback');
      expect(output).toContain('@diff');
      expect(output).toContain('@pr');
      expect(output).toContain('@tasks');
      expect(output).toContain('@stop');
      expect(output).toContain('@help');
    });

    it('should show @feedback as applicable during planning', () => {
      const db = getDb();
      db.insert(sessions)
        .values({
          id: 's_planning_help',
          repo: 'r',
          goal: 'g',
          status: 'planning',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .run();

      const output = getHelpDisplay('s_planning_help');
      expect(output).toContain('@feedback');
      expect(output).not.toMatch(/@feedback.*not applicable/);
    });

    it('should show @feedback as not applicable during stopped', () => {
      const db = getDb();
      db.insert(sessions)
        .values({
          id: 's_stopped_help',
          repo: 'r',
          goal: 'g',
          status: 'stopped',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .run();

      const output = getHelpDisplay('s_stopped_help');
      expect(output).toMatch(/@feedback.*not applicable/);
    });
  });
});
