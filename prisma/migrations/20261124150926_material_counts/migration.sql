-- CreateTable
CREATE TABLE "MaterialCount" (
    "id" TEXT NOT NULL,
    "subtaskId" TEXT NOT NULL,
    "acceptedQty" INTEGER NOT NULL,
    "rejectedQty" INTEGER NOT NULL,
    "note" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialCount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaterialCount_subtaskId_createdAt_idx" ON "MaterialCount"("subtaskId", "createdAt");

-- AddForeignKey
ALTER TABLE "MaterialCount" ADD CONSTRAINT "MaterialCount_subtaskId_fkey" FOREIGN KEY ("subtaskId") REFERENCES "Subtask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialCount" ADD CONSTRAINT "MaterialCount_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A report counts something: neither figure negative, and not both zero.
ALTER TABLE "MaterialCount" ADD CONSTRAINT "MaterialCount_quantities_check"
  CHECK ("acceptedQty" >= 0 AND "rejectedQty" >= 0 AND "acceptedQty" + "rejectedQty" > 0);
