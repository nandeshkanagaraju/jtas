-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Job_isDemo_idx" ON "Job"("isDemo");
