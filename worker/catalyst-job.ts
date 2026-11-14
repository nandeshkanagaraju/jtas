import { prisma } from '@/lib/db/prisma';
import { assertConfiguration } from '@/lib/startup/validate';
import { moduleLogger } from '@/lib/utils/logger';

import { runSchedulerPass } from './run-pass';

interface JobContext {
  closeWithSuccess(): void;
  closeWithFailure(): void;
}

const log = moduleLogger('catalyst-scheduler');

export async function handler(_request: unknown, context: JobContext): Promise<void> {
  let succeeded = false;
  try {
    const configuration = await assertConfiguration({ exit: false });
    if (!configuration.ok) throw new Error('Scheduled job configuration is invalid.');
    const result = await runSchedulerPass();
    log.info({ result }, result ? 'scheduled pass completed' : 'scheduler lease held; skipped');
    succeeded = true;
  } catch (error) {
    log.error({ err: error }, 'scheduled pass failed');
  } finally {
    await prisma.$disconnect().catch((error) => {
      succeeded = false;
      log.error({ err: error }, 'scheduled database disconnect failed');
    });
  }
  if (succeeded) context.closeWithSuccess();
  else context.closeWithFailure();
}
