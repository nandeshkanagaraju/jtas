-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "deleteReason" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT;

-- CreateIndex
CREATE INDEX "Job_deletedAt_idx" ON "Job"("deletedAt");
