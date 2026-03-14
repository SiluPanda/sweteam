import { listSessionsEnriched, type EnrichedSession } from '../session/manager.js';
import { relativeTime } from '../utils/time.js';
import { c, border, box, statusBadge, divider, rPad, vLen, vTrunc } from '../ui/theme.js';

export function formatStatus(session: EnrichedSession): string {
  const { status, planReady, messageCount, tasksDone, tasksTotal, prNumber } = session;

  switch (status) {
    case 'planning':
      if (messageCount <= 1) return c.info('planning (new)');
      if (planReady) return c.info('planning (plan ready)');
      return c.info(`planning (${messageCount} msgs)`);

    case 'building':
      if (tasksTotal > 0) return c.warning(`building (${tasksDone}/${tasksTotal})`);
      return c.warning('building');

    case 'awaiting_feedback':
      return prNumber ? c.success(`feedback (PR #${prNumber})`) : c.success('awaiting feedback');

    case 'iterating':
      if (tasksTotal > 0) return c.pink(`iterating (${tasksDone}/${tasksTotal})`);
      return c.pink('iterating');

    case 'stopped':
      return c.error('stopped');

    default:
      return c.muted(status);
  }
}

/** Truncate `s` to `max` visible chars and pad to exactly `max`. ANSI-aware. */
function fit(s: string, max: number): string {
  if (vLen(s) > max) return vTrunc(s, max - 1) + '…';
  return rPad(s, max);
}

/** Right-align `s` within `width` visible chars. */
function rAlign(s: string, width: number): string {
  const vis = vLen(s);
  if (vis >= width) return vTrunc(s, width);
  return ' '.repeat(width - vis) + s;
}

// Column widths
const COL = { id: 14, repo: 22, goal: 26, status: 22, updated: 10 } as const;

export function formatSessionTable(sessionList: EnrichedSession[]): string {
  if (sessionList.length === 0) {
    return 'No sessions found. Use `sweteam create [repo]` or `/create [repo]` to start one.';
  }

  // Inner width = sum of columns + gaps (1 space between each pair + 2 padding each side)
  const innerW = COL.id + COL.repo + COL.goal + COL.status + COL.updated + 4 + 4;

  const bdr = border.primary;

  const top = bdr(box.topLeft + box.horizontal.repeat(innerW) + box.topRight);
  const bot = bdr(box.bottomLeft + box.horizontal.repeat(innerW) + box.bottomRight);
  const mid = bdr(box.teeLeft + box.horizontal.repeat(innerW) + box.teeRight);

  const row = (content: string) =>
    bdr(box.vertical) + '  ' + rPad(content, innerW - 2) + bdr(box.vertical);

  // Title
  const titleLine = row(c.primaryBold('sweteam Sessions'));

  // Header
  const headerLine = row(
    [
      c.brightBold(fit('ID', COL.id)),
      c.brightBold(fit('Repo', COL.repo)),
      c.brightBold(fit('Goal', COL.goal)),
      c.brightBold(fit('Status', COL.status)),
      c.brightBold(rAlign('Updated', COL.updated)),
    ].join(' '),
  );

  // Separator
  const sepLine = row(divider(innerW - 4));

  // Data rows
  const dataRows = sessionList.map((s) => {
    return row(
      [
        c.cyan(fit(s.id, COL.id)),
        c.text(fit(s.repo, COL.repo)),
        c.dim(fit(s.goal, COL.goal)),
        fit(statusBadge(s.status), COL.status),
        c.muted(rAlign(relativeTime(s.updatedAt), COL.updated)),
      ].join(' '),
    );
  });

  // Summary footer
  const statusCounts: Record<string, number> = {};
  for (const s of sessionList) {
    statusCounts[s.status] = (statusCounts[s.status] || 0) + 1;
  }
  const breakdown = Object.entries(statusCounts)
    .map(([status, count]) => `${count} ${status}`)
    .join(` ${c.muted('·')} `);
  const footerLine = row(c.muted(`${sessionList.length} sessions`) + '  ' + c.muted(breakdown));

  return [top, titleLine, mid, headerLine, sepLine, ...dataRows, mid, footerLine, bot].join('\n');
}

export async function handleList(filters?: { status?: string; repo?: string }): Promise<void> {
  let sessionList = listSessionsEnriched();

  if (filters?.status) {
    sessionList = sessionList.filter((s) => s.status === filters.status);
  }
  if (filters?.repo) {
    const repoFilter = filters.repo.toLowerCase();
    sessionList = sessionList.filter((s) => s.repo.toLowerCase().includes(repoFilter));
  }

  console.log(formatSessionTable(sessionList));
}
