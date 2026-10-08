'use client';

import { Loader2, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api/client';
import {
  acknowledgeProblemRequest,
  rejectProblemRequest,
  resolveProblemRequest,
  type ProblemDto,
} from '@/lib/api/problems-client';
import type { UserRow } from '@/lib/api/users-client';
import type { DepartmentSummary } from '@/lib/services/department-service';
import { cn } from '@/lib/utils';
import { formatIST } from '@/lib/utils/time';

import { ProblemAge, SeverityBadge } from './problem-badges';
import { ResolutionForm, type ResolutionDraft } from './resolution-form';

type Mode = 'resolve' | 'reject';

/**
 * The MD's decision drawer — FR-42.
 *
 * Everything needed to decide is here: the member's words verbatim, the
 * subtask's deadline, and the five actions. Nothing requires opening the job.
 */
export function ProblemDrawer({
  problem,
  open,
  onOpenChange,
  departments,
  candidates,
  onResolved,
}: {
  problem: ProblemDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  departments: DepartmentSummary[];
  candidates: UserRow[];
  onResolved: (message: string) => void;
}) {
  const [mode, setMode] = useState<Mode>('resolve');
  const [draft, setDraft] = useState<ResolutionDraft>({ action: 'RESUME', mdActionNote: '' });
  const [rejectNote, setRejectNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  /**
   * Which confirmation the server asked for, if any.
   *
   * Two of the resolution rules warn rather than block — a deadline past the
   * job's own, and an assignee from another department. The server refuses once
   * and names the field it wants; without this the MD would read "confirm with
   * a reason" and have nowhere to put one.
   */
  const [overrideField, setOverrideField] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [busy, setBusy] = useState(false);

  /*
   * Acknowledging does not refresh the `problem` prop — the list behind the
   * drawer refetches, but the selected row is a snapshot taken when it was
   * clicked. Tracked here so "Mark as seen" disappears the moment it succeeds
   * rather than sitting there inviting a second click.
   */
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode('resolve');
    setDraft({ action: 'RESUME', mdActionNote: '' });
    setRejectNote('');
    setError(null);
    setOverrideField(null);
    setOverrideReason('');
    setSeen(false);
  }, [open, problem?.id]);

  if (!problem) return null;

  /**
   * Runs one action against the problem.
   *
   * `close` is false for acknowledging: it is a step on the way to a decision,
   * not the decision, and dismissing the panel there makes the MD reopen it to
   * do the thing they came for.
   */
  async function run(action: () => Promise<unknown>, message: string, close = true) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onResolved(message);
      if (close) onOpenChange(false);
    } catch (caught) {
      if (caught instanceof ApiError) {
        const details = caught.details as { requiresOverride?: string } | undefined;
        if (details?.requiresOverride) {
          // Reveal the field the server named, so the MD can actually confirm.
          setOverrideField(details.requiresOverride);
        }
        setError(caught.message);
      } else {
        setError('Could not reach the server. Try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  const noteTooShort = draft.mdActionNote.trim().length < 5;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2 pr-8">
            <SeverityBadge severity={problem.severity} />
            <span className="code text-sm">{problem.subtask.job.jobCode}</span>
          </SheetTitle>
          <SheetDescription>
            {problem.subtask.department.name} · {problem.subtask.assignee.name} · raised{' '}
            <span className="code">{formatIST(new Date(problem.createdAt))}</span>
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-6">
          {problem.isStale ? (
            <Alert variant="destructive">
              <TriangleAlert className="size-4" />
              <AlertDescription>
                This has been waiting <ProblemAge ageHours={problem.ageHours} isStale /> for a
                decision.
              </AlertDescription>
            </Alert>
          ) : null}

          {error ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {/* The member's words, verbatim (SDD section 5.4). */}
          <div className="space-y-1.5">
            <p className="field-label">What {problem.raisedBy?.name ?? 'the member'} reported</p>
            {/* The member's words, verbatim and unedited (SDD section 5.4). */}
            <blockquote className="border-border bg-muted/50 rounded-md border px-3 py-2.5 text-sm whitespace-pre-wrap">
              {problem.description}
            </blockquote>
          </div>

          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="field-label">Task</dt>
              <dd className="font-medium">{problem.subtask.title}</dd>
            </div>
            <div>
              <dt className="field-label">Current deadline</dt>
              <dd className="code font-medium">
                {problem.subtask.deadline
                  ? formatIST(new Date(problem.subtask.deadline))
                  : 'No date yet'}
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="field-label">Job</dt>
              <dd>
                <Link
                  href={`/jobs/${problem.subtask.job.id}`}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {problem.subtask.job.title}
                </Link>
                {problem.subtask.job.partNumber ? (
                  <span className="text-muted-foreground"> · {problem.subtask.job.partNumber}</span>
                ) : null}
              </dd>
            </div>
          </dl>

          {problem.status === 'OPEN' && !seen ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                run(
                  async () => {
                    await acknowledgeProblemRequest(problem.id);
                    setSeen(true);
                  },
                  'Marked as seen.',
                  false,
                )
              }
            >
              Mark as seen
            </Button>
          ) : null}

          <Separator />

          {/*
            Two toggle buttons rather than a radio group: they stay buttons for
            anyone reading the page by role, and `aria-pressed` carries which
            one is chosen.
          */}
          <div
            role="group"
            aria-label="What to do with this report"
            className="border-border bg-muted inline-flex rounded-md border p-0.5"
          >
            {(['resolve', 'reject'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                disabled={busy}
                onClick={() => setMode(value)}
                className={cn(
                  'rounded-[5px] px-3 py-1.5 text-sm font-medium transition-colors',
                  mode === value
                    ? 'bg-card text-foreground border-border border'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {value === 'resolve' ? 'Resolve it' : 'Not a problem'}
              </button>
            ))}
          </div>

          {mode === 'resolve' ? (
            <>
              <ResolutionForm
                draft={draft}
                onChange={setDraft}
                departments={departments}
                candidates={candidates}
                currentDeadline={
                  problem.subtask.deadline
                    ? formatIST(new Date(problem.subtask.deadline))
                    : 'No date yet'
                }
                busy={busy}
              />

              {overrideField ? (
                <div className="border-risk-edge bg-risk-soft space-y-1.5 rounded-lg border p-3">
                  <Label className="text-risk text-xs font-medium">
                    Confirm the exception <span aria-hidden>*</span>
                    <span className="sr-only">(required)</span>
                  </Label>
                  <Textarea
                    value={overrideReason}
                    onChange={(event) => setOverrideReason(event.target.value)}
                    rows={2}
                    maxLength={500}
                    placeholder="Why this is correct anyway — it goes on the record."
                    disabled={busy}
                  />
                </div>
              ) : null}

              <Button
                className="w-full"
                disabled={
                  busy ||
                  noteTooShort ||
                  (overrideField !== null && overrideReason.trim().length < 5)
                }
                onClick={() =>
                  run(
                    () =>
                      resolveProblemRequest(problem.id, {
                        ...draft,
                        // The server names which confirmation it wants; send it
                        // back under exactly that key.
                        ...(overrideField && overrideReason.trim()
                          ? { [overrideField]: overrideReason.trim() }
                          : {}),
                      } as never),
                    'Problem resolved.',
                  )
                }
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                Resolve
              </Button>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs">
                  Why is this not a problem? <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  value={rejectNote}
                  onChange={(event) => setRejectNote(event.target.value)}
                  rows={3}
                  maxLength={2000}
                  placeholder="The member sees this. A bare rejection teaches people to stop reporting."
                  disabled={busy}
                />
              </div>

              <Button
                variant="destructive"
                className="w-full"
                disabled={busy || rejectNote.trim().length < 5}
                onClick={() =>
                  run(
                    () => rejectProblemRequest(problem.id, { note: rejectNote.trim() }),
                    'Sent back to the member.',
                  )
                }
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                Send it back
              </Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
