/**
 * POST /api/settings/test-email — build spec M9.2.
 *
 * Sends one message through the real channel so an administrator can find out
 * that SMTP is misconfigured now, rather than the next time a deadline is
 * missed and the mail that should have chased it goes nowhere.
 */
import { handler, ok, parseJson } from '@/lib/api/respond';
import { can } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { channelFor } from '@/lib/notifications/channels';
import { forbidden } from '@/lib/errors';
import { moduleLogger } from '@/lib/utils/logger';
import { formatIST } from '@/lib/utils/time';
import { testEmailSchema } from '@/lib/validation/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = moduleLogger('settings');

export const POST = handler(async (request) => {
  const session = await requireActiveSession();
  if (!can(session, 'settings:manage', undefined)) throw forbidden();

  const { to } = await parseJson(request, testEmailSchema);
  const sentAt = formatIST(new Date());

  try {
    const { providerId } = await channelFor('EMAIL').send(
      {
        id: `test-${Date.now()}`,
        type: 'SUBTASK_ASSIGNED',
        subject: '[JTAS] Test message',
        body: `This is a test from JTAS, sent ${sentAt} IST by ${session.name}.\n\nIf it reached you, the mail settings are working.`,
        html: `<p>This is a test from JTAS, sent <strong>${sentAt} IST</strong> by ${session.name}.</p><p>If it reached you, the mail settings are working.</p>`,
        entityType: 'SETTING',
        entityId: 'mail.test',
      },
      { id: session.id, name: session.name, email: to, phone: null },
    );

    log.info({ to, actorId: session.id }, 'test email sent');

    return ok({ sent: true, to, at: sentAt, providerId: providerId ?? null });
  } catch (error) {
    /*
     * Returned as a result rather than thrown. The administrator asked "is mail
     * working?" and "no, because the host refused the connection" is the answer
     * — a 500 with a generic message would be the same button doing nothing.
     */
    const message = error instanceof Error ? error.message : String(error);
    log.warn({ to, err: message }, 'test email failed');

    return ok({ sent: false, to, at: sentAt, error: message });
  }
});
