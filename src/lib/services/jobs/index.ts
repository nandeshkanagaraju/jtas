/**
 * Public surface of the job service.
 *
 * Route handlers import from `@/lib/services/jobs` and never reach into a file
 * below it, so the internal split can change without touching the API.
 */
export { listJobs, getJob, loadJobForWrite, visibilityFilter, type JobListResult } from './queries';
export { createJob, updateJob, parseJobDeadline } from './mutations';
export { publishJob, holdJob, unholdJob, cancelJob } from './lifecycle';
export { recomputeJobStatus, type RecomputeResult } from './status';
export { allocateJobCode } from './job-code';
export {
  JOB_SELECT,
  EDITABLE_AFTER_PUBLISH,
  toJobSummary,
  jobSnapshot,
  type Actor,
  type JobRow,
  type JobSummary,
  type RequestContext,
} from './types';
