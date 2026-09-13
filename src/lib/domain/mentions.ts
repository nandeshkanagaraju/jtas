/**
 * `@mention` parsing for comments (build spec M10.1).
 *
 * Names, not handles — the directory has no usernames, and a shop floor writes
 * "@Ravi Kumar", not "@rkumar". That makes matching greedy and ambiguous, so
 * the rule is: take the longest known name that matches at each `@`, and match
 * nothing otherwise. A mention that does not resolve stays plain text rather
 * than becoming a broken link or a notification to the wrong Ravi.
 */

export interface MentionCandidate {
  id: string;
  name: string;
}

export interface Mention {
  id: string;
  name: string;
  /** Index of the `@` in the body. */
  start: number;
  /** One past the last character of the name. */
  end: number;
}

/**
 * Finds every resolvable mention, longest name first.
 *
 * Longest-first matters with real rosters: "Ravi" and "Ravi Kumar" can both be
 * users, and "@Ravi Kumar" should notify the second, not the first and leave
 * " Kumar" as text.
 */
export function findMentions(body: string, candidates: readonly MentionCandidate[]): Mention[] {
  if (candidates.length === 0) return [];

  const byLength = [...candidates].sort((a, b) => b.name.length - a.name.length);
  const haystack = body.toLowerCase();
  const found: Mention[] = [];

  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '@') continue;

    // An email address is not a mention: nobody writes "@" mid-word by accident
    // but "ravi@jaraaglobal.com" contains one.
    if (i > 0 && /[\w.]/.test(body[i - 1])) continue;

    const at = i + 1;

    for (const candidate of byLength) {
      const name = candidate.name.toLowerCase();
      if (!haystack.startsWith(name, at)) continue;

      // The name must end at a word boundary, or "@Ravi" would match inside
      // "@Ravindran".
      const next = body[at + name.length];
      if (next !== undefined && /[\w]/.test(next)) continue;

      found.push({ id: candidate.id, name: candidate.name, start: i, end: at + name.length });
      i = at + name.length - 1;
      break;
    }
  }

  return found;
}

/** The distinct user ids mentioned, for the notification fan-out. */
export function mentionedUserIds(body: string, candidates: readonly MentionCandidate[]): string[] {
  return [...new Set(findMentions(body, candidates).map((mention) => mention.id))];
}

/** One run of a comment: plain text, or a resolved mention. */
export type CommentSegment =
  { kind: 'text'; text: string } | { kind: 'mention'; text: string; userId: string };

/**
 * Splits a body into segments for rendering.
 *
 * The renderer emits these as React nodes — never `dangerouslySetInnerHTML`
 * (SDD section 8 item 5). A member's comment is untrusted text, and the one
 * place it could become markup is the one place it must not.
 */
export function toSegments(
  body: string,
  candidates: readonly MentionCandidate[],
): CommentSegment[] {
  const mentions = findMentions(body, candidates);
  if (mentions.length === 0) return body ? [{ kind: 'text', text: body }] : [];

  const segments: CommentSegment[] = [];
  let cursor = 0;

  for (const mention of mentions) {
    if (mention.start > cursor) {
      segments.push({ kind: 'text', text: body.slice(cursor, mention.start) });
    }

    segments.push({
      kind: 'mention',
      text: body.slice(mention.start, mention.end),
      userId: mention.id,
    });

    cursor = mention.end;
  }

  if (cursor < body.length) segments.push({ kind: 'text', text: body.slice(cursor) });

  return segments;
}
