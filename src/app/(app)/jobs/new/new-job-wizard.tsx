'use client';

import { useRouter } from 'next/navigation';

import { JobForm } from '@/app/(app)/jobs/components/job-form';
import { PageHeader } from '@/components/shared/page-header';
import { Panel } from '@/components/shared/panel';
import { createJobRequest } from '@/lib/api/jobs-client';
import { WorkflowSteps } from '@/components/shared/workflow-steps';
import type { CreateJobInput } from '@/lib/validation/job';

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
    <div className="w-full space-y-5">
      <PageHeader
        back={{ href: '/jobs', label: 'All jobs' }}
        eyebrow="Step 1 of 3"
        title="New job"
        lead="The job is saved as a draft. Nobody is notified until you publish it."
      >
        <WorkflowSteps current={1} />
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
