/** Analytics for the MD (build spec M8). */
export { needsAttention, jobsAtRisk, ATTENTION_LIMIT, AT_RISK_LIMIT } from './attention';
export { departmentReport, departmentScorecards } from './departments';
export { kpiCounts, mdDashboard, onTimeAggregate, trendSeries } from './md-dashboard';
export { currentMonth, dayKeysIn, lastDays, parseRange, range, type DateRange } from './range';
export type {
  AttentionProblem,
  AttentionSubtask,
  DepartmentReport,
  DepartmentScorecard,
  JobAtRisk,
  KpiCounts,
  MdDashboard,
  TrendPoint,
} from './types';
