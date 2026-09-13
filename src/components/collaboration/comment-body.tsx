import { toSegments, type MentionCandidate } from '@/lib/domain/mentions';

/**
 * Renders a comment.
 *
 * Every segment is emitted as a React child, never as HTML. SDD section 8 item
 * 5 is explicit — "HTML in comments/problem text is escaped on render (no
 * `dangerouslySetInnerHTML`)" — and React escapes a string child by
 * construction, so `<script>` in a comment renders as the four characters
 * somebody typed.
 *
 * `whitespace-pre-wrap` keeps the line breaks a member put in, which is how a
 * list of three things stays a list of three things.
 */
export function CommentBody({
  body,
  mentions,
  currentUserId,
}: {
  body: string;
  mentions: MentionCandidate[];
  currentUserId?: string;
}) {
  const segments = toSegments(body, mentions);

  return (
    <p className="text-sm whitespace-pre-wrap">
      {segments.map((segment, index) =>
        segment.kind === 'mention' ? (
          <span
            key={index}
            className={
              segment.userId === currentUserId
                ? 'bg-state-progress/15 text-state-progress rounded px-1 font-medium'
                : 'text-state-progress font-medium'
            }
          >
            {segment.text}
          </span>
        ) : (
          // A plain string child. React escapes it; nothing here builds markup.
          segment.text
        ),
      )}
    </p>
  );
}
