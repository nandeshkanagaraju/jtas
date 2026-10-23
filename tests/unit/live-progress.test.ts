import { describe, expect, it } from 'vitest';
import { currentStageIds } from '@/lib/live-updates/progress';
describe('live department ownership', () => {
  const stages = [
    { id: 'planning', status: 'COMPLETED' },
    { id: 'purchase', status: 'IN_PROGRESS' },
    { id: 'production', status: 'PROBLEM' },
    { id: 'quality', status: 'BLOCKED' },
  ];
  it('shows parallel work and problems without inventing one current department', () =>
    expect([...currentStageIds(stages, 'IN_PROGRESS')]).toEqual(['purchase', 'production']));
  it.each(['DRAFT', 'COMPLETED', 'CANCELLED', 'ON_HOLD'])(
    'does not show active work on a %s job',
    (status) => expect(currentStageIds(stages, status).size).toBe(0),
  );
  it('shows ready work after a successful handoff', () =>
    expect([
      ...currentStageIds(
        [
          { id: 'planning', status: 'COMPLETED' },
          { id: 'purchase', status: 'PENDING' },
          { id: 'production', status: 'BLOCKED' },
        ],
        'IN_PROGRESS',
      ),
    ]).toEqual(['purchase']));
});
