-- Sales and purchase bills. Every existing invoice becomes a sales bill (the
-- default), so no existing row changes.

-- CreateEnum
CREATE TYPE "BillType" AS ENUM ('SALES', 'PURCHASE');

-- DropIndex
DROP INDEX "Invoice_invoiceNumber_key";

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "billType" "BillType" NOT NULL DEFAULT 'SALES',
ADD COLUMN     "partyKey" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "partyName" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_billType_partyKey_invoiceNumber_key" ON "Invoice"("billType", "partyKey", "invoiceNumber");


-- A purchase bill always names its supplier, which is its uniqueness scope.
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_purchase_has_supplier"
  CHECK ("billType" = 'SALES' OR ("partyName" IS NOT NULL AND "partyKey" <> ''));
