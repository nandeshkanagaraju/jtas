-- CreateEnum
CREATE TYPE "ProductionSection" AS ENUM ('CNC', 'VMC');

-- CreateEnum
CREATE TYPE "ProductionShift" AS ENUM ('DAY', 'NIGHT');

-- CreateEnum
CREATE TYPE "ProductionReportStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'SUPERVISOR';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "productionSection" "ProductionSection";

-- CreateTable
CREATE TABLE "ProductionMachine" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "section" "ProductionSection" NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProductionMachine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionPart" (
    "id" TEXT NOT NULL,
    "customer" TEXT,
    "partName" TEXT NOT NULL,
    "partNumber" TEXT,
    "operation" INTEGER NOT NULL,
    "section" "ProductionSection" NOT NULL,
    "standardCycleSec" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionPart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionReport" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "shift" "ProductionShift" NOT NULL,
    "section" "ProductionSection" NOT NULL,
    "status" "ProductionReportStatus" NOT NULL DEFAULT 'DRAFT',
    "shiftStart" TIMESTAMP(3) NOT NULL,
    "shiftHours" DOUBLE PRECISION NOT NULL,
    "remarks" TEXT,
    "supervisorId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionLine" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "operatorName" TEXT,
    "partId" TEXT,
    "partLabel" TEXT,
    "operation" INTEGER,
    "cycleSec" DOUBLE PRECISION,
    "loadSec" DOUBLE PRECISION,
    "standardCycleSec" DOUBLE PRECISION,
    "pcsPerHourEntered" INTEGER,
    "planQtyEntered" INTEGER,
    "actualPlanQtyEntered" INTEGER,
    "achievedQtyEntered" INTEGER,
    "runHoursEntered" DOUBLE PRECISION,
    "idleEntered" JSONB,
    "reworkQty" INTEGER NOT NULL DEFAULT 0,
    "rejectionQty" INTEGER NOT NULL DEFAULT 0,
    "ncReason" TEXT,
    "remarks" TEXT,
    "warningNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionHour" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "idle" JSONB NOT NULL DEFAULT '{}',
    "note" TEXT,
    "recordedById" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionHour_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionChange" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "lineId" TEXT,
    "label" TEXT NOT NULL,
    "before" TEXT,
    "after" TEXT,
    "changedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductionMachine_code_key" ON "ProductionMachine"("code");

-- CreateIndex
CREATE INDEX "ProductionMachine_section_sortOrder_idx" ON "ProductionMachine"("section", "sortOrder");

-- CreateIndex
CREATE INDEX "ProductionPart_section_isActive_idx" ON "ProductionPart"("section", "isActive");

-- CreateIndex
CREATE INDEX "ProductionReport_status_date_idx" ON "ProductionReport"("status", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionReport_date_shift_section_key" ON "ProductionReport"("date", "shift", "section");

-- CreateIndex
CREATE INDEX "ProductionLine_reportId_idx" ON "ProductionLine"("reportId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionHour_lineId_slot_key" ON "ProductionHour"("lineId", "slot");

-- CreateIndex
CREATE INDEX "ProductionChange_reportId_createdAt_idx" ON "ProductionChange"("reportId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProductionPart" ADD CONSTRAINT "ProductionPart_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionReport" ADD CONSTRAINT "ProductionReport_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionReport" ADD CONSTRAINT "ProductionReport_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionLine" ADD CONSTRAINT "ProductionLine_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ProductionReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionLine" ADD CONSTRAINT "ProductionLine_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "ProductionMachine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionLine" ADD CONSTRAINT "ProductionLine_partId_fkey" FOREIGN KEY ("partId") REFERENCES "ProductionPart"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionHour" ADD CONSTRAINT "ProductionHour_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "ProductionLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionHour" ADD CONSTRAINT "ProductionHour_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionChange" ADD CONSTRAINT "ProductionChange_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ProductionReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionChange" ADD CONSTRAINT "ProductionChange_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
