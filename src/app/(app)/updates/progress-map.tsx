'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, Check, Clock3, Circle, UserRound } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/provider';
import type { LiveStage } from '@/lib/live-updates/types';
import { formatIST } from '@/lib/utils/time';
import { cn } from '@/lib/utils';

export const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  PENDING: 'Ready to start',
  BLOCKED: 'Waiting',
  IN_PROGRESS: 'In progress',
  PROBLEM: 'Problem',
  AWAITING_APPROVAL: 'Awaiting approval',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  ON_HOLD: 'On hold',
  AT_RISK: 'At risk',
  DELAYED: 'Delayed',
};
export function ProgressMap({
  stages,
  selected,
  onSelect,
}: {
  stages: LiveStage[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const { t } = useLanguage();
  const root = useRef<HTMLDivElement>(null);
  const marker = 'flow-' + useId().replaceAll(':', '');
  const [paths, setPaths] = useState<{ id: string; d: string; done: boolean }[]>([]);
  const topology = stages
    .map((stage) => `${stage.id}:${stage.dependsOnId}:${stage.status}`)
    .join('|');
  useEffect(() => {
    const container = root.current;
    if (!container) return;
    function measure() {
      const origin = container!.getBoundingClientRect();
      const nodes = new Map(
        Array.from(container!.querySelectorAll<HTMLElement>('[data-stage-id]')).map((node) => [
          node.dataset.stageId!,
          node.getBoundingClientRect(),
        ]),
      );
      const next = stages.flatMap((stage) => {
        if (!stage.dependsOnId) return [];
        const from = nodes.get(stage.dependsOnId);
        const to = nodes.get(stage.id);
        if (!from || !to) return [];
        const x1 = from.left - origin.left + from.width / 2;
        const y1 = from.bottom - origin.top;
        const x2 = to.left - origin.left + to.width / 2;
        const y2 = to.top - origin.top;
        let d: string;
        if (Math.abs(from.top - to.top) < 2) {
          const left = from.right - origin.left;
          const right = to.left - origin.left;
          d = `M ${left} ${y1 - from.height / 2} H ${right - 5}`;
        } else if (to.top - from.bottom < 65) {
          const middle = (y1 + y2) / 2;
          d = `M ${x1} ${y1} V ${middle} H ${x2} V ${y2 - 5}`;
        } else {
          d = `M ${x1} ${y1} V ${y1 + 12} H 6 V ${y2 - 12} H ${x2} V ${y2 - 5}`;
        }
        return [
          {
            id: stage.id,
            d,
            done: stages.find((row) => row.id === stage.dependsOnId)?.status === 'COMPLETED',
          },
        ];
      });
      setPaths((previous) => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next));
    }
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    container.querySelectorAll('[data-stage-id]').forEach((node) => observer.observe(node));
    measure();
    return () => observer.disconnect();
    // Layout observations handle translated text/font changes without restarting the graph.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topology]);
  return (
    <div ref={root} className="live-map-canvas">
      <svg aria-hidden className="live-map-edges">
        <defs>
          <marker
            id={marker}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted-foreground)" />
          </marker>
        </defs>
        {paths.map((path) => (
          <path
            key={path.id}
            d={path.d}
            fill="none"
            stroke={path.done ? 'var(--ok)' : 'var(--border)'}
            strokeWidth="2"
            markerEnd={`url(#${marker})`}
          />
        ))}
      </svg>
      <ol className="live-stage-map" aria-label={t('Department progress map')}>
        {stages.map((stage, index) => {
          const done = stage.status === 'COMPLETED';
          const issue = Boolean(stage.problem) || stage.isOverdue;
          const Icon = done ? Check : issue ? AlertTriangle : stage.current ? Clock3 : Circle;
          const dependency = stages.find((row) => row.id === stage.dependsOnId);
          return (
            <li key={stage.id} className="min-w-0">
              <button
                type="button"
                data-stage-id={stage.id}
                data-current={stage.current}
                aria-pressed={selected === stage.id}
                onClick={() => onSelect(selected === stage.id ? '' : stage.id)}
                className={cn(
                  'live-stage-node',
                  done && 'live-stage-done',
                  issue && 'live-stage-issue',
                )}
              >
                <span className="flex items-start gap-3">
                  <span className="live-stage-symbol">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                      <span className="font-semibold">{stage.department.name}</span>
                      <span className="code text-muted-foreground text-xs">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                    </span>
                    <span className="text-muted-foreground mt-1 block text-xs">
                      {t(STATUS_LABELS[stage.status] ?? stage.status)}
                      {stage.current ? ` · ${t('Current stage')}` : ''}
                    </span>
                  </span>
                </span>
                <span className="mt-3 block text-sm">{stage.title}</span>
                <span className="text-muted-foreground mt-2 flex items-start gap-2 text-xs">
                  <UserRound className="mt-0.5 size-3 shrink-0" aria-hidden />
                  {stage.assignee.name}
                </span>
                {stage.deadline ? (
                  <span
                    className={cn(
                      'mt-2 block text-xs',
                      stage.isOverdue ? 'text-late' : 'text-muted-foreground',
                    )}
                  >
                    {t('Due')} {formatIST(new Date(stage.deadline), 'dd MMM, HH:mm')}
                    {stage.isOverdue ? ` · ${t('Overdue')}` : ''}
                  </span>
                ) : stage.commitmentDueAt && stage.current ? (
                  <span className="text-risk mt-2 block text-xs">
                    {t('Set deadline by')}{' '}
                    {formatIST(new Date(stage.commitmentDueAt), 'dd MMM, HH:mm')}
                  </span>
                ) : null}
                {dependency ? (
                  <span className="text-muted-foreground mt-2 block text-xs">
                    {t('After {{department}}', { department: dependency.department.name })}
                  </span>
                ) : null}
                {stage.problem ? (
                  <span className="text-late mt-2 line-clamp-2 block text-xs">
                    {stage.problem.description}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
