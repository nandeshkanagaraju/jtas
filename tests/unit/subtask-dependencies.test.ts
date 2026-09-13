import type { SubtaskStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  dependentsToUnblock,
  initialStatusesOnPublish,
  topologicalOrder,
  wouldCreateCycle,
  type DependencyNode,
  type PublishNode,
} from '@/lib/domain/subtask-dependencies';

/** The seeded CNC chain: Planning → Purchase → Store → Production, HR parallel. */
const CHAIN: DependencyNode[] = [
  { id: 'planning', dependsOnId: null },
  { id: 'purchase', dependsOnId: 'planning' },
  { id: 'store', dependsOnId: 'purchase' },
  { id: 'production', dependsOnId: 'store' },
  { id: 'hr', dependsOnId: null },
];

function node(id: string, status: SubtaskStatus, dependsOnId: string | null = null): PublishNode {
  return { id, status, dependsOnId };
}

describe('wouldCreateCycle', () => {
  it('rejects a subtask depending on itself', () => {
    expect(wouldCreateCycle(CHAIN, 'planning', 'planning')).toBe(true);
  });

  it('rejects pointing at anything downstream', () => {
    // Planning already leads to Production; making Planning wait for Production
    // would close the loop and block the whole chain forever.
    expect(wouldCreateCycle(CHAIN, 'planning', 'production')).toBe(true);
    expect(wouldCreateCycle(CHAIN, 'planning', 'purchase')).toBe(true);
    expect(wouldCreateCycle(CHAIN, 'purchase', 'store')).toBe(true);
  });

  it('allows pointing at anything upstream or unrelated', () => {
    expect(wouldCreateCycle(CHAIN, 'production', 'planning')).toBe(false);
    expect(wouldCreateCycle(CHAIN, 'hr', 'production')).toBe(false);
    expect(wouldCreateCycle(CHAIN, 'production', 'hr')).toBe(false);
  });

  it('allows a first dependency on a node with none', () => {
    expect(wouldCreateCycle(CHAIN, 'hr', 'planning')).toBe(false);
  });

  it('detects a two-node loop', () => {
    const pair: DependencyNode[] = [
      { id: 'a', dependsOnId: 'b' },
      { id: 'b', dependsOnId: null },
    ];
    expect(wouldCreateCycle(pair, 'b', 'a')).toBe(true);
  });

  it('terminates on an already-corrupt graph rather than spinning', () => {
    const corrupt: DependencyNode[] = [
      { id: 'a', dependsOnId: 'b' },
      { id: 'b', dependsOnId: 'a' },
      { id: 'c', dependsOnId: null },
    ];
    expect(wouldCreateCycle(corrupt, 'c', 'a')).toBe(true);
  });

  it('handles a long chain', () => {
    const long: DependencyNode[] = Array.from({ length: 200 }, (_, i) => ({
      id: `n${i}`,
      dependsOnId: i === 0 ? null : `n${i - 1}`,
    }));
    expect(wouldCreateCycle(long, 'n0', 'n199')).toBe(true);
    expect(wouldCreateCycle(long, 'n199', 'n0')).toBe(false);
  });
});

describe('topologicalOrder', () => {
  it('puts every subtask after the one it depends on', () => {
    const order = topologicalOrder([...CHAIN].reverse()).map((n) => n.id);

    expect(order.indexOf('planning')).toBeLessThan(order.indexOf('purchase'));
    expect(order.indexOf('purchase')).toBeLessThan(order.indexOf('store'));
    expect(order.indexOf('store')).toBeLessThan(order.indexOf('production'));
    expect(order).toHaveLength(5);
  });

  it('keeps parallel branches, in input order', () => {
    expect(topologicalOrder(CHAIN).map((n) => n.id)).toEqual([
      'planning',
      'purchase',
      'store',
      'production',
      'hr',
    ]);
  });

  it('appends cyclic nodes rather than dropping them', () => {
    const corrupt: DependencyNode[] = [
      { id: 'a', dependsOnId: 'b' },
      { id: 'b', dependsOnId: 'a' },
      { id: 'c', dependsOnId: null },
    ];
    expect(topologicalOrder(corrupt)).toHaveLength(3);
  });

  it('is stable for an empty list', () => {
    expect(topologicalOrder([])).toEqual([]);
  });
});

