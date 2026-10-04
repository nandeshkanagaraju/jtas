-- Sequential commitment (PDD 14.2).
-- A new subtask may have no deadline. One that already has a deadline is committed.

ALTER TABLE "Subtask" ALTER COLUMN "deadline" DROP NOT NULL;

CREATE TYPE "DeadlineOrigin" AS ENUM ('DEPARTMENT', 'MD');

ALTER TABLE "Subtask" ADD COLUMN "deadlineOrigin" "DeadlineOrigin";
ALTER TABLE "Subtask" ADD COLUMN "commitmentDueAt" TIMESTAMP(3);
ALTER TABLE "Subtask" ADD COLUMN "commitmentEscalationCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Subtask" ADD COLUMN "commitmentLastEscalatedAt" TIMESTAMP(3);

-- Existing dates were set before departments committed their own. They stay
-- dates, and they read as committed rather than as a blank.
UPDATE "Subtask" SET "deadlineOrigin" = 'DEPARTMENT' WHERE "deadline" IS NOT NULL;

ALTER TABLE "DeadlineChange" ALTER COLUMN "oldDeadline" DROP NOT NULL;

ALTER TYPE "NotifType" ADD VALUE 'COMMITMENT_OPEN';
ALTER TYPE "NotifType" ADD VALUE 'COMMITMENT_REMINDER';
ALTER TYPE "NotifType" ADD VALUE 'COMMITMENT_MISSED_MEMBER';
ALTER TYPE "NotifType" ADD VALUE 'COMMITMENT_MISSED_MD';
ALTER TYPE "NotifType" ADD VALUE 'COMMITMENT_MADE';
