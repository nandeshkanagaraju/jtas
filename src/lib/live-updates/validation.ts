import { z } from 'zod';

export const liveJobsQuerySchema = z.object({
  q: z.string().trim().max(200).default(''),
  state: z.enum(['active', 'completed', 'all']).default('active'),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
export type LiveJobsQuery = z.infer<typeof liveJobsQuerySchema>;
export const liveJobQuerySchema = z.object({
  kind: z.enum(['all', 'messages', 'workflow', 'issues', 'files']).default('all'),
  taskId: z.string().min(1).max(64).optional(),
  cursor: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[\w-]+$/)
    .optional(),
});
export type LiveJobQuery = z.infer<typeof liveJobQuerySchema>;
export const activityCursorSchema = z.object({
  at: z.string().datetime(),
  id: z.string().min(1).max(64),
});
