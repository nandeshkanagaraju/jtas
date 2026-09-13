/**
 * Every template, rendered.
 *
 * No database is touched — this lives in the integration project because
 * rendering reads APP_BASE_URL, and the integration setup is what loads the
 * environment.
 */
import { describe, expect, it } from 'vitest';

import { renderTemplate, subjectFor, TEMPLATE_KINDS } from '@/lib/notifications/templates';
import { SAMPLES } from '@/lib/notifications/templates/samples';

describe.each(TEMPLATE_KINDS)('%s', (kind) => {
  const payload = SAMPLES[kind];

  it('renders an HTML body and a plain-text twin', async () => {
    const { html, text } = await renderTemplate(payload);

    expect(html).toContain('<html');
    expect(html).toContain('</html>');
    expect(text.trim().length).toBeGreaterThan(80);
    expect(text).not.toContain('<');
  });

  it('has a subject that says what happened and which job', async () => {
    const subject = subjectFor(payload);

    // The prefix is what people filter on; the job code is what makes the line
    // useful in a list of forty.
    expect(subject.startsWith('[JTAS] ')).toBe(true);
    expect(subject.length).toBeLessThanOrEqual(120);
    if (kind !== 'DAILY_DIGEST_MD') {
      expect(subject).toMatch(/JGE-\d{4}-\d{4}/);
    }
  });

  it('carries no unrendered placeholders', async () => {
    const { html, text } = await renderTemplate(payload);

    for (const rubbish of ['[object Object]', 'undefined', 'NaN', 'Invalid Date', '{{']) {
      expect(html, `html contains ${rubbish}`).not.toContain(rubbish);
      expect(text, `text contains ${rubbish}`).not.toContain(rubbish);
    }
  });

  it('puts a literal URL in the text part (improvement I-14)', async () => {
    const { text } = await renderTemplate(payload);

    // A text client renders a button as bare words, so without this the mail is
    // a dead end.
    expect(text).toMatch(/https?:\/\/[^\s]+/);
  });

  it('keeps every fact on its own line in the text part', async () => {
    const { text } = await renderTemplate(payload);

    // html-to-text's default flattens a <table> into one unbroken run —
    // "JobJGE-2026-0042Part / DrawingSH-4410" — which is unreadable on exactly
    // the restricted clients that get the text part.
    const lines = text.split('\n');
    expect(lines.every((line) => line.length <= 100)).toBe(true);

    const jobLine = lines.find((line) => line.includes('JGE-'));
    if (jobLine && /Part|Department|Deadline/.test(text)) {
      expect(jobLine).not.toMatch(/JGE-\d{4}-\d{4}[^\s]*(Part|Department)/);
    }
  });
});

describe('the whole set', () => {
  it('covers all eleven SDD 5.4 templates', () => {
    expect(TEMPLATE_KINDS).toHaveLength(11);
    expect(Object.keys(SAMPLES).sort()).toEqual([...TEMPLATE_KINDS].sort());
  });

  it('addresses the MD templates as the SDD words them', async () => {
    const { text } = await renderTemplate(SAMPLES.OVERDUE_MD);

    expect(text).toContain('Dear Sir');
    expect(text).toContain('has crossed its deadline');
    expect(text).toContain('No completion or problem report has been received.');
  });
});
