/**
 * `pnpm preflight` — refuses to continue when the wrong container runtime is
 * answering on the database port. Wired in front of the local-only scripts.
 *
 * See `scripts/lib/runtime-preflight.ts` for what it checks and why it exists.
 */
import { runPreflight } from './lib/runtime-preflight';

void runPreflight();
