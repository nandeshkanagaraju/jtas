-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "pointOfContactId" TEXT;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_pointOfContactId_fkey" FOREIGN KEY ("pointOfContactId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
