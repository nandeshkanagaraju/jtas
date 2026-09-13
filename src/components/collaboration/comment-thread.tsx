'use client';

import { useEffect, useRef, useState } from 'react';
import { AtSign, Loader2, MessageSquare, Send } from 'lucide-react';
import { toast } from 'sonner';

import { CommentBody } from '@/components/collaboration/comment-body';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, apiFetch } from '@/lib/api/client';
import type { MentionCandidate } from '@/lib/domain/mentions';
import { COMMENT_MAX_LENGTH } from '@/lib/services/comment-service';
import { cn } from '@/lib/utils';
import { formatIST } from '@/lib/utils/time';

export interface CommentDto {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string; email: string } | null;
}

/** Initials for the avatar. "Ravi Kumar" -> "RK". */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function CommentThread({
  subtaskId,
  currentUserId,
  canComment,
}: {
  subtaskId: string;
  currentUserId: string;
  canComment: boolean;
}) {
  const [comments, setComments] = useState<CommentDto[] | null>(null);
  const [candidates, setCandidates] = useState<MentionCandidate[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let live = true;

    apiFetch<{ data: CommentDto[]; mentionCandidates: MentionCandidate[] }>(
      `/api/subtasks/${subtaskId}/comments`,
    )
      .then((result) => {
        if (!live) return;
        setComments(result.data);
        setCandidates(result.mentionCandidates);
      })
      .catch(() => live && setComments([]));

    return () => {
      live = false;
    };
  }, [subtaskId]);

  async function send() {
    const body = draft.trim();
    if (!body) return;

    setSending(true);

    try {
      const { data } = await apiFetch<{ data: CommentDto }>(`/api/subtasks/${subtaskId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      });

      setComments((current) => [...(current ?? []), data]);
      setDraft('');
      setSuggestOpen(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not post that.');
    } finally {
      setSending(false);
    }
  }

  /** Inserts a name at the caret, replacing the partial `@…` being typed. */
  function insertMention(name: string) {
    const field = textarea.current;
    const caret = field?.selectionStart ?? draft.length;
    const before = draft.slice(0, caret);
    const at = before.lastIndexOf('@');

    const next =
      at === -1 ? `${draft}@${name} ` : `${before.slice(0, at)}@${name} ${draft.slice(caret)}`;

    setDraft(next);
    setSuggestOpen(false);
    field?.focus();
  }

  // The partial name after the last `@`, if the caret is still inside it.
  const partial = (() => {
    const caret = textarea.current?.selectionStart ?? draft.length;
    const before = draft.slice(0, caret);
    const at = before.lastIndexOf('@');
    if (at === -1) return null;

    const fragment = before.slice(at + 1);
    return /^[\w ]{0,30}$/.test(fragment) ? fragment.toLowerCase() : null;
  })();

  const suggestions =
    suggestOpen && partial !== null
      ? candidates.filter((person) => person.name.toLowerCase().includes(partial)).slice(0, 5)
      : [];

  const remaining = COMMENT_MAX_LENGTH - draft.length;

  return (
    <section className="space-y-3" aria-labelledby="comments">
      <h3 id="comments" className="flex items-center gap-2 text-sm font-semibold">
        <MessageSquare className="size-4" />
        Comments{comments ? ` (${comments.length})` : ''}
      </h3>

      {comments === null ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-3.5 animate-spin" />
          Loading…
        </p>
      ) : comments.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nothing here yet. Ask a question, or record what you found.
        </p>
      ) : (
        <ol className="space-y-3">
          {comments.map((comment) => (
            <li key={comment.id} className="flex gap-2.5">
              <span
                className="bg-muted mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
                aria-hidden
              >
                {initials(comment.author?.name ?? '?')}
              </span>

              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-medium">{comment.author?.name ?? 'Unknown'}</span>
                  <span className="text-muted-foreground tabular text-xs">
                    {formatIST(new Date(comment.createdAt))}
                  </span>
                </p>

                <CommentBody
                  body={comment.body}
                  mentions={candidates}
                  currentUserId={currentUserId}
                />
              </div>
            </li>
          ))}
        </ol>
      )}

      {canComment ? (
        <div className="relative space-y-2">
          <Textarea
            ref={textarea}
            value={draft}
            rows={3}
            maxLength={COMMENT_MAX_LENGTH}
            placeholder="Add a note, or type @ to mention somebody on this job."
            onChange={(event) => {
              setDraft(event.target.value);
              setSuggestOpen(event.target.value.includes('@'));
            }}
            onKeyDown={(event) => {
              // Ctrl/Cmd+Enter sends; Enter alone keeps the line break, because
              // a shop-floor note is often three lines.
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void send();
              }
              if (event.key === 'Escape') setSuggestOpen(false);
            }}
          />

          {suggestions.length > 0 ? (
            <ul className="bg-popover absolute bottom-full z-10 mb-1 w-64 overflow-hidden rounded-md border shadow-md">
              {suggestions.map((person) => (
                <li key={person.id}>
                  <button
                    type="button"
                    className="hover:bg-accent flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm"
                    onClick={() => insertMention(person.name)}
                  >
                    <AtSign className="text-muted-foreground size-3.5" />
                    {person.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex items-center gap-3">
            <Button size="sm" onClick={send} disabled={sending || draft.trim().length === 0}>
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Post
            </Button>

            <span
              className={cn(
                'text-muted-foreground text-xs',
                remaining < 100 && 'text-state-problem',
              )}
            >
              {remaining < 200 ? `${remaining} characters left` : 'Ctrl+Enter to post'}
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
