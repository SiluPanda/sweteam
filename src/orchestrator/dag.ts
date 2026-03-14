import type { TaskRecord } from './task-runner.js';

export interface DagNode {
  id: string;
  dependsOn: string[];
  dependents: string[];
}

/** Safely parse a JSON string, returning `fallback` on failure. */
export function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
  if (json == null) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    console.log(`[warn] Failed to parse JSON, using fallback: ${json.slice(0, 200)}`);
    return fallback;
  }
}

export function buildDag(tasks: TaskRecord[]): Map<string, DagNode> {
  const dag = new Map<string, DagNode>();

  for (const task of tasks) {
    dag.set(task.id, {
      id: task.id,
      dependsOn: safeJsonParse<string[]>(task.dependsOn, []),
      dependents: [],
    });
  }

  // Build reverse edges (dependents)
  for (const [, node] of dag) {
    for (const depId of node.dependsOn) {
      const depNode = dag.get(depId);
      if (depNode) {
        depNode.dependents.push(node.id);
      } else {
        console.log(`[warn] Task ${node.id} depends on non-existent task ${depId} — ignoring phantom dependency`);
      }
    }
  }

  return dag;
}

export function topologicalSort(dag: Map<string, DagNode>): string[] {
  const sorted: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(id: string): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw new Error(`Circular dependency detected involving task: ${id}`);
    }

    const node = dag.get(id);
    if (!node) {
      // Phantom dependency — skip it, don't add to sorted
      return;
    }

    visiting.add(id);
    for (const depId of node.dependsOn) {
      if (!dag.has(depId)) {
        console.log(`[warn] topologicalSort: skipping phantom dependency ${depId} referenced by task ${id}`);
        continue;
      }
      visit(depId);
    }
    visiting.delete(id);
    visited.add(id);
    sorted.push(id);
  }

  for (const [id] of dag) {
    visit(id);
  }

  return sorted;
}

export function getReadyTasks(
  dag: Map<string, DagNode>,
  completedIds: Set<string>,
  runningIds: Set<string>,
  failedIds: Set<string>,
  blockedIds: Set<string>,
): string[] {
  const ready: string[] = [];

  for (const [id, node] of dag) {
    if (completedIds.has(id)) continue;
    if (runningIds.has(id)) continue;
    if (failedIds.has(id)) continue;
    if (blockedIds.has(id)) continue;

    // Filter out phantom deps (references to non-existent tasks)
    const validDeps = node.dependsOn.filter((depId) => dag.has(depId));
    const allDepsMet = validDeps.every((depId) => completedIds.has(depId));
    const anyDepFailed = validDeps.some(
      (depId) => failedIds.has(depId) || blockedIds.has(depId),
    );

    if (anyDepFailed) {
      blockedIds.add(id);
      continue;
    }

    if (allDepsMet) {
      ready.push(id);
    }
  }

  return ready;
}
