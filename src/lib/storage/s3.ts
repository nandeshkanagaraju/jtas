/**
 * S3-compatible object storage (build spec M10.2).
 *
 * Uploads go straight from the browser to the bucket through a presigned PUT,
 * and downloads come back through a presigned GET. The application never
 * proxies twenty-five megabytes of DWG through a Node process, and the bucket
 * is never public — every URL is minted for one object, for one reader, for a
 * few minutes.
 *
 * `forcePathStyle` because the local bucket is MinIO at `localhost:9000`, where
 * virtual-host addressing would resolve `jtas-attachments.localhost`.
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { env } from '@/lib/utils/env';

/** How long an upload URL is good for. Long enough for 25 MB on a slow line. */
export const UPLOAD_URL_TTL_SECONDS = 15 * 60;

/**
 * How long a download URL is good for.
 *
 * Short on purpose. The URL carries its own authorisation, so anything that
 * copies it — a pasted link, a proxy log, a browser history sync — carries
 * access to the object with it. Five minutes is enough to click and not much
 * more (SDD section 8 item 6: "short-lived presigned GETs only").
 */
export const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

const globalForS3 = globalThis as unknown as {
  jtasS3?: S3Client;
  jtasS3Public?: S3Client;
};

/**
 * Two clients, because two different callers use the URLs.
 *
 *   internal  the server's own reads and writes — head, ranged get, delete
 *   public    the URLs handed to a browser
 *
 * They differ in production: the app reaches MinIO at `http://minio:9000` on
 * the Docker network, while the browser reaches it at `https://<domain>/files`
 * through Caddy. SigV4 signs the host, so a presigned URL has to be signed
 * against the address the browser will actually call — and the server should
 * not have to route its own traffic back out through the public name, which
 * depends on the host hairpinning its own IP.
 *
 * With one endpoint configured, both are the same and nothing changes.
 */
function build(endpoint: string | undefined): S3Client {
  const config = env();

  if (!config.S3_KEY || !config.S3_SECRET || !config.S3_BUCKET) {
    // Reached only if a route forgets to check `storageConfigured()` first.
    // Better a named error than an SDK one about a missing credential chain.
    throw new Error('Attachment storage is not configured. See S3_* in .env.example.');
  }

  return new S3Client({
    region: config.S3_REGION,
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    credentials: {
      accessKeyId: config.S3_KEY,
      secretAccessKey: config.S3_SECRET,
    },
  });
}

/** For the server's own calls. */
function client(): S3Client {
  globalForS3.jtasS3 ??= build(env().S3_ENDPOINT);
  return globalForS3.jtasS3;
}

/** For URLs a browser will use. */
function publicClient(): S3Client {
  const config = env();
  globalForS3.jtasS3Public ??= build(config.S3_PUBLIC_ENDPOINT || config.S3_ENDPOINT);
  return globalForS3.jtasS3Public;
}

function bucket(): string {
  const name = env().S3_BUCKET;
  if (!name) throw new Error('S3_BUCKET is not set.');
  return name;
}

/** True when storage is configured at all. */
export function storageConfigured(): boolean {
  const config = env();
  return Boolean(config.S3_BUCKET && config.S3_KEY && config.S3_SECRET);
}

/**
 * A URL the browser may PUT one object to.
 *
 * The content type is signed in, so the upload cannot declare something other
 * than what was checked at presign time.
 */
export async function presignUpload(input: {
  key: string;
  contentType: string;
  sizeBytes: number;
}): Promise<{ url: string; expiresInSeconds: number }> {
  const command = new PutObjectCommand({
    Bucket: bucket(),
    Key: input.key,
    ContentType: input.contentType,
    ContentLength: input.sizeBytes,
  });

  const url = await getSignedUrl(publicClient(), command, { expiresIn: UPLOAD_URL_TTL_SECONDS });

  return { url, expiresInSeconds: UPLOAD_URL_TTL_SECONDS };
}

/**
 * A short-lived URL for reading one object.
 *
 * `ResponseContentDisposition` carries the original file name, so a download
 * saves as `SH-4410.pdf` rather than the cuid the object is stored under.
 */
export async function presignDownload(input: {
  key: string;
  fileName: string;
  contentType: string;
  /** `inline` for a thumbnail, `attachment` for a download. */
  disposition?: 'inline' | 'attachment';
}): Promise<{ url: string; expiresInSeconds: number; expiresAt: string }> {
  // Quotes and backslashes would break out of the header's quoted string.
  const safeName = input.fileName.replace(/["\\]/g, '_');

  const command = new GetObjectCommand({
    Bucket: bucket(),
    Key: input.key,
    ResponseContentType: input.contentType,
    ResponseContentDisposition: `${input.disposition ?? 'attachment'}; filename="${safeName}"`,
  });

  const url = await getSignedUrl(publicClient(), command, { expiresIn: DOWNLOAD_URL_TTL_SECONDS });

  return {
    url,
    expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
    expiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000).toISOString(),
  };
}

export interface ObjectFacts {
  sizeBytes: number;
  contentType: string | null;
}

/** What the bucket says about an object, or null if it is not there. */
export async function headObject(key: string): Promise<ObjectFacts | null> {
  try {
    const result = await client().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));

    return {
      sizeBytes: Number(result.ContentLength ?? 0),
      contentType: result.ContentType ?? null,
    };
  } catch {
    // A missing object and a permissions failure are the same answer here:
    // this object cannot be registered.
    return null;
  }
}

/**
 * The first bytes of an object.
 *
 * A ranged GET, not a full read: the signature check needs four kilobytes, and
 * pulling a 25 MB assembly into memory to look at its first four bytes is the
 * kind of thing that works in testing and falls over on a busy afternoon.
 */
export async function readHead(key: string, bytes: number): Promise<Uint8Array | null> {
  try {
    const result = await client().send(
      new GetObjectCommand({ Bucket: bucket(), Key: key, Range: `bytes=0-${bytes - 1}` }),
    );

    if (!result.Body) return null;

    return await result.Body.transformToByteArray();
  } catch {
    return null;
  }
}

/**
 * Removes an object.
 *
 * Used only to clean up an upload that failed its checks — a registered
 * attachment is soft-deleted and its object stays (architecture rule 6).
 */
export async function deleteObject(key: string): Promise<void> {
  await client()
    .send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }))
    .catch(() => {
      // Best effort. An orphaned object costs a few kilobytes; a failed cleanup
      // must not turn a rejected upload into a 500.
    });
}
