-- QA hourly reports record the time slot they cover. Nullable; no row changes.
-- AlterTable
ALTER TABLE "MaterialCount" ADD COLUMN     "periodEnd" TIMESTAMP(3),
ADD COLUMN     "periodStart" TIMESTAMP(3);


ALTER TABLE "MaterialCount" ADD CONSTRAINT "MaterialCount_period_order"
  CHECK ("periodStart" IS NULL OR ("periodEnd" IS NOT NULL AND "periodEnd" > "periodStart"));
