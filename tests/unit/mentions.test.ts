import { describe, expect, it } from 'vitest';

import { findMentions, mentionedUserIds, toSegments } from '@/lib/domain/mentions';

const PEOPLE = [
  { id: 'u1', name: 'Ravi' },
  { id: 'u2', name: 'Ravi Kumar' },
  { id: 'u3', name: 'Anita Sharma' },
  { id: 'u4', name: 'Ravindran' },
];

describe('findMentions', () => {
  it('finds a mention at the start of a comment', () => {
    expect(findMentions('@Anita Sharma please check this', PEOPLE)).toEqual([
      { id: 'u3', name: 'Anita Sharma', start: 0, end: 13 },
    ]);
  });

  it('prefers the longest matching name', () => {
    // Both "Ravi" and "Ravi Kumar" are real people. Matching the shorter would
    // notify the wrong one and leave " Kumar" as stray text.
    const [mention] = findMentions('@Ravi Kumar has the drawing', PEOPLE);

    expect(mention.id).toBe('u2');
    expect(mention.name).toBe('Ravi Kumar');
  });

  it('still matches the shorter name when it stands alone', () => {
    expect(findMentions('@Ravi has it', PEOPLE)[0].id).toBe('u1');
  });

  it('does not match a name inside a longer word', () => {
    // "@Ravindran" must not resolve to "Ravi".
    expect(findMentions('@Ravindran is on leave', PEOPLE)[0].id).toBe('u4');
  });

  it('finds several mentions in one comment', () => {
    const found = findMentions('@Ravi Kumar and @Anita Sharma, material is short', PEOPLE);

    expect(found.map((m) => m.id)).toEqual(['u2', 'u3']);
  });

  it('is case-insensitive', () => {
    expect(findMentions('@ravi kumar', PEOPLE)[0].id).toBe('u2');
  });

  it('ignores an @ inside an email address', () => {
    expect(findMentions('write to ravi@jaraaglobal.com', PEOPLE)).toEqual([]);
  });

  it('ignores a name nobody on the job has', () => {
    expect(findMentions('@Somebody Else please look', PEOPLE)).toEqual([]);
  });

  it('handles a bare @ and an empty body', () => {
    expect(findMentions('@ ', PEOPLE)).toEqual([]);
    expect(findMentions('', PEOPLE)).toEqual([]);
    expect(findMentions('no mentions here', [])).toEqual([]);
  });

  it('matches a mention followed by punctuation', () => {
    // A comma or a full stop ends the name; both are word boundaries.
    expect(findMentions('@Ravi Kumar, the fixture is ready.', PEOPLE)[0].id).toBe('u2');
    expect(findMentions('ping @Ravi.', PEOPLE)[0].id).toBe('u1');
    expect(findMentions('(@Ravi Kumar)', PEOPLE)[0].id).toBe('u2');
  });
});

describe('mentionedUserIds', () => {
  it('de-duplicates one person mentioned twice', () => {
    // Two mentions, one notification.
    expect(mentionedUserIds('@Ravi Kumar — @Ravi Kumar again', PEOPLE)).toEqual(['u2']);
  });

  it('is empty when nothing resolves', () => {
    expect(mentionedUserIds('nobody here', PEOPLE)).toEqual([]);
  });
});

describe('toSegments', () => {
  it('splits text and mentions in order', () => {
    expect(toSegments('Hi @Ravi Kumar, please check', PEOPLE)).toEqual([
      { kind: 'text', text: 'Hi ' },
      { kind: 'mention', text: '@Ravi Kumar', userId: 'u2' },
      { kind: 'text', text: ', please check' },
    ]);
  });

  it('returns a single text segment when there is no mention', () => {
    expect(toSegments('plain comment', PEOPLE)).toEqual([{ kind: 'text', text: 'plain comment' }]);
  });

  it('returns nothing for an empty body', () => {
    expect(toSegments('', PEOPLE)).toEqual([]);
  });

  it('reassembles to exactly the original text', () => {
    /*
     * The renderer emits these as React nodes, never as HTML — a member's
     * comment is untrusted text. Losing or adding a character here would mean
     * the rendered comment is not what was written.
     */
    const body = '@Ravi Kumar and @Anita Sharma: <script>alert(1)</script> & "quotes"';
    const rebuilt = toSegments(body, PEOPLE)
      .map((segment) => segment.text)
      .join('');

    expect(rebuilt).toBe(body);
  });

  it('leaves an unresolved mention as plain text', () => {
    const segments = toSegments('@Nobody at all', PEOPLE);

    expect(segments).toEqual([{ kind: 'text', text: '@Nobody at all' }]);
  });
});
