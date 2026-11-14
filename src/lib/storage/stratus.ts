import { headers } from 'next/headers';
import { zcAuth } from '@zcatalyst/auth/node';
import { Stratus } from '@zcatalyst/stratus';

import { env } from '@/lib/utils/env';

/** Use the current request's platform credentials; never cache admin tokens. */
async function bucket() {
  const name = env().STRATUS_BUCKET;
  if (!name) throw new Error('STRATUS_BUCKET is not configured.');

  const requestHeaders = Object.fromEntries(await headers());
  const projectId = requestHeaders['x-zc-projectid'];
  if (!projectId) throw new Error('Stratus requires a Catalyst AppSail request context.');

  const request = {
    headers: requestHeaders,
    projectId,
    environment: requestHeaders['x-zc-environment'] || 'production',
  };
  const app = await zcAuth.init(request, { type: 'advancedio', scope: 'admin' });
  return new Stratus(app).bucket(name);
}

export async function presignUpload(key: string, ttl: number) {
  const signed = await (await bucket()).generatePreSignedUrl(key, 'PUT', { expiryIn: String(ttl) });
  return { url: signed.signature, expiresInSeconds: ttl };
}

export async function presignDownload(
  input: {
    key: string;
    fileName: string;
    contentType: string;
    disposition?: 'inline' | 'attachment';
  },
  ttl: number,
) {
  const signed = await (
    await bucket()
  ).generatePreSignedUrl(input.key, 'GET', {
    expiryIn: String(ttl),
  });
  return {
    // Appending response overrides to Stratus signed URLs fails in the IN
    // service. Keep the signed URL intact; the browser saves downloads with
    // the application-provided original filename instead.
    url: signed.signature,
    downloadInBrowser: input.disposition !== 'inline',
    expiresInSeconds: ttl,
    expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
  };
}

export async function headObject(key: string) {
  const details = await (await bucket()).object(key).getDetails();
  return { sizeBytes: Number(details.size), contentType: details.content_type || null };
}

export async function readHead(key: string, bytes: number): Promise<Uint8Array> {
  // The current Stratus Node SDK drops the raw response stream. Use a
  // short-lived signed request so validation can read a bounded prefix.
  const { signature } = await (
    await bucket()
  ).generatePreSignedUrl(key, 'GET', {
    expiryIn: '60',
  });
  const response = await fetch(signature, {
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok || !response.body) throw new Error('Unable to read the uploaded object.');
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let received = 0;
  try {
    while (received < bytes) {
      const { value, done } = await reader.read();
      if (done) break;
      const data = Buffer.from(value);
      const part = data.subarray(0, Math.max(0, bytes - received));
      chunks.push(part);
      received += part.length;
      if (received >= bytes) break;
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}

export async function putObject(input: { key: string; contentType: string; body: Uint8Array }) {
  await (
    await bucket()
  ).putObject(input.key, Buffer.from(input.body), {
    contentType: input.contentType,
    contentLength: String(input.body.byteLength),
  });
}

export async function deleteObject(key: string) {
  await (await bucket()).deleteObject(key);
}
