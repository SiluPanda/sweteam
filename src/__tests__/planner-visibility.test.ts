import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getDb, closeDb } from '../db/client.js';
import { sessions } from '../db/schema.js';
import { eq } from 'drizzle-orm';

describe('planner visibility — @status during planning', () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'sweteam-pv-test-'));
    tempDirs.push(dir);
    const db = getDb(join(dir, 'test.db'));

    db.insert(sessions)
      .values({
        id: 's_pv',
        repo: 'owner/repo',
        repoLocalPath: '/tmp/fake-repo',
        goal: 'Implement HNSW algorithm',
        status: 'planning',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
  });

  afterEach(() => {
    closeDb();
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
    vi.restoreAllMocks();
  });

  it('should show planner running state in @status when planner is active', async () => {
    // Mock the planner so it doesn't actually spawn a process — make it hang
    const plannerMod = await import('../planner/planner.js');
    let resolvePlanner!: (value: string) => void;
    vi.spyOn(plannerMod, 'invokePlanner').mockImplementation(() => {
      return new Promise((resolve) => {
        resolvePlanner = resolve;
      });
    });

    // Mock agent-log to prevent file I/O
    const agentLogMod = await import('../session/agent-log.js');
    vi.spyOn(agentLogMod, 'clearLog').mockImplementation(() => {});
    vi.spyOn(agentLogMod, 'writeEvent').mockImplementation(() => {});

    // Mock lifecycle — no active processes tracked in test
    const lifecycleMod = await import('../lifecycle.js');
    vi.spyOn(lifecycleMod, 'hasActiveProcesses').mockReturnValue(true);

    const { createSessionHandlers, getPlannerState } = await import('../session/interactive.js');
    const { getStatusDisplay } = await import('../session/in-session-commands.js');

    const handlers = createSessionHandlers(
      's_pv',
      'owner/repo',
      'Implement HNSW algorithm',
      '/tmp/fake-repo',
    );

    // Before planning — state should be inactive
    const stateBefore = getPlannerState('s_pv');
    expect(stateBefore).toBeDefined();
    expect(stateBefore!.inProgress).toBe(false);

    // Start planning
    await handlers.onMessage('implement hnsw algorithm');

    // Planner state should now be active
    const stateActive = getPlannerState('s_pv');
    expect(stateActive!.inProgress).toBe(true);
    expect(stateActive!.startedAt).toBeTypeOf('number');
    expect(stateActive!.lastActivityAt).toBeTypeOf('number');

    // @status should show planner running info
    const status = getStatusDisplay('s_pv');
    expect(status).toContain('Planner: running for');
    expect(status).toContain('@cancel');

    // Resolve planner to clean up
    resolvePlanner('Plan response');
    // Wait for .finally() to run
    await new Promise((r) => setTimeout(r, 50));

    // After planning completes — state should be reset
    const stateAfter = getPlannerState('s_pv');
    expect(stateAfter!.inProgress).toBe(false);
  });

  it('should show stale warning when no output for >60s', async () => {
    const plannerMod = await import('../planner/planner.js');
    let resolvePlanner!: (value: string) => void;
    vi.spyOn(plannerMod, 'invokePlanner').mockImplementation(() => {
      return new Promise((resolve) => {
        resolvePlanner = resolve;
      });
    });

    const agentLogMod = await import('../session/agent-log.js');
    vi.spyOn(agentLogMod, 'clearLog').mockImplementation(() => {});
    vi.spyOn(agentLogMod, 'writeEvent').mockImplementation(() => {});

    const lifecycleMod = await import('../lifecycle.js');
    vi.spyOn(lifecycleMod, 'hasActiveProcesses').mockReturnValue(true);

    const { createSessionHandlers, getPlannerState } = await import('../session/interactive.js');
    const { getStatusDisplay } = await import('../session/in-session-commands.js');

    const handlers = createSessionHandlers(
      's_pv',
      'owner/repo',
      'Implement HNSW algorithm',
      '/tmp/fake-repo',
    );

    await handlers.onMessage('implement hnsw');

    // Simulate stale activity by backdating lastActivityAt
    const state = getPlannerState('s_pv');
    state!.lastActivityAt = Date.now() - 120_000; // 2 minutes ago

    const status = getStatusDisplay('s_pv');
    expect(status).toContain('⚠ No output for');
    expect(status).toContain('Process is alive');

    // Clean up
    resolvePlanner('done');
    await new Promise((r) => setTimeout(r, 50));
  });

  it('should show crash warning when process is dead and no output', async () => {
    const plannerMod = await import('../planner/planner.js');
    let resolvePlanner!: (value: string) => void;
    vi.spyOn(plannerMod, 'invokePlanner').mockImplementation(() => {
      return new Promise((resolve) => {
        resolvePlanner = resolve;
      });
    });

    const agentLogMod = await import('../session/agent-log.js');
    vi.spyOn(agentLogMod, 'clearLog').mockImplementation(() => {});
    vi.spyOn(agentLogMod, 'writeEvent').mockImplementation(() => {});

    // Process is dead
    const lifecycleMod = await import('../lifecycle.js');
    vi.spyOn(lifecycleMod, 'hasActiveProcesses').mockReturnValue(false);

    const { createSessionHandlers, getPlannerState } = await import('../session/interactive.js');
    const { getStatusDisplay } = await import('../session/in-session-commands.js');

    const handlers = createSessionHandlers(
      's_pv',
      'owner/repo',
      'Implement HNSW algorithm',
      '/tmp/fake-repo',
    );

    await handlers.onMessage('implement hnsw');

    // Simulate stale + dead process
    const state = getPlannerState('s_pv');
    state!.lastActivityAt = Date.now() - 120_000;

    const status = getStatusDisplay('s_pv');
    expect(status).toContain('⚠ No output for');
    expect(status).toContain('may have crashed');
    expect(status).toContain('@cancel');

    // Clean up
    resolvePlanner('done');
    await new Promise((r) => setTimeout(r, 50));
  });

  it('should show receiving output when activity is recent', async () => {
    const plannerMod = await import('../planner/planner.js');
    let resolvePlanner!: (value: string) => void;
    vi.spyOn(plannerMod, 'invokePlanner').mockImplementation(() => {
      return new Promise((resolve) => {
        resolvePlanner = resolve;
      });
    });

    const agentLogMod = await import('../session/agent-log.js');
    vi.spyOn(agentLogMod, 'clearLog').mockImplementation(() => {});
    vi.spyOn(agentLogMod, 'writeEvent').mockImplementation(() => {});

    const lifecycleMod = await import('../lifecycle.js');
    vi.spyOn(lifecycleMod, 'hasActiveProcesses').mockReturnValue(true);

    const { createSessionHandlers } = await import('../session/interactive.js');
    const { getStatusDisplay } = await import('../session/in-session-commands.js');

    const handlers = createSessionHandlers(
      's_pv',
      'owner/repo',
      'Implement HNSW algorithm',
      '/tmp/fake-repo',
    );

    await handlers.onMessage('implement hnsw');

    // lastActivityAt is recent (just set by onMessage)
    const status = getStatusDisplay('s_pv');
    expect(status).toContain('Receiving output...');
    expect(status).not.toContain('⚠');

    resolvePlanner('done');
    await new Promise((r) => setTimeout(r, 50));
  });

  it('should show normal status when planner is not running', async () => {
    const { getStatusDisplay } = await import('../session/in-session-commands.js');

    // No planner started — should show default message
    const status = getStatusDisplay('s_pv');
    expect(status).toContain('No plan yet');
    expect(status).not.toContain('Planner: running');
  });
});

