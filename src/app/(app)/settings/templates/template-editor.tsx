'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AlertTriangle, Archive, ArrowDown, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, apiFetch } from '@/lib/api/client';
import type { TemplateSummary } from '@/lib/services/templates';
import { cn } from '@/lib/utils';

interface Department {
  id: string;
  name: string;
  code: string;
}

interface Step {
  departmentId: string;
  title: string;
  offsetHoursBeforeDue: number;
  reminderLeadMinutes: number;
  dependsOnItemOrder: number | null;
}

function toSteps(template: TemplateSummary): Step[] {
  return template.items.map((item) => ({
    departmentId: item.department.id,
    title: item.title,
    offsetHoursBeforeDue: item.offsetHoursBeforeDue,
    reminderLeadMinutes: item.reminderLeadMinutes,
    dependsOnItemOrder: item.dependsOnItemOrder,
  }));
}

/** "10 days before" reads better than "240 hours before". */
function offsetLabel(hours: number): string {
  if (hours === 0) return 'on the job deadline';
  if (hours % 24 === 0) return `${hours / 24} day${hours / 24 === 1 ? '' : 's'} before`;
  return `${hours} h before`;
}

export function TemplateEditor({
  templates,
  departments,
  canManage,
}: {
  templates: TemplateSummary[];
  departments: Department[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(templates[0]?.id ?? null);
  const [name, setName] = useState(templates[0]?.name ?? '');
  const [steps, setSteps] = useState<Step[]>(templates[0] ? toSteps(templates[0]) : []);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);

  function load(template: TemplateSummary | null) {
    setSelected(template?.id ?? null);
    setName(template?.name ?? '');
    setSteps(template ? toSteps(template) : []);
    setErrors({});
  }

  function patch(index: number, changes: Partial<Step>) {
    setSteps((current) => current.map((step, i) => (i === index ? { ...step, ...changes } : step)));
  }

  function removeStep(index: number) {
    setSteps((current) =>
      current
        .filter((_, i) => i !== index)
        .map((step) => ({
          ...step,
          // A dependency pointing past the removed step slides down with it;
          // one pointing *at* it is cleared rather than silently re-aimed.
          dependsOnItemOrder:
            step.dependsOnItemOrder === null
              ? null
              : step.dependsOnItemOrder === index
                ? null
                : step.dependsOnItemOrder > index
                  ? step.dependsOnItemOrder - 1
                  : step.dependsOnItemOrder,
        })),
    );
  }

  async function save() {
    setBusy(true);
    setErrors({});

    const body = { name, items: steps };

    try {
      const path = selected ? `/api/job-templates/${selected}` : '/api/job-templates';
      const result = await apiFetch<{ data: TemplateSummary }>(path, {
        method: selected ? 'PUT' : 'POST',
        body: JSON.stringify(body),
      });

      toast.success(`${result.data.name} saved. Existing jobs are unchanged.`);
      router.refresh();
      load(result.data);
    } catch (error) {
      if (error instanceof ApiError && error.fields) {
        setErrors(error.fields);
        toast.error(error.message);
      } else {
        toast.error(error instanceof Error ? error.message : 'Could not save.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (!selected) return;
    setBusy(true);

    try {
      await apiFetch(`/api/job-templates/${selected}`, { method: 'DELETE' });
      toast.success('Archived. Jobs already created from it are unaffected.');
      router.refresh();
      load(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not archive.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
      <aside className="space-y-2">
        <ul className="divide-y rounded-lg border">
          {templates.map((template) => (
            <li key={template.id}>
              <button
                type="button"
                onClick={() => load(template)}
                className={cn(
                  'hover:bg-accent/40 w-full px-3 py-2.5 text-left transition-colors',
                  template.id === selected && 'bg-accent/60',
                )}
              >
                <p className="text-sm font-medium">{template.name}</p>
                <p className="text-muted-foreground text-xs">
                  {template.items.length} step{template.items.length === 1 ? '' : 's'}
                </p>
              </button>
            </li>
          ))}

          {templates.length === 0 ? (
            <li className="text-muted-foreground px-3 py-6 text-center text-sm">
              No templates yet.
            </li>
          ) : null}
        </ul>

        {canManage ? (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              load(null);
              setName('New template');
              setSteps([
                {
                  departmentId: departments[0]?.id ?? '',
                  title: 'First step',
                  offsetHoursBeforeDue: 240,
                  reminderLeadMinutes: 360,
                  dependsOnItemOrder: null,
                },
              ]);
            }}
          >
            <Plus className="size-4" />
            New template
          </Button>
        ) : null}
      </aside>

      <div className="space-y-4">
        <div className="border-state-problem/30 bg-state-problem/5 flex items-start gap-2 rounded-lg border p-3">
          <AlertTriangle className="text-state-problem mt-px size-4 shrink-0" />
          <p className="text-sm">
            A template is a recipe. Editing it changes how <em>future</em> jobs are laid out and
            never touches a job that already exists — those chains stay exactly as they were
            created, deadlines included.
          </p>
        </div>

        {steps.length === 0 && !selected ? (
          <p className="text-muted-foreground rounded-lg border py-16 text-center text-sm">
            Choose a template, or create one.
          </p>
        ) : (
          <>
            <div className="rounded-lg border p-4">
              <Label htmlFor="template-name" className="text-sm font-medium">
                Template name
              </Label>
              <Input
                id="template-name"
                value={name}
                disabled={!canManage}
                className="mt-1.5 max-w-sm"
                onChange={(event) => setName(event.target.value)}
              />
              {errors.name?.map((problem) => (
                <p key={problem} className="text-state-overdue mt-1 text-xs">
                  {problem}
                </p>
              ))}
            </div>

            <section className="rounded-lg border">
              <header className="flex items-center justify-between border-b px-4 py-3">
                <h2 className="text-sm font-semibold">Chain ({steps.length})</h2>
                <p className="text-muted-foreground text-xs">
                  Offsets run backwards from the job’s overall deadline.
                </p>
              </header>

              <ol className="divide-y">
                {steps.map((step, index) => (
                  <li key={index} className="space-y-2 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="bg-muted tabular flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium">
                        {index + 1}
                      </span>

                      <Input
                        value={step.title}
                        disabled={!canManage}
                        className="h-8 min-w-48 flex-1 text-sm"
                        onChange={(event) => patch(index, { title: event.target.value })}
                      />

                      {canManage ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeStep(index)}
                          aria-label={`Remove step ${index + 1}`}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      ) : null}
                    </div>

                    <div className="grid gap-2 pl-8 sm:grid-cols-3">
                      <select
                        aria-label={`Department for step ${index + 1}`}
                        value={step.departmentId}
                        disabled={!canManage}
                        onChange={(event) => patch(index, { departmentId: event.target.value })}
                        className="border-input bg-background h-8 rounded-md border px-2 text-sm"
                      >
                        {departments.map((department) => (
                          <option key={department.id} value={department.id}>
                            {department.name}
                          </option>
                        ))}
                      </select>

                      <div className="flex items-center gap-1.5">
                        <Input
                          type="number"
                          aria-label={`Hours before the deadline for step ${index + 1}`}
                          value={String(step.offsetHoursBeforeDue)}
                          disabled={!canManage}
                          className="tabular h-8 w-20 text-sm"
                          onChange={(event) =>
                            patch(index, { offsetHoursBeforeDue: Number(event.target.value) })
                          }
                        />
                        <span className="text-muted-foreground text-xs">
                          {offsetLabel(step.offsetHoursBeforeDue)}
                        </span>
                      </div>

                      <select
                        aria-label={`Waits for, step ${index + 1}`}
                        value={
                          step.dependsOnItemOrder === null ? '' : String(step.dependsOnItemOrder)
                        }
                        disabled={!canManage}
                        onChange={(event) =>
                          patch(index, {
                            dependsOnItemOrder:
                              event.target.value === '' ? null : Number(event.target.value),
                          })
                        }
                        className="border-input bg-background h-8 rounded-md border px-2 text-sm"
                      >
                        <option value="">Waits for nothing</option>
                        {/* Only earlier steps: the offsets run backwards, so a
                            step waiting on a later one would need to finish
                            before the thing it depends on starts. */}
                        {steps.slice(0, index).map((earlier, i) => (
                          <option key={i} value={i}>
                            Waits for {i + 1}. {earlier.title.slice(0, 28)}
                          </option>
                        ))}
                      </select>
                    </div>

                    {Object.entries(errors)
                      .filter(([field]) => field.startsWith(`items.${index}.`))
                      .flatMap(([field, problems]) =>
                        problems.map((problem) => (
                          <p
                            key={`${field}-${problem}`}
                            className="text-state-overdue pl-8 text-xs"
                          >
                            {problem}
                          </p>
                        )),
                      )}
                  </li>
                ))}
              </ol>

              {canManage ? (
                <div className="border-t px-4 py-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setSteps((current) => [
                        ...current,
                        {
                          departmentId: departments[0]?.id ?? '',
                          title: 'New step',
                          offsetHoursBeforeDue: Math.max(
                            0,
                            (current.at(-1)?.offsetHoursBeforeDue ?? 240) - 48,
                          ),
                          reminderLeadMinutes: 360,
                          dependsOnItemOrder: current.length > 0 ? current.length - 1 : null,
                        },
                      ])
                    }
                  >
                    <Plus className="size-4" />
                    Add step
                  </Button>
                </div>
              ) : null}
            </section>

            <DependencyPreview steps={steps} departments={departments} />

            {canManage ? (
              <div className="flex flex-wrap gap-2">
                <Button onClick={save} disabled={busy || steps.length === 0}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  {selected ? 'Save template' : 'Create template'}
                </Button>

                {selected ? (
                  <Button variant="outline" onClick={archive} disabled={busy}>
                    <Archive className="size-4" />
                    Archive
                  </Button>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/** The chain drawn as a chain (build spec M9.5). */
function DependencyPreview({ steps, departments }: { steps: Step[]; departments: Department[] }) {
  const nameOf = (id: string) => departments.find((d) => d.id === id)?.name ?? 'Unassigned';

  return (
    <section className="rounded-lg border">
      <header className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold">What a job from this template looks like</h2>
        <p className="text-muted-foreground mt-0.5 text-xs">
          A step that waits for another starts BLOCKED until that one is complete.
        </p>
      </header>

      <ol className="space-y-1 p-4">
        {steps.map((step, index) => (
          <li key={index}>
            {index > 0 ? (
              <div className="text-muted-foreground flex items-center gap-1 py-0.5 pl-3 text-xs">
                <ArrowDown className="size-3" />
                {step.dependsOnItemOrder === null
                  ? 'independent — can run in parallel'
                  : `waits for step ${step.dependsOnItemOrder + 1}`}
              </div>
            ) : null}

            <div
              className={cn(
                'flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm',
                step.dependsOnItemOrder !== null && 'border-state-blocked/40 bg-muted/40',
              )}
            >
              <span className="tabular text-muted-foreground text-xs">{index + 1}</span>
              <span className="font-medium">{nameOf(step.departmentId)}</span>
              <span className="text-muted-foreground truncate">{step.title}</span>
              <span className="text-muted-foreground tabular ml-auto text-xs">
                {offsetLabel(step.offsetHoursBeforeDue)}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
