import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CustomAdapter } from '../adapters/custom.js';
import type { AgentAdapter } from '../adapters/adapter.js';

describe('image support — adapter interface', () => {
  it('AgentAdapter interface should accept optional images', async () => {
    const adapter: AgentAdapter = {
      name: 'test-adapter',
      async isAvailable() {
        return true;
      },
      async execute(opts) {
        return {
          output: `images: ${opts.images?.length ?? 0}`,
          exitCode: 0,
          durationMs: 0,
        };
      },
    };

    const result = await adapter.execute({
      prompt: 'test',
      cwd: '/tmp',
      images: ['/path/to/image.png'],
    });
    expect(result.output).toBe('images: 1');
  });

  it('should work without images (backward compatible)', async () => {
    const adapter: AgentAdapter = {
      name: 'test-adapter',
      async isAvailable() {
        return true;
      },
      async execute(opts) {
        return {
          output: `images: ${opts.images?.length ?? 0}`,
          exitCode: 0,
          durationMs: 0,
        };
      },
    };

    const result = await adapter.execute({
      prompt: 'test',
      cwd: '/tmp',
    });
    expect(result.output).toBe('images: 0');
  });
});

describe('image support — CustomAdapter', () => {
  it('should pass image paths as --image args', async () => {
    // Use 'echo' to capture the args passed to the command
    const adapter = new CustomAdapter('echo-agent', {
      command: 'echo',
      prompt_via: 'arg',
      output_from: 'stdout',
    });

    const result = await adapter.execute({
      prompt: 'describe this',
      cwd: '/tmp',
      timeout: 5000,
      images: ['/path/to/screenshot.png', '/path/to/mockup.jpg'],
    });

    // echo will print all args: --image /path/to/screenshot.png --image /path/to/mockup.jpg describe this
    const output = result.output.trim();
    expect(output).toContain('--image');
    expect(output).toContain('/path/to/screenshot.png');
    expect(output).toContain('/path/to/mockup.jpg');
    expect(output).toContain('describe this');
  });

  it('should not add --image args when images is empty', async () => {
    const adapter = new CustomAdapter('echo-agent', {
      command: 'echo',
      prompt_via: 'arg',
      output_from: 'stdout',
    });

    const result = await adapter.execute({
      prompt: 'no images',
      cwd: '/tmp',
      timeout: 5000,
      images: [],
    });

    expect(result.output.trim()).toBe('no images');
  });

  it('should not add --image args when images is undefined', async () => {
    const adapter = new CustomAdapter('echo-agent', {
      command: 'echo',
      prompt_via: 'arg',
      output_from: 'stdout',
    });

    const result = await adapter.execute({
      prompt: 'no images',
      cwd: '/tmp',
      timeout: 5000,
    });

    expect(result.output.trim()).toBe('no images');
  });
});

