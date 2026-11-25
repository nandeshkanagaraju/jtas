-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "ratePaise" INTEGER NOT NULL,
    "gstBasisPoints" INTEGER NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Invoice_jobId_invoiceDate_idx" ON "Invoice"("jobId", "invoiceDate");

-- CreateIndex
CREATE INDEX "Invoice_invoiceDate_idx" ON "Invoice"("invoiceDate");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- An invoice bills something at a non-negative price, with GST between 0% and 100%.
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_amounts_check"
  CHECK ("quantity" > 0 AND "ratePaise" >= 0 AND "gstBasisPoints" BETWEEN 0 AND 10000);
