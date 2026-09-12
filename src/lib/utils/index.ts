/**
 * Barrel for `@/lib/utils`. Kept deliberately thin: it re-exports only the
 * genuinely cross-cutting helpers so that shadcn/ui components (which import
 * `cn` from this alias) do not drag server-only modules such as `env` or
 * `logger` into the client bundle.
 */
export { cn } from './cn';
