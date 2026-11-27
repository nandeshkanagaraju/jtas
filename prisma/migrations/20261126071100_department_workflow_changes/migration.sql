-- CreateEnum
CREATE TYPE "StoreDirection" AS ENUM ('INWARD', 'OUTWARD');

-- CreateEnum
CREATE TYPE "PurchaseDocType" AS ENUM ('PR', 'PO');

-- AlterEnum
ALTER TYPE "NotifType" ADD VALUE 'DEPARTMENT_INTIMATION';

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "accountsIntimatedAt" TIMESTAMP(3),
ADD COLUMN     "accountsIntimatedById" TEXT,
ADD COLUMN     "accountsIntimationNote" TEXT;

-- AlterTable
ALTER TABLE "MaterialCount" ADD COLUMN     "batchId" TEXT;

-- CreateTable
CREATE TABLE "SubtaskBatch" (
    "id" TEXT NOT NULL,
    "subtaskId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubtaskBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreEntry" (
    "id" TEXT NOT NULL,
    "subtaskId" TEXT NOT NULL,
    "direction" "StoreDirection" NOT NULL,
    "documentType" "PurchaseDocType" NOT NULL,
    "documentNumber" TEXT,
    "supplierName" TEXT,
    "invoiceNumber" TEXT,
    "invoiceDate" DATE,
    "material" TEXT,
    "quantity" INTEGER,
    "note" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubtaskBatch_subtaskId_completedAt_idx" ON "SubtaskBatch"("subtaskId", "completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SubtaskBatch_subtaskId_sequence_key" ON "SubtaskBatch"("subtaskId", "sequence");

-- CreateIndex
CREATE INDEX "StoreEntry_subtaskId_createdAt_idx" ON "StoreEntry"("subtaskId", "createdAt");

-- CreateIndex
CREATE INDEX "StoreEntry_createdAt_idx" ON "StoreEntry"("createdAt");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_accountsIntimatedById_fkey" FOREIGN KEY ("accountsIntimatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialCount" ADD CONSTRAINT "MaterialCount_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "SubtaskBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubtaskBatch" ADD CONSTRAINT "SubtaskBatch_subtaskId_fkey" FOREIGN KEY ("subtaskId") REFERENCES "Subtask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubtaskBatch" ADD CONSTRAINT "SubtaskBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreEntry" ADD CONSTRAINT "StoreEntry_subtaskId_fkey" FOREIGN KEY ("subtaskId") REFERENCES "Subtask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreEntry" ADD CONSTRAINT "StoreEntry_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A batch plans some pieces; a store line never records a negative quantity.
ALTER TABLE "SubtaskBatch" ADD CONSTRAINT "SubtaskBatch_quantity_check" CHECK ("quantity" > 0);
ALTER TABLE "StoreEntry" ADD CONSTRAINT "StoreEntry_quantity_check" CHECK ("quantity" IS NULL OR "quantity" >= 0);
