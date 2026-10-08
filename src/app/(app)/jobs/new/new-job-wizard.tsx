'use client';

import { useRouter } from 'next/navigation';

import { JobForm } from '@/app/(app)/jobs/components/job-form';
import { PageHeader } from '@/components/shared/page-header';
import { Panel } from '@/components/shared/panel';
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
    <ol className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      {STEPS.map((step, index) => {
        const done = step.n < current;
        const here = step.n === current;

        return (
          <li key={step.n} className="flex items-center gap-2">
            <span
              aria-hidden
              className={cn(
                'flex size-6 items-center justify-center rounded-full border-2 font-mono text-[11px] font-medium tabular-nums',
                here
                  ? 'border-primary bg-primary text-primary-foreground'
                  : done
                    ? 'border-ok text-ok'
                    : 'border-border text-muted-foreground',
              )}
            >
              {step.n}
            </span>
            <span className={here ? 'font-medium' : 'text-muted-foreground'}>
              {step.label}
              {here ? <span className="sr-only"> (current step)</span> : null}
            </span>
            {index < STEPS.length - 1 ? (
              <span aria-hidden className="bg-border hidden h-px w-6 sm:block" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Step 1 of the job wizard.
 *
 * Saving creates the job as a `DRAFT` and routes to step 2. Creating the draft
 * now rather than holding the whole wizard in memory means a half-finished job
 * survives a closed tab or a dropped connection — and the MD can come back to
 * `/jobs/{id}/plan` to finish it.
 */
export function NewJobWizard() {
  const router = useRouter();

  async function handleSubmit(values: CreateJobInput) {
    const { job } = await createJobRequest(values);
    router.push(`/jobs/${job.id}/plan`);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        back={{ href: '/jobs', label: 'All jobs' }}
        eyebrow="Step 1 of 3"
        title="New job"
        lead="The job is saved as a draft. Nobody is notified until you publish it."
      >
        <Steps current={1} />
      </PageHeader>

      <Panel
        title="Job details"
        description="Only the title and the overall deadline are required — the rest can be filled in while the job is still a draft."
      >
        <JobForm
          submitLabel="Save draft and continue"
          onSubmit={handleSubmit}
          onCancel={() => router.push('/jobs')}
        />
      </Panel>
    </div>
  );
}
