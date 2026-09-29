/**
 * Unified pre-flight and commit runner (JTAS build harness).
 *
 * Runs typecheck (Next + worker), lint and the test suite, then commits
 * ONLY if all three pass. Prints HEAD before and after so commit outcomes
 * are explicit and visible rather than inferred.
 *
 * Usage:
 *   pnpm ship "feat(m11): your commit message"
 *   pnpm ship -m "fix: something"
 */
import { execFileSync, execSync } from 'node:child_process';

function getHeadInfo(): string {
  try {
    return execSync('git log -1 --format="%h %s (%cr)"', { encoding: 'utf8' }).trim();
  } catch {
    return 'none';
  }
}

function runStep(name: string, command: string, args: string[]): void {
  console.log(`\n\x1b[36m==> [ship] Running ${name}...\x1b[0m`);
  try {
    execFileSync(command, args, { stdio: 'inherit' });
  } catch {
    console.error(`\n\x1b[31m[ship] FAILED: ${name}\x1b[0m`);
    process.exit(1);
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(
      '\x1b[31m[ship] Error: Commit message required.\x1b[0m\nUsage: pnpm ship "commit message" or pnpm ship -m "commit message"',
    );
    process.exit(1);
  }

  const commitArgs: string[] = ['commit'];
  if (args.length === 1 && !args[0].startsWith('-')) {
    commitArgs.push('-m', args[0]);
  } else {
    commitArgs.push(...args);
  }

  const headBefore = getHeadInfo();
  console.log(`\x1b[33m[ship] HEAD before: ${headBefore}\x1b[0m`);

  // 1. Typecheck (Next app + worker)
  runStep('typecheck', 'pnpm', ['typecheck']);

  // 2. Lint
  runStep('lint', 'pnpm', ['lint']);

  // 3. Test suite
  runStep('test suite', 'pnpm', ['test']);

  // 4. Commit
  console.log(`\n\x1b[36m==> [ship] Committing...\x1b[0m`);
  try {
    execFileSync('git', commitArgs, { stdio: 'inherit' });
  } catch {
    console.error(`\n\x1b[31m[ship] FAILED: git commit failed.\x1b[0m`);
    const headAfter = getHeadInfo();
    console.log(`\x1b[33m[ship] HEAD remains: ${headAfter}\x1b[0m`);
    process.exit(1);
  }

  const headAfter = getHeadInfo();
  console.log(`\n\x1b[32m[ship] SUCCESS!\x1b[0m`);
  console.log(`\x1b[33m[ship] HEAD before: ${headBefore}\x1b[0m`);
  console.log(`\x1b[32m[ship] HEAD after:  ${headAfter}\x1b[0m`);

  if (headBefore === headAfter) {
    console.warn(
      `\x1b[33m[ship] Warning: HEAD did not change. Did you stage changes with git add?\x1b[0m`,
    );
  }
}

main();
