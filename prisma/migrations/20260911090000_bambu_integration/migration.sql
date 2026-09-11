-- Integração Bambu Lab (monitoramento, spec 2026-09-11): campos de opt-in
-- por impressora, credencial cifrada da conta Bambu, tempo real da Plate
-- e o log de capturas de telemetria (somente leitura, nunca altera
-- ProductionRun).
ALTER TABLE "Printer" ADD COLUMN "bambuEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Printer" ADD COLUMN "bambuSerial" TEXT;

ALTER TABLE "Settings" ADD COLUMN "bambuCloudEmail" TEXT;
ALTER TABLE "Settings" ADD COLUMN "bambuCloudCredentialEncrypted" TEXT;
ALTER TABLE "Settings" ADD COLUMN "bambuCloudRegion" TEXT DEFAULT 'US';

ALTER TABLE "Plate" ADD COLUMN "actualPrintTimeHours" DECIMAL(10,3);

CREATE TYPE "PrinterCaptureOutcome" AS ENUM ('FINISHED', 'FAILED', 'CANCELLED', 'UNKNOWN');

CREATE TABLE "PrinterCapture" (
    "id" TEXT NOT NULL,
    "printerId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "gcodeFileName" TEXT,
    "durationHours" DECIMAL(10,3) NOT NULL,
    "gramsUsedTotal" DECIMAL(10,2),
    "amsBreakdown" JSONB,
    "outcome" "PrinterCaptureOutcome" NOT NULL,
    "linkedPlateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrinterCapture_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PrinterCapture_printerId_finishedAt_idx" ON "PrinterCapture"("printerId", "finishedAt");

ALTER TABLE "PrinterCapture" ADD CONSTRAINT "PrinterCapture_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "Printer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrinterCapture" ADD CONSTRAINT "PrinterCapture_linkedPlateId_fkey" FOREIGN KEY ("linkedPlateId") REFERENCES "Plate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
