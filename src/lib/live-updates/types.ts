import type { ActivityItem } from '@/lib/services/activity-feed';

export type UpdateKind = 'all' | 'messages' | 'workflow' | 'issues' | 'files';
export interface LiveJobRow {
  id: string;
  jobCode: string;
  title: string;
  status: string;
  priority: string;
  overallDeadline: string;
  progress: { completed: number; total: number; percent: number };
  currentDepartments: string[];
  openProblems: number;
}
export interface LiveJobList {
  data: LiveJobRow[];
  total: number;
  page: number;
  pageSize: number;
}
export interface LiveStage {
  id: string;
  title: string;
  department: { id: string; code: string; name: string; sequenceOrder: number };
  assignee: { id: string; name: string };
  status: string;
  deadline: string | null;
  commitmentDueAt: string | null;
  completedAt: string | null;
  dependsOnId: string | null;
  isOverdue: boolean;
  current: boolean;
  problem: { description: string; severity: string } | null;
  canComment: boolean;
}
export interface LiveJobDetail {
  job: LiveJobRow & { partNumber: string | null; quantity: number | null };
  stages: LiveStage[];
  events: ActivityItem[];
  nextCursor: string | null;
  checkedAt: string;
}
