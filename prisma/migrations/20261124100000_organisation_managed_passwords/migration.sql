-- Passwords are set by the organisation; nobody is sent to change their own.
ALTER TABLE "User" ALTER COLUMN "mustChangePassword" SET DEFAULT false;
UPDATE "User" SET "mustChangePassword" = false WHERE "mustChangePassword" = true;
