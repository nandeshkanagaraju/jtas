-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "failedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Notification_status_failedAt_idx" ON "Notification"("status", "failedAt");
