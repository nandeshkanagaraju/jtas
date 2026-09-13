import { describe, expect, it } from 'vitest';

import { classifySmtpError } from '@/lib/notifications/channels/email';
import { PermanentChannelError, TransientChannelError } from '@/lib/notifications/channels/types';

/** Builds the shape nodemailer throws. */
function smtpError(responseCode: number, message: string) {
  return Object.assign(new Error(message), { responseCode });
}

describe('classifySmtpError', () => {
  it.each([
    [550, '5.1.1 No such user here'],
    [551, 'User not local'],
    [553, 'Mailbox name not allowed'],
    [571, 'Delivery not authorized'],
  ])('treats %i as permanent', (code, message) => {
    const classified = classifySmtpError(smtpError(code, message));

    expect(classified).toBeInstanceOf(PermanentChannelError);
    // The original is kept as the cause so the operator sees the SMTP text.
    expect(classified.message).toContain(message);
    expect((classified as { cause?: unknown }).cause).toBeDefined();
  });

  it.each([
    [421, 'Service not available, closing transmission channel'],
    [450, 'Mailbox unavailable, try again later'],
    [451, 'Local error in processing'],
    [452, 'Insufficient system storage'],
  ])('treats %i as transient', (code, message) => {
    expect(classifySmtpError(smtpError(code, message))).toBeInstanceOf(TransientChannelError);
  });

  it('treats a transport error with no response code as transient', () => {
    // ECONNREFUSED while Mailpit restarts must not burn an attempt budget.
    const error = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1025'), {
      code: 'ECONNREFUSED',
    });

    expect(classifySmtpError(error)).toBeInstanceOf(TransientChannelError);
  });

  it('treats a non-Error throw as transient, and still reports it', () => {
    const classified = classifySmtpError('something went sideways');

    expect(classified).toBeInstanceOf(TransientChannelError);
    expect(classified.message).toContain('something went sideways');
  });

  it('does not mistake a 2xx or 3xx for permanent', () => {
    expect(classifySmtpError(smtpError(354, 'Start mail input'))).toBeInstanceOf(
      TransientChannelError,
    );
  });

  it('does not mistake a 6xx for permanent', () => {
    // Out of the 5xx band, so nothing in the spec says it is final.
    expect(classifySmtpError(smtpError(600, 'Nonstandard'))).toBeInstanceOf(TransientChannelError);
  });
});
