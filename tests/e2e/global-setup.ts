/**
 * Seeds the known world before the suite runs (build spec M11.1).
 *
 * The database itself is created and migrated in `playwright.config.ts`, which
 * executes before the web server starts — this only fills it, because by the
 * time global setup runs the app is already up and answering.
 */
import { config } from 'dotenv';

config({ path: '.env', quiet: true });

import { e2eDatabaseUrl, seedE2E } from './fixtures/seed';

export default async function globalSetup() {
  const world = await seedE2E();

  console.log(
    `[e2e] ${e2eDatabaseUrl().split('/').pop()}: ` +
      `${Object.keys(world.userIds).length} users, ` +
      `${Object.keys(world.departmentIds).length} departments, 1 template`,
  );
}
