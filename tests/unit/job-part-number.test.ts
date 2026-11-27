import { describe, expect, it } from 'vitest';

import { createJobRequestSchema } from '@/lib/validation/job';

const base = {
  title: 'Cam batch',
  overallDeadline: '2026-12-31T18:00',
  pointOfContactId: 'user-1',
};

describe('new job part number', () => {
  it('is required, because stock is matched by it', () => {
    for (const partNumber of [undefined, '', '   ']) {
      const result = createJobRequestSchema.safeParse({ ...base, partNumber });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['partNumber']);
    }
  });

  it('is trimmed when given', () => {
    const result = createJobRequestSchema.safeParse({ ...base, partNumber: ' 7843K-065CA0Y ' });
    expect(result.success && result.data.partNumber).toBe('7843K-065CA0Y');
  });
});
