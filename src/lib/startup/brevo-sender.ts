/**
 * Refuses to boot when Brevo would rewrite the From address.
 *
 * This exists because of a failure that looked like success at every layer we
 * control. `MAIL_FROM` was a verified Brevo sender — added, confirmed by email,
 * `active: true` — and Brevo sent the mail as
 * `you@12289361.brevosend.com` instead. It will not send with a
 * From domain it cannot authenticate, and `gmail.com` can never be
 * authenticated by us, so it substitutes `<user_id>.brevosend.com` and sends
 * anyway. Gmail received mail from an unknown subdomain claiming to represent a
 * Gmail user and dropped it silently: not spam, not Promotions, absent.
 *
 * Nothing reported a problem. The API returned 201 with a message id, the row
 * went SENT, the Brevo log's status column read "Sent", and the credits were
 * charged. Only the From column in the log UI showed the substitution.
 *
 * `/v3/senders/domains` is the one call that predicts it: an empty list means
 * no domain is authenticated, so *nothing* placed in `MAIL_FROM` will survive,
 * whatever `/v3/senders` says about the address being active. That is one HTTP
 * request at boot against a debugging cycle, so it happens at boot.
 */
import { moduleLogger } from '@/lib/utils/logger';

const log = moduleLogger('startup');

export const SENDERS_DOMAINS_ENDPOINT = 'https://api.brevo.com/v3/senders/domains';

/** The account is remote and may be slow; boot must not hang on it. */
const REQUEST_TIMEOUT_MS = 8_000;

export interface SenderDomainCheck {
  /** `error` stops the boot; `warning` is said loudly and carries on. */
  severity: 'ok' | 'warning' | 'error';
  message: string;
}

/** The domain part of an address, lowercased. Empty when there is no `@`. */
export function domainOf(address: string): string {
  const match = /@([^@>\s]+)>?\s*$/.exec(address.trim());
  return match ? match[1].toLowerCase() : '';
}

interface DomainsResponse {
  domains?: Array<{ domain?: string; authenticated?: boolean; verified?: boolean }>;
}

/**
 * Asks Brevo which domains it will actually send as.
 *
 * @returns the authenticated domain names, or null when Brevo could not be
 *          asked — which is not the same answer and must not be treated as one.
 */
async function fetchAuthenticatedDomains(apiKey: string): Promise<string[] | null> {
  try {
    const response = await fetch(SENDERS_DOMAINS_ENDPOINT, {
      headers: { 'api-key': apiKey, accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) return null;

    const body = (await response.json()) as DomainsResponse;
    if (!Array.isArray(body.domains)) return null;

    return body.domains
      .filter((entry) => entry.authenticated !== false)
      .map((entry) => (entry.domain ?? '').toLowerCase())
      .filter(Boolean);
  } catch {
    return null;
  }
}

/**
 * Checks that Brevo will send as `MAIL_FROM`'s domain.
 *
 * Only runs for `MAIL_PROVIDER=brevo`. Under the default `smtp` it returns
 * immediately and makes **no network call at all**, so local development
 * against Mailpit boots exactly as before, offline and unchanged.
 *
 * An unreachable Brevo is a warning, never an error. Being unable to ask is not
 * evidence of misconfiguration, and a laptop on a train should still start the
 * worker — the mail it queues is written to the database either way, and the
 * dispatcher will report the real failure when it tries to send.
 */
export async function checkBrevoSenderDomain(
  env: NodeJS.ProcessEnv = process.env,
  fetchDomains = fetchAuthenticatedDomains,
): Promise<SenderDomainCheck> {
  if ((env.MAIL_PROVIDER ?? 'smtp').trim().toLowerCase() !== 'brevo') {
    return { severity: 'ok', message: 'MAIL_PROVIDER is not brevo; sender domain not checked.' };
  }

  const apiKey = env.BREVO_API_KEY?.trim();
  if (!apiKey) {
    return {
      severity: 'error',
      message:
        'MAIL_PROVIDER=brevo but BREVO_API_KEY is not set. See docs/MAIL_SETUP.md section 2.',
    };
  }

  const from = env.MAIL_FROM?.trim() ?? '';
  const domain = domainOf(from);

  if (!domain) {
    return {
      severity: 'error',
      message: `MAIL_FROM ("${from}") has no domain. Expected an address, or "Name <address>".`,
    };
  }

  /*
   * A throw here is the same answer as a failed request: we could not ask.
   * The inner lookup already catches its own errors, but this check runs
   * before anything else is up and must not be the thing that crashes the
   * boot — so an unexpected throw degrades to the warning path rather than
   * propagating out of a function whose whole job is to report a problem.
   */
  const authenticated = await fetchDomains(apiKey).catch(() => null);

  if (authenticated === null) {
    return {
      severity: 'warning',
      message:
        `Could not reach Brevo to confirm that "${domain}" is authenticated ` +
        `(${SENDERS_DOMAINS_ENDPOINT}). Continuing — an unreachable provider is not a ` +
        `misconfiguration, and nothing is lost: notifications are written to the database ` +
        `and the dispatcher reports the real failure when it sends. Verify with:\n` +
        `      curl -s -H "api-key: $BREVO_API_KEY" ${SENDERS_DOMAINS_ENDPOINT}`,
    };
  }

  if (authenticated.includes(domain)) {
    return { severity: 'ok', message: `Brevo will send as ${domain}.` };
  }

  const listed =
    authenticated.length === 0
      ? 'the list is EMPTY — no domain is authenticated on this account'
      : `authenticated: ${authenticated.join(', ')}`;

  return {
    severity: 'warning',
    message:
      `MAIL_FROM is "${from}", but "${domain}" is NOT in Brevo's authenticated domain list ` +
      `(${listed}).\n` +
      `      Brevo will rewrite the sender address (substituting <localpart>@<user_id>.brevosend.com),\n` +
      `      and inbox delivery may take up to 20 minutes.\n` +
      `      Domain verification (docs/MAIL_SETUP.md section 5) remains the proper fix for production,\n` +
      `      but local operation proceeds.\n` +
      `      See it yourself:\n` +
      `        curl -s -H "api-key: $BREVO_API_KEY" ${SENDERS_DOMAINS_ENDPOINT}\n` +
      `      To send via Mailpit instead, set MAIL_PROVIDER=smtp.`,
  };
}

/** Logs the outcome. Exported so the worker and instrumentation agree. */
export function logSenderDomainCheck(result: SenderDomainCheck): void {
  if (result.severity === 'warning') log.warn(result.message);
  else if (result.severity === 'error') log.error(result.message);
}
