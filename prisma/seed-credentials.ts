/**
 * Reporting of the one-time credentials a seed run produces.
 *
 * The rule this file exists to enforce: a temporary password is written to
 * exactly two places — the operator's terminal and one 0600 file — and to
 * nowhere else, ever. It is not logged, not returned from an API, and not
 * stored in the database in any form but a bcrypt hash.
 */
import { chmodSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface SeedCredential {
  email: string;
  password: string;
}

/** Set `SEED_CREDENTIALS_FILE=none` to print only and write nothing to disk. */
const DEFAULT_CREDENTIALS_FILE = '.seed-credentials.txt';

function credentialsFilePath(): string | null {
  const configured = process.env.SEED_CREDENTIALS_FILE;
  if (configured === 'none') return null;
  return resolve(process.cwd(), configured || DEFAULT_CREDENTIALS_FILE);
}

/** Renders the credentials as an aligned plain-text table. */
function renderTable(credentials: SeedCredential[]): string {
  const emailWidth = Math.max(...credentials.map((c) => c.email.length), 'EMAIL'.length);
  const header = `${'EMAIL'.padEnd(emailWidth)}  TEMPORARY PASSWORD`;
  const rule = '-'.repeat(header.length);

  const rows = credentials.map((c) => `${c.email.padEnd(emailWidth)}  ${c.password}`);

  return [header, rule, ...rows].join('\n');
}

/**
 * Prints the credentials once and, unless disabled, writes them to a 0600 file.
 *
 * The file is created with `writeFileSync` and then `chmod`ed rather than
 * relying on the `mode` option alone, because that option is masked by the
 * process umask and would commonly land as 0644.
 */
export function reportSeedCredentials(credentials: SeedCredential[]): void {
  if (credentials.length === 0) {
    console.log('\nNo new accounts were created, so no passwords were generated.');
    console.log('Existing accounts keep the passwords they already have.');
    return;
  }

  const table = renderTable(credentials);
  const path = credentialsFilePath();

  console.log(`\n${'='.repeat(60)}`);
  console.log('ONE-TIME TEMPORARY PASSWORDS');
  console.log('='.repeat(60));
  console.log(table);
  console.log('='.repeat(60));
  console.log('These are shown ONCE and are NOT recoverable afterwards — only a');
  console.log('bcrypt hash is stored. Every account must change its password at');
  console.log('first sign-in. If you lose one, reset it from the Users screen or');
  console.log('re-run the seed against a reset database.');

  if (!path) {
    console.log('\nSEED_CREDENTIALS_FILE=none — nothing was written to disk.');
    console.log('='.repeat(60));
    return;
  }

  const contents = [
    'JTAS seeded accounts — one-time temporary passwords.',
    `Generated ${new Date().toISOString()}`,
    '',
    'Every account must change its password at first sign-in.',
    'Delete this file once the passwords have been handed out.',
    '',
    table,
    '',
  ].join('\n');

  writeFileSync(path, contents, { encoding: 'utf8', mode: 0o600 });
  chmodSync(path, 0o600);

  console.log(`\nAlso written to ${path} (mode 0600, git-ignored).`);
  console.log('Delete it once the passwords have been handed out.');
  console.log('='.repeat(60));
}
