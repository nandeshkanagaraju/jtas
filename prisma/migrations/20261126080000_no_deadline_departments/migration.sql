-- Store, QA and Accounts no longer work to a deadline (department-rules.ts).
-- Open tasks in those departments lose their date and commitment window, and
-- their still-pending reminders and chases are withdrawn. Closed tasks keep
-- their history.

UPDATE "Notification" n
   SET "status" = 'SUPPRESSED',
       "lastError" = 'Withdrawn: this department no longer works to a deadline.'
  FROM "Subtask" s
  JOIN "Department" d ON d."id" = s."departmentId"
 WHERE n."entityType" = 'SUBTASK'
   AND n."entityId" = s."id"
   AND n."status" = 'PENDING'
   AND n."type" IN ('DEADLINE_REMINDER', 'OVERDUE_MEMBER', 'OVERDUE_MD', 'COMMITMENT_OPEN',
                    'COMMITMENT_REMINDER', 'COMMITMENT_MISSED_MEMBER', 'COMMITMENT_MISSED_MD')
   AND d."code" IN ('STORE', 'QA', 'ACCOUNTS')
   AND s."status" NOT IN ('COMPLETED', 'CANCELLED');

UPDATE "Subtask" s
   SET "deadline" = NULL,
       "deadlineOrigin" = NULL,
       "commitmentDueAt" = NULL,
       "commitmentEscalationCount" = 0,
       "commitmentLastEscalatedAt" = NULL,
       "escalationCount" = 0,
       "lastEscalatedAt" = NULL
  FROM "Department" d
 WHERE d."id" = s."departmentId"
   AND d."code" IN ('STORE', 'QA', 'ACCOUNTS')
   AND s."status" NOT IN ('COMPLETED', 'CANCELLED');
