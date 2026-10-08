import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';

import { can } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { listDepartments } from '@/lib/services/department-service';
import { listJobTemplates } from '@/lib/services/templates';

import { PageHeader } from '@/components/shared/page-header';

import { SettingsNav } from '../settings-nav';
import { TemplateEditor } from './template-editor';

export const metadata: Metadata = { title: 'Job templates' };
export const dynamic = 'force-dynamic';

/** Job template management (build spec M9.5). */
export default async function TemplatesPage() {
  const session = await requireActiveSession();
  if (!can(session, 'settings:view', undefined)) forbidden();

  const [templates, departments] = await Promise.all([listJobTemplates(), listDepartments()]);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        eyebrow="How the system chases work"
        title="Job templates"
        lead="The standard chain, with each step’s deadline measured backwards from the job’s. One template serves a rush job and a long one — the whole chain compresses with the due date."
      >
        <SettingsNav current="templates" />
      </PageHeader>

      <TemplateEditor
        templates={templates}
        departments={departments.map((d) => ({ id: d.id, name: d.name, code: d.code }))}
        canManage={can(session, 'settings:manage', undefined)}
      />
    </div>
  );
}
