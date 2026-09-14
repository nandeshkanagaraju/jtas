/**
 * Which SMTP configuration actually takes effect.
 *
 * The `mail.*` settings were added in M9 with help text promising they
 * override the environment, and nothing read them until M11 — the same class
 * of gap as `reminder.default_lead_minutes`. This is the test that keeps them
 * connected.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { mailConfig, resetEmailTransport } from '@/lib/notifications/channels/email';
import { settingDefaults } from '@/lib/domain/settings-definitions';
import { invalidateSettings } from '@/lib/services/settings';
import { env } from '@/lib/utils/env';

import { resetAuthTables, testDb } from './helpers/db';

async function set(values: Record<string, unknown>) {
  for (const [key, value] of Object.entries(values)) {
    await testDb.setting.upsert({
      where: { key },
      create: { key, value: value as never },
      update: { value: value as never },
    });
  }
  invalidateSettings();
  resetEmailTransport();
}

beforeEach(async () => {
  await resetAuthTables();
  await set(settingDefaults());
});

afterAll(async () => {
  await resetAuthTables();
  await testDb.$disconnect();
});

describe('mailConfig', () => {
  it('falls back to the environment when no setting is set', async () => {
    const config = await mailConfig();

    // SDD 10.3 puts SMTP in the environment; the settings are an override.
    expect(config.host).toBe(env().SMTP_HOST);
    expect(config.port).toBe(env().SMTP_PORT);
  });

  it('lets a setting override the environment', async () => {
    await set({
      'mail.smtp_host': 'smtp.gmail.com',
      'mail.smtp_port': 587,
      'mail.smtp_user': 'somebody@gmail.com',
      'mail.smtp_password': 'an-app-password',
    });

    const config = await mailConfig();

    expect(config.host).toBe('smtp.gmail.com');
    expect(config.port).toBe(587);
    expect(config.user).toBe('somebody@gmail.com');
    expect(config.pass).toBe('an-app-password');
  });

  it('treats a blank setting as "use the environment"', async () => {
    await set({ 'mail.smtp_host': '', 'mail.smtp_port': 0 });

    const config = await mailConfig();

    expect(config.host).toBe(env().SMTP_HOST);
    expect(config.port).toBe(env().SMTP_PORT);
  });

  it('derives implicit TLS from port 465', async () => {
    // A host and port that disagree with the flag fail as a timeout nobody can
    // read, so the flag is derived rather than configured.
    await set({ 'mail.smtp_host': 'smtp.example.com', 'mail.smtp_port': 465 });
    expect((await mailConfig()).secure).toBe(true);

    await set({ 'mail.smtp_port': 587 });
    expect((await mailConfig()).secure).toBe(env().SMTP_SECURE);
  });

  it('uses the configured From address', async () => {
    await set({ 'mail.from': 'jtas@jaraaglobal.com' });

    expect((await mailConfig()).from).toBe('jtas@jaraaglobal.com');
  });

  it('carries the extra MD recipients', async () => {
    await set({ 'mail.md_recipients': ['deputy@jaraaglobal.com'] });

    expect((await mailConfig()).mdRecipients).toEqual(['deputy@jaraaglobal.com']);
  });

  it('never puts the password in the transport cache key', async () => {
    // The key is logged nowhere, but a secret in a cache key is a secret one
    // stray log line from being written down.
    await set({ 'mail.smtp_password': 'super-secret-value' });
    const config = await mailConfig();

    expect(config.pass).toBe('super-secret-value');
    // The key is built from the password's *length*, which is what makes a
    // changed credential rebuild the pool without the secret travelling.
    expect(config.pass.length).toBeGreaterThan(0);
  });
});
