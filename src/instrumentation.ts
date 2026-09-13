/**
 * Next's boot hook — build spec M9.6.
 *
 * Runs once per server process, before the first request is served.
 */
export async function register() {
  // Only the Node runtime: the edge runtime has no database client, and the
  // middleware that runs there needs nothing this checks.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { assertConfiguration, formatConfigReport } = await import('@/lib/startup/validate');

  /*
   * The app does not exit on a bad configuration the way the worker does. A
   * process that refuses to start serves nothing at all, including the
   * /settings screen somebody needs to fix the value — so the report is logged
   * loudly and the app comes up. `checkConfiguration` classifies a malformed
   * setting as a warning precisely because the read path already falls back.
   */
  const report = await assertConfiguration({ exit: false });

  if (!report.ok) {
    console.error(`\n${formatConfigReport(report)}\n`);
  }
}
