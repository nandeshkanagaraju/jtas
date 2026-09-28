-- The companion to `Job.isDemo`: that flag keeps the sweeper from chasing
-- demonstration *work*, this one keeps it from mailing demonstration *people*.
--
-- Recipients for the digest, overdue escalations, approvals, extensions and
-- job-completion mail are all chosen by role, not by job, so the job flag never
-- covered them. `pnpm seed:demo` and `pnpm seed:showcase` each create their own
-- MD, which made every one of those mails go to three Managing Directors.
ALTER TABLE "User" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- Backfill the synthetic rosters already in the database. Both seeds place
-- their accounts on a domain reserved by RFC 6761, which is precisely so that
-- they can be recognised and never resolved.
UPDATE "User"
   SET "isDemo" = true
 WHERE "email" LIKE '%@demo.invalid'
    OR "email" LIKE '%@showcase.invalid';
