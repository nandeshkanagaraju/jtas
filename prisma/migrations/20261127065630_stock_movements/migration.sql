-- Production output and dispatches typed against a part, for the stock ledger. New table; no row changes.
-- CreateEnum
CREATE TYPE "StockMovementKind" AS ENUM ('PRODUCED', 'DISPATCHED');

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "partKey" TEXT NOT NULL,
    "partNumber" TEXT NOT NULL,
    "partName" TEXT,
    "kind" "StockMovementKind" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockMovement_partKey_date_idx" ON "StockMovement"("partKey", "date");

-- CreateIndex
CREATE INDEX "StockMovement_date_idx" ON "StockMovement"("date");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_quantity_positive" CHECK ("quantity" > 0);
