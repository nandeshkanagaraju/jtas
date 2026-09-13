/** Shapes returned by the analytics endpoints (build spec M8.1 and M8.2). */

export interface KpiCounts {
  activeJobs: number;
  atRiskJobs: number;
  delayedJobs: number;
  completedThisMonth: number;
  overdueSubtasks: number;
  openProblems: number;
  /** Of the open problems, how many have been waiting more than a day. */
  openProblemsOlderThan24h: number;
}

/** One day of the trend chart. */
export interface TrendPoint {
  /** IST calendar day, `YYYY-MM-DD`. */
  day: string;
  onTime: number;
  late: number;
}

/** A problem the MD has not dealt with yet. */
export interface AttentionProblem {
  id: string;
  subtaskId: string;
  jobId: string;
  jobCode: string;
  subtaskTitle: string;
  departmentName: string;
  assigneeName: string;
  severity: string;
  status: string;
  description: string;
  raisedAt: string;
  ageHours: number;
}

/** A subtask that has blown its deadline. */
export interface AttentionSubtask {
  id: string;
  jobId: string;
  jobCode: string;
  title: string;
  departmentName: string;
  assigneeName: string;
  deadline: string;
  overdueHours: number;
  status: string;
  escalationCount: number;
}

/** A job that is late or about to be, and who is holding it up. */
export interface JobAtRisk {
  id: string;
  jobCode: string;
  title: string;
  status: string;
  overallDeadline: string;
  /** The department of the subtask furthest past its deadline. */
  blockingDepartment: string | null;
  blockingSubtaskTitle: string | null;
  overdueSubtasks: number;
  openProblems: number;
}

export interface MdDashboard {
  range: { from: string; to: string };
  kpis: KpiCounts;
  onTimeCompletionPercent: number | null;
  averageDelayHours: number;
  completedInRange: number;
  trend: TrendPoint[];
  attention: {
    problems: AttentionProblem[];
    overdueSubtasks: AttentionSubtask[];
  };
  jobsAtRisk: JobAtRisk[];
}

/** One department's record over a range. */
export interface DepartmentScorecard {
  departmentId: string;
  code: string;
  name: string;
  onTimePercent: number | null;
  averageDelayHours: number;
  subtasksCompleted: number;
  onTime: number;
  late: number;
  currentOpen: number;
  problemsRaised: number;
  /**
   * Problems on a subtask that at least one other subtask was waiting on —
   * where this department's trouble became somebody else's delay.
   */
  problemsAsRootCause: number;
  /** Times a deadline in this department was moved (improvement I-11). */
  extensionCount: number;
}

export interface DepartmentReport {
  range: { from: string; to: string };
  department: DepartmentScorecard;
  /** The same range across every department, for context. */
  comparison: DepartmentScorecard[];
}
