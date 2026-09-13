/**
 * Subtask dependencies — PDD improvement I-02.
 *
 * A Production subtask that starts before material is in the Store is a fake
 * deadline. Dependencies make that impossible, and they mean the MD sees the
 * *root* delay instead of six red rows.
 *
 * Pure: graph shape in, answers out. The service loads the rows.
 */
import type { SubtaskStatus } from '@prisma/client';

/** One node: a subtask and the single subtask it waits for, if any. */
export interface DependencyNode {
  id: string;
  dependsOnId: string | null;
}

/**
 * Would setting `node.dependsOnId = candidate` create a cycle?
 *
 * Each subtask has at most one predecessor, so the graph is a forest of chains
 * and a cycle can only be formed by pointing at something already downstream of
 * you. Walking the chain forward from `candidate` and looking for `nodeId`
 * answers that in O(n) with no recursion.
 *
 * Also true when `candidate === nodeId`: a subtask waiting for itself is a
 * cycle of length one and would block forever.
 */
export function wouldCreateCycle(
  nodes: readonly DependencyNode[],
  nodeId: string,
  candidateDependencyId: string,
): boolean {
  if (candidateDependencyId === nodeId) return true;

  const dependencyOf = new Map(nodes.map((node) => [node.id, node.dependsOnId]));

  // Walk from the candidate up its own dependency chain. If we reach the node
  // whose dependency we are about to set, the edge would close a loop.
  const seen = new Set<string>();
  let current: string | null | undefined = candidateDependencyId;

  while (current) {
    if (current === nodeId) return true;

    // Defensive: an already-corrupt graph must not spin forever.
    if (seen.has(current)) return true;
    seen.add(current);

    current = dependencyOf.get(current) ?? null;
  }

  return false;
}

/**
 * Orders nodes so a subtask always appears after the one it depends on.
 *
 * Used by the review step and by publish, so that "complete Planning, then
 * Purchase" reads in the order the shop floor works. Nodes in a cycle — which
 * validation prevents, but a repaired database might still contain — are
 * appended at the end rather than dropped.
 */
export function topologicalOrder(nodes: readonly DependencyNode[]): DependencyNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const placed = new Set<string>();
  const ordered: DependencyNode[] = [];

  function place(node: DependencyNode, guard: Set<string>): void {
    if (placed.has(node.id) || guard.has(node.id)) return;
    guard.add(node.id);

    const parent = node.dependsOnId ? byId.get(node.dependsOnId) : undefined;
    if (parent) place(parent, guard);

    if (!placed.has(node.id)) {
      placed.add(node.id);
      ordered.push(node);
    }
  }

  for (const node of nodes) place(node, new Set());

  // Anything left (only reachable through a cycle) goes last.
  for (const node of nodes) {
    if (!placed.has(node.id)) ordered.push(node);
  }

  return ordered;
}

/** A subtask's dependency is satisfied when it is absent or completed. */
export const SATISFIED_DEPENDENCY_STATUSES: readonly SubtaskStatus[] = ['COMPLETED'];

export interface PublishNode extends DependencyNode {
  status: SubtaskStatus;
}

/**
 * The status each subtask takes at publish (build spec M4.3).
 *
 * Anything whose dependency is not completed becomes `BLOCKED`; everything else
 * becomes `PENDING`. Subtasks already in a terminal or command-set state are
 * left alone — publishing must not resurrect a cancelled task.
 */
export function initialStatusesOnPublish(
  nodes: readonly PublishNode[],
): Map<string, SubtaskStatus> {
  const statusById = new Map(nodes.map((node) => [node.id, node.status]));
  const result = new Map<string, SubtaskStatus>();

  for (const node of nodes) {
    if (node.status === 'COMPLETED' || node.status === 'CANCELLED' || node.status === 'ON_HOLD') {
      continue;
    }

    if (!node.dependsOnId) {
      result.set(node.id, 'PENDING');
      continue;
    }

    const dependencyStatus = statusById.get(node.dependsOnId);
    const satisfied =
      dependencyStatus !== undefined && SATISFIED_DEPENDENCY_STATUSES.includes(dependencyStatus);

    result.set(node.id, satisfied ? 'PENDING' : 'BLOCKED');
  }

  return result;
}

/**
 * Which `BLOCKED` subtasks become unblocked now that `completedId` is done
 * (SDD section 4.4).
 *
 * Returns only the ids that actually change, so the caller writes nothing when
 * nothing moved.
 */
export function dependentsToUnblock(nodes: readonly PublishNode[], completedId: string): string[] {
  return nodes
    .filter((node) => node.status === 'BLOCKED' && node.dependsOnId === completedId)
    .map((node) => node.id);
}
