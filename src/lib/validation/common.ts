/**
 * Shapes shared by every list endpoint (SDD section 6.1).
 *
 * One definition, so page size limits and sort handling cannot drift between
 * the users list, the jobs list and everything that follows.
 */
import { z } from 'zod';

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/** `?page=&pageSize=` — 1-indexed, because it is user-facing. */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

/** `?q=` — free-text search. Trimmed, and capped so it cannot become a scan. */
export const searchSchema = z.object({
  q: z.string().trim().max(200).optional(),
});

/** The envelope every list endpoint returns. */
export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** Translates a 1-indexed page into a Prisma `skip`/`take`. */
export function toSkipTake(input: { page: number; pageSize: number }): {
  skip: number;
  take: number;
} {
  return { skip: (input.page - 1) * input.pageSize, take: input.pageSize };
}
