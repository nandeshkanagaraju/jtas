-- Opening stock per part for the daily stock ledger. New table; no row changes.
-- CreateTable
CREATE TABLE "StockOpening" (
    "id" TEXT NOT NULL,
    "partKey" TEXT NOT NULL,
    "partNumber" TEXT NOT NULL,
    "partName" TEXT,
    "asOfDate" DATE NOT NULL,
    "rmQty" INTEGER NOT NULL,
    "fgQty" INTEGER NOT NULL,
    "setById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockOpening_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockOpening_partKey_key" ON "StockOpening"("partKey");

-- AddForeignKey
ALTER TABLE "StockOpening" ADD CONSTRAINT "StockOpening_setById_fkey" FOREIGN KEY ("setById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockOpening" ADD CONSTRAINT "StockOpening_qty_nonnegative"
  CHECK ("rmQty" >= 0 AND "fgQty" >= 0);