describe('planner visibility — @cancel command', () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'sweteam-cancel-test-'));
    tempDirs.push(dir);
    const db = getDb(join(dir, 'test.db'));

    db.insert(sessions)
      .values({
        id: 's_cancel',
        repo: 'owner/repo',
        repoLocalPath: '/tmp/fake-repo',
        goal: 'Test cancel',
        status: 'planning',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
  });

  afterEach(() => {
    closeDb();
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
    vi.restoreAllMocks();
  });

  it('should cancel an active planner and reset state', async () => {
    const plannerMod = await import('../planner/planner.js');
    let resolvePlanner!: (value: string) => void;
    vi.spyOn(plannerMod, 'invokePlanner').mockImplementation(() => {
      return new Promise((resolve) => {
        resolvePlanner = resolve;
      });
    });

    const agentLogMod = await import('../session/agent-log.js');
    vi.spyOn(agentLogMod, 'clearLog').mockImplementation(() => {});
    vi.spyOn(agentLogMod, 'writeEvent').mockImplementation(() => {});

    const lifecycleMod = await import('../lifecycle.js');
    vi.spyOn(lifecycleMod, 'killSessionProcesses').mockImplementation(() => {});
    vi.spyOn(lifecycleMod, 'hasActiveProcesses').mockReturnValue(true);

    const { createSessionHandlers, getPlannerState } = await import('../session/interactive.js');

    const handlers = createSessionHandlers(
      's_cancel',
      'owner/repo',
      'Test cancel',
      '/tmp/fake-repo',
    );

    // Start planning
    await handlers.onMessage('build something');
    expect(getPlannerState('s_cancel')!.inProgress).toBe(true);

    // Cancel
    await handlers.onCancel();
    expect(getPlannerState('s_cancel')!.inProgress).toBe(false);
    expect(getPlannerState('s_cancel')!.startedAt).toBeNull();

    // Verify killSessionProcesses was called
    expect(lifecycleMod.killSessionProcesses).toHaveBeenCalledWith('s_cancel');

    // Verify session is still in planning (not stopped)
    const db = getDb();
    const rows = db
      .select({ status: sessions.status })
      .from(sessions)
      .where(eq(sessions.id, 's_cancel'))
      .all();
    expect(rows[0].status).toBe('planning');

    // Resolve to avoid dangling promise
    resolvePlanner('cancelled');
    await new Promise((r) => setTimeout(r, 50));
  });

  it('should show message when no planner is running', async () => {
    const lifecycleMod = await import('../lifecycle.js');
    vi.spyOn(lifecycleMod, 'killSessionProcesses').mockImplementation(() => {});

    const { createSessionHandlers } = await import('../session/interactive.js');

    const handlers = createSessionHandlers(
      's_cancel',
      'owner/repo',
      'Test cancel',
      '/tmp/fake-repo',
    );

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Cancel without starting planner
    await handlers.onCancel();

    expect(consoleSpy).toHaveBeenCalledWith('No planner running to cancel.');
    // killSessionProcesses should NOT have been called
    expect(lifecycleMod.killSessionProcesses).not.toHaveBeenCalled();
  });

  it('should allow sending new message after cancel', async () => {
    const plannerMod = await import('../planner/planner.js');
    let callCount = 0;
    vi.spyOn(plannerMod, 'invokePlanner').mockImplementation(() => {
      callCount++;
      return new Promise((resolve) => {
        // Auto-resolve to avoid cleanup issues
        setTimeout(() => resolve(`response ${callCount}`), 10);
      });
    });

    const agentLogMod = await import('../session/agent-log.js');
    vi.spyOn(agentLogMod, 'clearLog').mockImplementation(() => {});
    vi.spyOn(agentLogMod, 'writeEvent').mockImplementation(() => {});

    const lifecycleMod = await import('../lifecycle.js');
    vi.spyOn(lifecycleMod, 'killSessionProcesses').mockImplementation(() => {});
    vi.spyOn(lifecycleMod, 'hasActiveProcesses').mockReturnValue(true);

    const { createSessionHandlers, getPlannerState } = await import('../session/interactive.js');

    const handlers = createSessionHandlers(
      's_cancel',
      'owner/repo',
      'Test cancel',
      '/tmp/fake-repo',
    );

    // Start planning
    await handlers.onMessage('first attempt');
    expect(callCount).toBe(1);

    // Cancel
    await handlers.onCancel();
    expect(getPlannerState('s_cancel')!.inProgress).toBe(false);

    // Send new message — should work (not blocked by planningInProgress)
    await handlers.onMessage('second attempt');
    expect(callCount).toBe(2);

    // Wait for auto-resolve
    await new Promise((r) => setTimeout(r, 100));
  });
});

