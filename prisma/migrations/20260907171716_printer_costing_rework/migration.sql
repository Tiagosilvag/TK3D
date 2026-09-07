-- AlterTable
ALTER TABLE "Printer" DROP COLUMN "maintenanceCost";

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "annualMaintenancePercent" DECIMAL(5,4) NOT NULL DEFAULT 0.10,
ADD COLUMN     "annualUsageHours" DECIMAL(10,2) NOT NULL DEFAULT 2000;
