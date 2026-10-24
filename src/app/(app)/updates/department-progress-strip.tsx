'use client';

import { Check } from 'lucide-react';
import { usePhoneApp } from '@/components/shared/phone-app';
import { topologicalOrder } from '@/lib/domain/subtask-dependencies';
import { useLanguage } from '@/lib/i18n/provider';
import type { LiveStage } from '@/lib/live-updates/types';
import { cn } from '@/lib/utils';
import { STATUS_LABELS } from './progress-map';

const CODES: Record<string, string> = {
  PRODUCTION: 'PRD',
  PLANNING: 'PLN',
  PURCHASE: 'PUR',
  STORE: 'STR',
  QUALITY: 'QLY',
  DISPATCH: 'DSP',
  ACCOUNTS: 'ACC',
  HR: 'HR',
};

/** A glanceable overview; the full map and its actions remain below it. */
export function DepartmentProgressStrip({
  stages,
  jobStatus,
}: {
  stages: LiveStage[];
  jobStatus: string;
}) {
  const phone = usePhoneApp();
  const { t } = useLanguage();
  if (!phone || !stages.length) return null;

  // Follow real dependencies, including Production-first jobs and parallel work.
  const byId = new Map(stages.map((stage) => [stage.id, stage]));
  const ordered = topologicalOrder(stages).map((node) => byId.get(node.id)!);
  const inactiveJob = ['DRAFT', 'ON_HOLD', 'CANCELLED', 'COMPLETED'].includes(jobStatus);
  const current = ordered.filter(
    (stage) =>
      !inactiveJob &&
      stage.current &&
      ['PENDING', 'IN_PROGRESS', 'PROBLEM', 'AWAITING_APPROVAL'].includes(stage.status),
  );
  const currentIds = new Set(current.map((stage) => stage.id));
  const next = ordered.filter(
    (stage) => stage.status === 'BLOCKED' && stage.dependsOnId && currentIds.has(stage.dependsOnId),
  );
  const completed = stages.filter((stage) => stage.status === 'COMPLETED').length;

  return (
    <section className="phone-department-progress" aria-label={t('Department progress summary')}>
      <p className="text-muted-foreground text-xs">
        {t('{{done}} of {{total}} tasks complete', { done: completed, total: stages.length })}
      </p>
      <ol
        className="phone-department-track"
        style={{ gridTemplateColumns: `repeat(${Math.min(8, stages.length)}, minmax(0, 1fr))` }}
        aria-label={t('Department route')}
      >
        {ordered.map((stage) => {
          const done = stage.status === 'COMPLETED';
          const active = currentIds.has(stage.id);
          const issue =
            !done &&
            stage.status !== 'CANCELLED' &&
            (stage.isOverdue || Boolean(stage.problem) || stage.status === 'PROBLEM');
          return (
            <li key={stage.id} aria-current={active ? 'step' : undefined}>
              <span
                aria-hidden
                className={cn(
                  'phone-department-segment',
                  done && 'phone-department-done',
                  active && 'phone-department-current',
                  issue && 'phone-department-issue',
                )}
              >
                {done ? <Check className="size-3" /> : null}
              </span>
              <span aria-hidden className="mt-1 block text-center font-mono text-[10px]">
                {CODES[stage.department.code] ?? stage.department.code.slice(0, 3)}
              </span>
              <span className="sr-only">
                {t(stage.department.name)}: {t(STATUS_LABELS[stage.status] ?? stage.status)}
                {stage.isOverdue ? ` · ${t('Overdue')}` : ''}
              </span>
            </li>
          );
        })}
      </ol>
      {current.length ? (
        <div className="mt-3 space-y-2">
          {current.map((stage) => (
            <p key={stage.id} className="text-sm">
              <span className="text-muted-foreground">{t('Current stage')}: </span>
              <strong className="font-semibold">{t(stage.department.name)}</strong>
              {' · '}
              {t(STATUS_LABELS[stage.status] ?? stage.status)}
              {stage.isOverdue ? <span className="text-late"> · {t('Overdue')}</span> : null}
              <span className="text-muted-foreground mt-1 block text-xs">
                {stage.assignee.name}
              </span>
            </p>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm">
          {t(
            jobStatus === 'COMPLETED'
              ? 'All departments finished'
              : jobStatus === 'ON_HOLD'
                ? 'Job on hold'
                : jobStatus === 'DRAFT' || jobStatus === 'CANCELLED'
                  ? STATUS_LABELS[jobStatus]
                  : 'No active department',
          )}
        </p>
      )}
      {next.map((stage) => (
        <p key={stage.id} className="mt-2 text-sm">
          <span className="text-muted-foreground">
            {t('Next after {{department}}', {
              department: t(byId.get(stage.dependsOnId!)!.department.name),
            })}
            :{' '}
          </span>
          {t(stage.department.name)}
        </p>
      ))}
    </section>
  );
}
