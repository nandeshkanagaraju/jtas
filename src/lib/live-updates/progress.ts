/** Multiple departments may work in parallel. Never invent one owner for them. */
export function currentStageIds(
  stages: readonly { id: string; status: string }[],
  jobStatus: string,
): Set<string> {
  if (['DRAFT', 'COMPLETED', 'CANCELLED', 'ON_HOLD'].includes(jobStatus)) return new Set();
  const open = stages.filter((stage) => !['COMPLETED', 'CANCELLED'].includes(stage.status));
  const working = open.filter((stage) =>
    ['IN_PROGRESS', 'PROBLEM', 'AWAITING_APPROVAL'].includes(stage.status),
  );
  const ready = open.filter((stage) => stage.status === 'PENDING');
  return new Set(
    (working.length ? working : ready.length ? ready : open.slice(0, 1)).map((stage) => stage.id),
  );
}
