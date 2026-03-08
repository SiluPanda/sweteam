import { describe, it, expect } from 'vitest';
import { SessionSidebar } from '../ui/sidebar.js';

describe('ui/sidebar — SessionSidebar label', () => {
  const sidebar = new SessionSidebar();
  const label = (
    sidebar as unknown as Record<string, (s: string, a: boolean) => string>
  ).label.bind(sidebar);

  it('should show "building" not "build paused" when log is inactive', () => {
    const text = label('building', false);
    expect(text).toContain('building');
    expect(text).not.toContain('paused');
  });

  it('should show "building…" when log is active', () => {
    const text = label('building', true);
    expect(text).toContain('building');
  });

  it('should show correct labels for all statuses', () => {
    expect(label('planning', true)).toContain('planning');
    expect(label('iterating', false)).toContain('iterating');
    expect(label('awaiting_feedback', false)).toContain('needs feedback');
    expect(label('stopped', false)).toContain('stopped');
  });
});
