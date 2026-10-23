import { z } from 'zod';

// Endpoints are server-side network destinations. Accept only browser push
// services, never arbitrary URLs, private hosts, ports, or embedded credentials.
export function isPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash &&
      (url.hostname === 'fcm.googleapis.com' ||
        url.hostname === 'updates.push.services.mozilla.com' ||
        url.hostname === 'push.services.mozilla.com' ||
        url.hostname === 'web.push.apple.com' ||
        url.hostname.endsWith('.push.apple.com') ||
        url.hostname === 'wns.windows.com' ||
        url.hostname.endsWith('.notify.windows.com'))
    );
  } catch {
    return false;
  }
}

export const endpointSchema = z
  .string()
  .max(2048)
  .refine(isPushEndpoint, 'Invalid push service endpoint.');
const base64url = (bytes: number) =>
  z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .refine(
      (value) => Buffer.from(value, 'base64url').length === bytes,
      'Invalid push encryption key.',
    );
export const subscriptionSchema = z.object({
  endpoint: endpointSchema,
  keys: z.object({ p256dh: base64url(65), auth: base64url(16) }),
  locale: z.enum(['en', 'ta', 'hi']).default('en'),
});
