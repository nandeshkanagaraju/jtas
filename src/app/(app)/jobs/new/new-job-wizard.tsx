'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { JobForm } from '@/app/(app)/jobs/components/job-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { createJobRequest } from '@/lib/api/jobs-client';
import { cn } from '@/lib/utils';
import type { CreateJobInput } from '@/lib/validation/job';

const STEPS = [
  { n: 1, label: 'Details' },
  { n: 2, label: 'Subtasks' },
  { n: 3, label: 'Review' },
] as const;

/** Shows where the MD is in the create flow, and what is still to come. */
function Steps({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-2 text-sm">
      {STEPS.map((step, index) => (
        <li key={step.n} className="flex items-center gap-2">
          <span
            className={cn(
              'flex size-6 items-center justify-center rounded-full text-xs font-medium',
              step.n === current
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {step.n}
          </span>
          <span className={step.n === current ? 'font-medium' : 'text-muted-foreground'}>
            {step.label}
          </span>
          {index < STEPS.length - 1 ? <span className="text-muted-foreground">·</span> : null}
        </li>
      ))}
    </ol>
  );
}

/**
 * Step 1 of the job wizard.
 *
 * Saving creates the job as a `DRAFT` and routes to its detail page, which is
 * where step 2 lands when M4 adds subtasks. Creating the draft now rather than
 * holding the whole wizard in memory means a half-finished job survives a
 * closed tab or a dropped connection.
 */
export function NewJobWizard() {
  const router = useRouter();

  async function handleSubmit(values: CreateJobInput) {
    const { job } = await createJobRequest(values);
    router.push(`/jobs/${job.id}?created=1`);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/jobs">
            <ArrowLeft className="size-4" />
            All jobs
          </Link>
        </Button>

        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">New job</h1>
          <p className="text-muted-foreground text-sm">
            The job is saved as a draft. Nobody is notified until you publish it.
          </p>
        </div>

        <Steps current={1} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Job details</CardTitle>
          <CardDescription>
            Only the title and the overall deadline are required — the rest can be filled in while
            the job is still a draft.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <JobForm
            submitLabel="Save draft and continue"
            onSubmit={handleSubmit}
            onCancel={() => router.push('/jobs')}
          />
        </CardContent>
      </Card>
    </div>
  );
}