describe('initialStatusesOnPublish', () => {
  it('sets PENDING with no dependency and BLOCKED with an unfinished one', () => {
    const nodes: PublishNode[] = [
      node('planning', 'PENDING'),
      node('purchase', 'PENDING', 'planning'),
      node('hr', 'PENDING'),
    ];

    const result = initialStatusesOnPublish(nodes);

    expect(result.get('planning')).toBe('PENDING');
    expect(result.get('purchase')).toBe('BLOCKED');
    expect(result.get('hr')).toBe('PENDING');
  });

  it('blocks a whole chain behind its first step', () => {
    const nodes: PublishNode[] = [
      node('planning', 'PENDING'),
      node('purchase', 'PENDING', 'planning'),
      node('store', 'PENDING', 'purchase'),
      node('production', 'PENDING', 'store'),
    ];

    const result = initialStatusesOnPublish(nodes);

    expect(result.get('planning')).toBe('PENDING');
    for (const id of ['purchase', 'store', 'production']) {
      expect(result.get(id), id).toBe('BLOCKED');
    }
  });

  it('leaves a subtask PENDING when its dependency is already completed', () => {
    const nodes: PublishNode[] = [
      node('planning', 'COMPLETED'),
      node('purchase', 'PENDING', 'planning'),
    ];
    expect(initialStatusesOnPublish(nodes).get('purchase')).toBe('PENDING');
  });

  it('does not resurrect a completed, cancelled or held subtask', () => {
    const nodes: PublishNode[] = [
      node('done', 'COMPLETED'),
      node('dropped', 'CANCELLED'),
      node('paused', 'ON_HOLD'),
    ];

    const result = initialStatusesOnPublish(nodes);
    expect(result.has('done')).toBe(false);
    expect(result.has('dropped')).toBe(false);
    expect(result.has('paused')).toBe(false);
  });

  it('blocks on a dependency that is merely in progress, not completed', () => {
    const nodes: PublishNode[] = [
      node('planning', 'IN_PROGRESS'),
      node('purchase', 'PENDING', 'planning'),
    ];
    expect(initialStatusesOnPublish(nodes).get('purchase')).toBe('BLOCKED');
  });
});

describe('dependentsToUnblock', () => {
  it('returns the blocked subtasks waiting on the one just completed', () => {
    const nodes: PublishNode[] = [
      node('planning', 'COMPLETED'),
      node('purchase', 'BLOCKED', 'planning'),
      node('store', 'BLOCKED', 'purchase'),
    ];

    // Only the immediate dependent moves — Store still waits for Purchase.
    expect(dependentsToUnblock(nodes, 'planning')).toEqual(['purchase']);
  });

  it('ignores dependents that are not blocked', () => {
    const nodes: PublishNode[] = [
      node('planning', 'COMPLETED'),
      node('purchase', 'IN_PROGRESS', 'planning'),
    ];
    expect(dependentsToUnblock(nodes, 'planning')).toEqual([]);
  });

  it('returns every blocked dependent when several wait on one subtask', () => {
    const nodes: PublishNode[] = [
      node('planning', 'COMPLETED'),
      node('purchase', 'BLOCKED', 'planning'),
      node('hr', 'BLOCKED', 'planning'),
    ];
    expect(dependentsToUnblock(nodes, 'planning').sort()).toEqual(['hr', 'purchase']);
  });

  it('returns nothing when there are no dependents', () => {
    expect(dependentsToUnblock([node('a', 'COMPLETED')], 'a')).toEqual([]);
  });
});
