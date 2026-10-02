/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ActivityFeed } from '@/components/collaboration/activity-feed';
import { SubtaskDrawer } from '@/app/(app)/jobs/[id]/subtask-drawer';
import type { SubtaskDto } from '@/lib/api/subtasks-client';

const { apiFetch, assign } = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  assign: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({
  apiFetch,
  ApiError: class ApiError extends Error {},
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const FILE = '127018025_KNandesh.pdf';
const DOWNLOAD =
  'https://files.13-127-170-245.sslip.io/jtas-attachments/report.pdf?X-Amz-Signature=test';

const subtask = {
  id: 'sub-1',
  jobId: 'job-1',
  jobCode: 'JGE-2026-0001',
  jobTitle: 'Bearing cap',
  partNumber: null,
  drawingNumber: null,
  quantity: null,
  department: { id: 'dept-q', name: 'Quality', code: 'QUALITY', sequenceOrder: 5 },
  assignee: { id: 'member-1', name: 'Production Member', email: 'p@example.com', isActive: true },
  title: 'Inspection',
  description: null,
  deadline: '2026-10-02T10:30:00.000Z',
  reminderLeadMinutes: 360,
  requiresApproval: false,
  dependsOn: null,
  status: 'COMPLETED',
  startedAt: '2026-10-02T04:00:00.000Z',
  completedAt: '2026-10-02T04:40:00.000Z',
  completionNote: null,
  escalationCount: 0,
  isOverdue: false,
  exceedsJobDeadline: false,
  openProblem: null,
  createdAt: '2026-10-02T03:00:00.000Z',
  updatedAt: '2026-10-02T04:40:00.000Z',
} as SubtaskDto;

beforeEach(() => {
  assign.mockReset();
  apiFetch.mockReset();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { assign },
  });

  apiFetch.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/attachments?')) {
      return {
        data: [
          {
            id: 'att-1',
            fileName: FILE,
            mimeType: 'application/pdf',
            sizeBytes: 2048,
            createdAt: '2026-10-02T04:30:00.000Z',
            jobId: 'job-1',
            subtaskId: 'sub-1',
            uploadedBy: { id: 'member-1', name: 'Production Member' },
            previewable: false,
            label: 'PDF',
          },
        ],
      };
    }

    if (path.includes('/comments')) {
      return {
        data: [
          {
            id: 'comment-1',
            body: 'Inspection passed',
            createdAt: '2026-10-02T04:31:00.000Z',
            author: { id: 'member-1', name: 'Production Member', email: 'p@example.com' },
          },
        ],
        mentionCandidates: [],
      };
    }

    if (path === '/api/attachments/att-1/url') {
      return { url: DOWNLOAD };
    }

    if (path.startsWith('/api/jobs/job-1/activity')) {
      return {
        data: [
          {
            id: 'audit-1',
            at: '2026-10-02T04:30:00.000Z',
            kind: 'attachment',
            action: 'ATTACHMENT_ADDED',
            actor: { id: 'member-1', name: 'Production Member' },
            subtask: { id: 'sub-1', title: 'Inspection', department: 'Quality' },
            body: FILE,
            changes: [],
            attachmentId: 'att-1',
          },
        ],
      };
    }

    throw new Error(`unexpected ${path}`);
  });
});

describe('MD collaboration', () => {
  it('shows a completed subtask’s files and comments in the drawer, and downloads the file', async () => {
    render(
      <SubtaskDrawer
        subtask={subtask}
        open
        onOpenChange={() => undefined}
        candidates={[]}
        currentUserId="md-1"
        onChanged={() => undefined}
      />,
    );

    expect(await screen.findByText(FILE)).toBeTruthy();
    expect(screen.getByText(/2 KB · Production Member/)).toBeTruthy();
    expect(screen.getByText('Inspection passed')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open the full task' }).getAttribute('href')).toBe(
      '/tasks/sub-1',
    );
    expect(screen.getByPlaceholderText(/Add a note/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: `Download ${FILE}` }));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/api/attachments/att-1/url');
      expect(assign).toHaveBeenCalledWith(DOWNLOAD);
    });
  });

  it('downloads when the MD clicks a filename in the activity feed', async () => {
    render(<ActivityFeed jobId="job-1" currentUserId="md-1" />);

    fireEvent.click(await screen.findByRole('button', { name: FILE }));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/api/attachments/att-1/url');
      expect(assign).toHaveBeenCalledWith(DOWNLOAD);
    });
  });
});
