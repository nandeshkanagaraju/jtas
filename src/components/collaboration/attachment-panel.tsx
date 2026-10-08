'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, FileText, Image as ImageIcon, Paperclip, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, apiFetch } from '@/lib/api/client';
import {
  ACCEPT_ATTRIBUTE,
  checkDeclaredFile,
  formatBytes,
  MAX_ATTACHMENT_BYTES,
} from '@/lib/domain/file-types';
import type { AttachmentRow } from '@/lib/services/attachment-service';
import { cn } from '@/lib/utils';
import { formatIST } from '@/lib/utils/time';

/**
 * Opens one attachment through the presigned GET.
 *
 * The same route the task page uses. The URL is minted for this reader and
 * expires in a few minutes; the bucket itself stays private.
 */
export async function openAttachment(id: string): Promise<void> {
  const { url } = await apiFetch<{ url: string }>(`/api/attachments/${id}/url`);
  window.location.assign(url);
}

interface Uploading {
  name: string;
  /** 0–100. */
  percent: number;
}

export function AttachmentPanel({
  jobId,
  subtaskId,
  canUpload,
  canDelete,
  /** Job-level only — the customer drawing and the PO. */
  jobLevelOnly = false,
  title = 'Attachments',
  /** The surrounding panel already carries a heading, so omit this one. */
  headless = false,
}: {
  jobId: string;
  subtaskId?: string | null;
  canUpload: boolean;
  canDelete: boolean;
  jobLevelOnly?: boolean;
  title?: string;
  headless?: boolean;
}) {
  const [items, setItems] = useState<AttachmentRow[] | null>(null);
  const [uploading, setUploading] = useState<Uploading | null>(null);
  const [dragging, setDragging] = useState(false);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const input = useRef<HTMLInputElement>(null);

  const query = subtaskId
    ? `subtaskId=${subtaskId}`
    : `jobId=${jobId}${jobLevelOnly ? '&jobLevelOnly=true' : ''}`;

  const reload = useCallback(async () => {
    const { data } = await apiFetch<{ data: AttachmentRow[] }>(`/api/attachments?${query}`);
    setItems(data);
    return data;
  }, [query]);

  useEffect(() => {
    reload().catch(() => setItems([]));
  }, [reload]);

  /*
   * Thumbnails need their own presigned URL each. Fetched once per image after
   * the list loads — and only for images, so a list of DWGs costs nothing.
   */
  useEffect(() => {
    if (!items) return;
    let live = true;

    for (const item of items) {
      if (!item.previewable || previews[item.id]) continue;

      apiFetch<{ url: string }>(`/api/attachments/${item.id}/url?disposition=inline`)
        .then(({ url }) => live && setPreviews((current) => ({ ...current, [item.id]: url })))
        .catch(() => undefined);
    }

    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  /**
   * Presign, PUT, register.
   *
   * The PUT uses XMLHttpRequest rather than fetch because it is the only way to
   * get progress events — and a 25 MB DWG on a shop-floor connection without a
   * progress bar looks like a frozen page.
   */
  async function upload(file: File) {
    const declared = checkDeclaredFile({
      fileName: file.name,
      contentType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
    });

    if (!declared.ok) {
      // Refused here as well as on the server, so 30 MB never leaves the
      // machine and the reader is told why immediately.
      toast.error(declared.message ?? 'That file cannot be uploaded.');
      return;
    }

    setUploading({ name: file.name, percent: 0 });

    try {
      const presigned = await apiFetch<{
        attachmentId: string;
        uploadUrl: string;
        storageKey: string;
      }>('/api/attachments/presign', {
        method: 'POST',
        body: JSON.stringify({
          jobId,
          subtaskId: subtaskId ?? null,
          fileName: file.name,
          contentType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
        }),
      });

      await new Promise<void>((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open('PUT', presigned.uploadUrl);
        request.setRequestHeader('Content-Type', file.type || 'application/octet-stream');

        request.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            setUploading({
              name: file.name,
              percent: Math.round((event.loaded / event.total) * 100),
            });
          }
        });

        request.addEventListener('load', () =>
          request.status >= 200 && request.status < 300
            ? resolve()
            : reject(new Error(`Upload failed (${request.status})`)),
        );
        request.addEventListener('error', () => reject(new Error('Upload failed')));
        request.send(file);
      });

      await apiFetch('/api/attachments', {
        method: 'POST',
        body: JSON.stringify({
          attachmentId: presigned.attachmentId,
          jobId,
          subtaskId: subtaskId ?? null,
          fileName: file.name,
          contentType: file.type || 'application/octet-stream',
          storageKey: presigned.storageKey,
        }),
      });

      await reload();
      toast.success(`${file.name} attached.`);
    } catch (error) {
      // The server's message is the useful one — "that file is not really a
      // PDF, check that it was not renamed".
      toast.error(error instanceof ApiError ? error.message : 'Could not upload that file.');
    } finally {
      setUploading(null);
    }
  }

  async function download(item: AttachmentRow) {
    try {
      await openAttachment(item.id);
    } catch {
      toast.error('Could not open that file.');
    }
  }

  async function remove(item: AttachmentRow) {
    try {
      await apiFetch(`/api/attachments/${item.id}`, { method: 'DELETE' });
      await reload();
      toast.success(`${item.fileName} removed.`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not remove that file.');
    }
  }

  return (
    <section className="space-y-3" aria-labelledby={`attachments-${subtaskId ?? jobId}`}>
      {headless ? null : (
        <h3
          id={`attachments-${subtaskId ?? jobId}`}
          className="section-title flex items-center gap-2"
        >
          <Paperclip className="size-4" aria-hidden />
          {title}
          {items ? <span className="text-muted-foreground font-mono">({items.length})</span> : null}
        </h3>
      )}

      {items === null ? (
        <div aria-hidden className="grid gap-2 sm:grid-cols-2">
          {[0, 1].map((row) => (
            <div key={row} className="border-border flex items-center gap-3 rounded-lg border p-2">
              <Skeleton className="size-11 shrink-0 rounded" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nothing attached yet.
          {canUpload ? ' Drop the drawing or the purchase order below.' : ''}
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="border-border hover:bg-accent/40 bg-card flex items-center gap-3 rounded-lg border p-2 transition-colors"
            >
              {item.previewable && previews[item.id] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previews[item.id]}
                  alt={item.fileName}
                  className="size-11 shrink-0 rounded object-cover"
                />
              ) : (
                <span className="bg-muted flex size-11 shrink-0 items-center justify-center rounded">
                  {item.previewable ? (
                    <ImageIcon className="text-muted-foreground size-5" />
                  ) : (
                    <FileText className="text-muted-foreground size-5" />
                  )}
                </span>
              )}

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.fileName}</p>
                <p className="text-muted-foreground text-xs">
                  {item.label} · {formatBytes(item.sizeBytes)}
                  {item.uploadedBy ? ` · ${item.uploadedBy.name}` : ''}
                </p>
                <p className="code text-muted-foreground text-[11px]">
                  {formatIST(new Date(item.createdAt))}
                </p>
              </div>

              <div className="flex shrink-0 gap-0.5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => download(item)}
                  aria-label={`Download ${item.fileName}`}
                >
                  <Download className="size-4" />
                </Button>

                {canDelete ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-late"
                    onClick={() => remove(item)}
                    aria-label={`Remove ${item.fileName}`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canUpload ? (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files[0];
            if (file) void upload(file);
          }}
          className={cn(
            'rounded-lg border border-dashed p-4 text-center transition-colors',
            dragging ? 'border-info bg-info-soft' : 'border-input',
          )}
        >
          {uploading ? (
            <div className="space-y-2">
              <p className="truncate text-sm">
                Uploading {uploading.name} — {uploading.percent}%
              </p>
              <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
                <div
                  className="bg-info h-full transition-[width] duration-200 motion-reduce:transition-none"
                  style={{ width: `${uploading.percent}%` }}
                  role="progressbar"
                  aria-valuenow={uploading.percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
              </div>
            </div>
          ) : (
            <>
              <input
                ref={input}
                type="file"
                accept={ACCEPT_ATTRIBUTE}
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file);
                  event.target.value = '';
                }}
              />

              <Button variant="outline" size="sm" onClick={() => input.current?.click()}>
                <Upload className="size-4" />
                Choose a file
              </Button>

              <p className="text-muted-foreground mt-2 text-xs">
                or drop one here. PDF, images, DWG, DXF, STEP, Excel and Word, up to{' '}
                {formatBytes(MAX_ATTACHMENT_BYTES)}.
              </p>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
