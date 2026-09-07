-- CreateEnum
CREATE TYPE "RoundingMode" AS ENUM ('NONE', 'R90', 'R99', 'R00');

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "defaultDiscountPercent" DECIMAL(5,4) NOT NULL DEFAULT 0,
ADD COLUMN     "desiredMarginPercent" DECIMAL(5,4) NOT NULL DEFAULT 0.30,
ADD COLUMN     "includeAccessoriesCost" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "includeDepreciation" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "includeEnergyCost" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "includeFailureRate" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "includeFilamentCost" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "includeLaborCost" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "includeMaintenance" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "includePackagingCost" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "includeSuppliesCost" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "roundingMode" "RoundingMode" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "stockCriticalThresholdPercent" DECIMAL(5,4) NOT NULL DEFAULT 0.10,
ADD COLUMN     "stockLowThresholdPercent" DECIMAL(5,4) NOT NULL DEFAULT 0.30;