describe('image support — session handlers', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('should dispatch @image command to handler', async () => {
    // Mock fs.existsSync to accept test paths
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<typeof import('fs')>('fs');
      return {
        ...actual,
        existsSync: (p: string) => (p.startsWith('/tmp/') ? true : actual.existsSync(p)),
      };
    });

    // Mock dependencies
    vi.doMock('../db/client.js', () => ({
      getDb: () => ({
        select: () => ({
          from: () => ({
            where: () => ({
              all: () => [
                {
                  id: 's_img',
                  repo: 'owner/repo',
                  goal: 'test',
                  status: 'planning',
                  planJson: null,
                  repoLocalPath: '/tmp',
                  workingBranch: 'sw/s_img',
                },
              ],
            }),
          }),
        }),
        update: () => ({
          set: () => ({
            where: () => ({
              run: () => {},
            }),
          }),
        }),
        insert: () => ({
          values: () => ({
            run: () => {},
          }),
        }),
      }),
    }));

    vi.doMock('../session/manager.js', () => ({
      getSession: () => ({
        id: 's_img',
        repo: 'owner/repo',
        goal: 'test',
        status: 'planning',
        planJson: null,
        repoLocalPath: '/tmp',
        workingBranch: 'sw/s_img',
      }),
      addMessage: vi.fn(),
      getMessages: () => [],
    }));

    vi.doMock('../session/state-machine.js', () => ({
      transition: vi.fn(),
    }));

    vi.doMock('../session/agent-log.js', () => ({
      clearLog: vi.fn(),
      writeEvent: vi.fn(),
    }));

    vi.doMock('../lifecycle.js', () => ({
      killSessionProcesses: vi.fn(),
    }));

    const { createSessionHandlers } = await import('../session/interactive.js');

    const handlers = createSessionHandlers('s_img', 'owner/repo', 'test', '/tmp');

    // Add images (paths must be under repoPath /tmp)
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    handlers.onImage(['/tmp/img1.png', '/tmp/img2.jpg']);
    expect(consoleSpy).toHaveBeenCalledWith('2 image(s) attached to session.');

    // List images
    consoleSpy.mockClear();
    handlers.onImagesList();
    expect(consoleSpy).toHaveBeenCalledWith('2 image(s) attached:');

    // Clear images
    consoleSpy.mockClear();
    handlers.onImagesClear();
    expect(consoleSpy).toHaveBeenCalledWith('Cleared 2 image(s) from session.');

    // Verify empty after clear
    consoleSpy.mockClear();
    handlers.onImagesList();
    expect(consoleSpy).toHaveBeenCalledWith('No images attached. Use @image <path> to add images.');

    consoleSpy.mockRestore();
  });

  it('should handle @image via handleSessionCommand', async () => {
    // Mock fs.existsSync to accept test paths
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<typeof import('fs')>('fs');
      return {
        ...actual,
        existsSync: (p: string) => (p.startsWith('/tmp/') ? true : actual.existsSync(p)),
      };
    });

    vi.doMock('../db/client.js', () => ({
      getDb: () => ({
        select: () => ({
          from: () => ({
            where: () => ({
              all: () => [
                {
                  id: 's_cmd',
                  status: 'planning',
                  planJson: null,
                },
              ],
            }),
          }),
        }),
        update: () => ({
          set: () => ({
            where: () => ({
              run: () => {},
            }),
          }),
        }),
        insert: () => ({
          values: () => ({
            run: () => {},
          }),
        }),
      }),
    }));

    vi.doMock('../session/manager.js', () => ({
      getSession: () => ({
        id: 's_cmd',
        status: 'planning',
        planJson: null,
      }),
      addMessage: vi.fn(),
      getMessages: () => [],
    }));

    vi.doMock('../session/state-machine.js', () => ({
      transition: vi.fn(),
    }));

    vi.doMock('../session/agent-log.js', () => ({
      clearLog: vi.fn(),
      writeEvent: vi.fn(),
    }));

    vi.doMock('../lifecycle.js', () => ({
      killSessionProcesses: vi.fn(),
    }));

    const { handleSessionCommand, createSessionHandlers } =
      await import('../session/interactive.js');

    const handlers = createSessionHandlers('s_cmd', 'owner/repo', 'test', '/tmp');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Test @image command dispatch (path must be under repoPath /tmp)
    await handleSessionCommand('@image /tmp/file.png', handlers);
    expect(consoleSpy).toHaveBeenCalledWith('1 image(s) attached to session.');

    // Test @images list dispatch
    consoleSpy.mockClear();
    await handleSessionCommand('@images', handlers);
    expect(consoleSpy).toHaveBeenCalledWith('1 image(s) attached:');

    // Test @images clear dispatch
    consoleSpy.mockClear();
    await handleSessionCommand('@images clear', handlers);
    expect(consoleSpy).toHaveBeenCalledWith('Cleared 1 image(s) from session.');

    consoleSpy.mockRestore();
  });

  it('should deduplicate image paths', async () => {
    // Mock fs.existsSync to accept test paths
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<typeof import('fs')>('fs');
      return {
        ...actual,
        existsSync: (p: string) => (p.startsWith('/tmp/') ? true : actual.existsSync(p)),
      };
    });

    vi.doMock('../db/client.js', () => ({
      getDb: () => ({
        select: () => ({
          from: () => ({
            where: () => ({
              all: () => [],
            }),
          }),
        }),
        update: () => ({
          set: () => ({
            where: () => ({
              run: () => {},
            }),
          }),
        }),
        insert: () => ({
          values: () => ({
            run: () => {},
          }),
        }),
      }),
    }));

    vi.doMock('../session/manager.js', () => ({
      getSession: () => ({
        id: 's_dedup',
        status: 'planning',
        planJson: null,
      }),
      addMessage: vi.fn(),
      getMessages: () => [],
    }));

    vi.doMock('../session/state-machine.js', () => ({
      transition: vi.fn(),
    }));

    vi.doMock('../session/agent-log.js', () => ({
      clearLog: vi.fn(),
      writeEvent: vi.fn(),
    }));

    vi.doMock('../lifecycle.js', () => ({
      killSessionProcesses: vi.fn(),
    }));

    const { createSessionHandlers } = await import('../session/interactive.js');
    const handlers = createSessionHandlers('s_dedup', 'owner/repo', 'test', '/tmp');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    handlers.onImage(['/tmp/img.png']);
    expect(consoleSpy).toHaveBeenCalledWith('1 image(s) attached to session.');

    consoleSpy.mockClear();
    handlers.onImage(['/tmp/img.png']); // duplicate
    expect(consoleSpy).toHaveBeenCalledWith('1 image(s) attached to session.');

    consoleSpy.mockClear();
    handlers.onImage(['/tmp/other.png']);
    expect(consoleSpy).toHaveBeenCalledWith('2 image(s) attached to session.');

    consoleSpy.mockRestore();
  });
});