describe('planner visibility — @cancel in handleSessionCommand', () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'sweteam-cmd-test-'));
    tempDirs.push(dir);
    const db = getDb(join(dir, 'test.db'));

    db.insert(sessions)
      .values({
        id: 's_cmdtest',
        repo: 'owner/repo',
        repoLocalPath: '/tmp/fake-repo',
        goal: 'Test command routing',
        status: 'planning',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
  });

  afterEach(() => {
    closeDb();
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
    vi.restoreAllMocks();
  });

  it('should route @cancel to onCancel handler', async () => {
    const { handleSessionCommand, createSessionHandlers } =
      await import('../session/interactive.js');

    const handlers = createSessionHandlers('s_cmdtest', 'owner/repo', 'Test', '/tmp/fake-repo');

    const cancelSpy = vi.spyOn(handlers, 'onCancel').mockResolvedValue();

    const stopped = await handleSessionCommand('@cancel', handlers);
    expect(stopped).toBe(false); // @cancel does not stop the session
    expect(cancelSpy).toHaveBeenCalled();
  });
});

describe('planner visibility — @help includes @cancel', () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'sweteam-help-test-'));
    tempDirs.push(dir);
    const db = getDb(join(dir, 'test.db'));

    db.insert(sessions)
      .values({
        id: 's_helptest',
        repo: 'owner/repo',
        goal: 'Test help',
        status: 'planning',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
  });

  afterEach(() => {
    closeDb();
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('should list @cancel in help during planning', async () => {
    const { getHelpDisplay } = await import('../session/in-session-commands.js');
    const output = getHelpDisplay('s_helptest');
    expect(output).toContain('@cancel');
    expect(output).not.toMatch(/@cancel.*not applicable/);
  });

  it('should mark @cancel as not applicable during building', async () => {
    const db = getDb();
    db.insert(sessions)
      .values({
        id: 's_building_help',
        repo: 'r',
        goal: 'g',
        status: 'building',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();

    const { getHelpDisplay } = await import('../session/in-session-commands.js');
    const output = getHelpDisplay('s_building_help');
    expect(output).toMatch(/@cancel.*not applicable/);
  });
});

describe('planner visibility — hasActiveProcesses', () => {
  it('should return false when no processes tracked', async () => {
    const { hasActiveProcesses } = await import('../lifecycle.js');
    // No processes tracked for a random session
    expect(hasActiveProcesses('nonexistent')).toBe(false);
  });
});

describe('planner visibility — 20min safety-net timeout', () => {
  it('should pass 20-minute timeout to adapter', async () => {
    const plannerMod = await import('../planner/planner.js');
    const configMod = await import('../config/loader.js');

    // Mock config
    vi.spyOn(configMod, 'loadConfig').mockReturnValue({
      roles: { planner: 'claude-code', coder: 'claude-code', reviewer: 'claude-code' },
      execution: { max_parallel: 3, max_review_cycles: 3, branch_prefix: 'sw/' },
      git: { commit_style: 'conventional', squash_on_merge: true },
      agents: {},
    } as ReturnType<typeof configMod.loadConfig>);

    // Mock adapter
    const adapterMod = await import('../adapters/adapter.js');
    const mockExecute = vi.fn().mockResolvedValue({ output: 'plan', exitCode: 0, durationMs: 100 });
    vi.spyOn(adapterMod, 'resolveAdapter').mockReturnValue({
      name: 'mock',
      isAvailable: async () => true,
      execute: mockExecute,
    });

    // Mock session manager
    const managerMod = await import('../session/manager.js');
    vi.spyOn(managerMod, 'getMessages').mockReturnValue([]);

    await plannerMod.invokePlanner('s_test', 'owner/repo', 'goal', '/tmp');

    // Verify the adapter was called with 20-minute timeout
    expect(mockExecute).toHaveBeenCalled();
    const callOpts = mockExecute.mock.calls[0][0];
    expect(callOpts.timeout).toBe(20 * 60 * 1000);
  });
});
