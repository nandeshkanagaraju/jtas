/**
 * Runs one sweep against the end-to-end database, from its own process.
 *
 *   pnpm exec tsx scripts/e2e-sweep.ts dispatch [isoInstant]
 *   pnpm exec tsx scripts/e2e-sweep.ts escalate [isoInstant]
 *
 * Out-of-process on purpose. Calling the engine inside the Playwright runner
 * fails in a thoroughly misleading way: Playwright instruments globals, React
 * Email's renderer receives one of those instrumented objects, and every send
 * dies with "Objects are not valid as a React child" — which the sweeper
 * classifies as a transient failure, so the row simply stays PENDING and the
 * assertion reads as a timing bug.
 *
 * It is also how the sweeper really runs: a separate process, on a timer.
 */
import { config } from 'dotenv';

config({ path: '.env', quiet: true });

// Must be set before the application's Prisma client or channels are imported.
process.env.DATABASE_URL = (process.env.DATABASE_URL ?? '').replace(/(_dev|_test)(\?|$)/, '_e2e$2');
process.env.MAIL_PROVIDER = 'smtp';
process.env.BREVO_API_KEY = '';
process.env.MAIL_ALLOWLIST = '';
process.env.MAIL_DAILY_CAP = '250';

async function main() {
  const [action, instant] = process.argv.slice(2);
  const at = instant ? new Date(instant) : new Date();

  const { dispatchDue, escalateOverdue } = await import('../src/lib/notifications/sweeper');

  if (action === 'dispatch') {
    console.log(JSON.stringify(await dispatchDue(at)));
    return;
  }

  if (action === 'escalate') {
    console.log(JSON.stringify({ escalated: await escalateOverdue(at) }));
    return;
  }

  throw new Error(`Unknown action "${action}". Use dispatch or escalate.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
