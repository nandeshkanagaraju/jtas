import { T } from '@/lib/i18n/provider';

import { LocalizedElement } from '@/lib/i18n/provider';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

const STEPS = ['Job details', 'Department plan', 'Review & publish'];

export function WorkflowSteps({ current }: { current: number }) {
  return (
    <LocalizedElement as="ol" aria-label="Job creation progress" className="workflow-steps">
      {STEPS.map((label, index) => {
        const number = index + 1;
        return (
          <li
            key={label}
            data-active={number === current}
            data-done={number < current}
            aria-current={number === current ? 'step' : undefined}
            className="workflow-step"
          >
            <span
              className={cn(
                'flex items-center gap-2 text-xs sm:text-sm',
                number === current ? 'text-action font-medium' : 'text-muted-foreground',
              )}
            >
              <span
                className={cn(
                  'inline-flex size-6 shrink-0 items-center justify-center rounded-md font-mono text-xs',
                  number === current
                    ? 'bg-primary text-primary-foreground'
                    : number < current
                      ? 'bg-ok-soft text-ok'
                      : 'bg-muted',
                )}
              >
                {number < current ? (
                  <Check className="size-3.5" aria-label="Complete" />
                ) : (
                  `0${number}`
                )}
              </span>
              <T>{label}</T>
            </span>
          </li>
        );
      })}
    </LocalizedElement>
  );
}
