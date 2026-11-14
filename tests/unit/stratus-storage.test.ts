import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  init: vi.fn(),
  signed: vi.fn(),
  getObject: vi.fn(),
}));
vi.mock('next/headers', () => ({ headers: mocks.headers }));
vi.mock('@zcatalyst/auth/node', () => ({ zcAuth: { init: mocks.init } }));
vi.mock('@/lib/utils/env', () => ({ env: () => ({ STRATUS_BUCKET: 'test-bucket' }) }));
vi.mock('@zcatalyst/stratus', () => ({
  Stratus: class {
    bucket() {
      return { generatePreSignedUrl: mocks.signed, getObject: mocks.getObject };
    }
  },
}));

import { presignDownload, presignUpload, readHead } from '@/lib/storage/stratus';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.headers.mockResolvedValue(
    new Headers({ 'x-zc-projectid': '123', 'x-zc-environment': 'Development' }),
  );
  mocks.init.mockResolvedValue({});
  mocks.signed.mockResolvedValue({
    signature: 'https://test-bucket.zohostratus.in/_signed/file?token=a%2Fb',
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('private Stratus storage', () => {
  it('preserves the platform signature and uses the requested expiry', async () => {
    const signed = await presignDownload(
      { key: 'file.pdf', fileName: 'drawing.pdf', contentType: 'application/pdf' },
      300,
    );
    expect(signed.url).toBe('https://test-bucket.zohostratus.in/_signed/file?token=a%2Fb');
    expect(signed.downloadInBrowser).toBe(true);
    expect(mocks.signed).toHaveBeenCalledWith('file.pdf', 'GET', { expiryIn: '300' });
    await presignUpload('file.pdf', 900);
    expect(mocks.signed).toHaveBeenLastCalledWith('file.pdf', 'PUT', { expiryIn: '900' });
  });

  it('initializes from each request and refuses requests without platform context', async () => {
    await presignUpload('first.pdf', 900);
    mocks.headers.mockResolvedValue(new Headers({ 'x-zc-projectid': '456' }));
    await presignUpload('second.pdf', 900);
    expect(mocks.init.mock.calls.map(([request]) => request.projectId)).toEqual(['123', '456']);
    mocks.headers.mockResolvedValue(new Headers());
    await expect(presignUpload('untrusted.pdf', 900)).rejects.toThrow('request context');
  });

  it('caps file-signature reads even when a storage service ignores Range', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(1024).fill(65));
      },
      cancel,
    });
    const fetchObject = vi.fn().mockResolvedValue(new Response(stream));
    vi.stubGlobal('fetch', fetchObject);
    expect((await readHead('file.pdf', 4)).byteLength).toBe(4);
    expect(fetchObject).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        cache: 'no-store',
      }),
    );
    expect(cancel).toHaveBeenCalledOnce();
  });
});
