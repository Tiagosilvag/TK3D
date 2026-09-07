-- Destructive reset of Filament data (explicit user decision, see spec §3.1):
-- the 7 existing filament rows (no color, no stock, from the old spreadsheet
-- import) are deleted before reshaping the table into the per-roll stock
-- model. If this fails with a foreign key violation, it means a Product row
-- still references a Filament row -- STOP, do not add ON DELETE CASCADE and
-- do not force-delete Product rows without explicit approval.
DELETE FROM "Filament";

-- CreateEnum
CREATE TYPE "FilamentMaterial" AS ENUM ('PLA', 'PETG', 'TPU', 'OUTRO');

-- DropIndex
DROP INDEX "Filament_manufacturer_key";

-- AlterTable
ALTER TABLE "Filament" DROP COLUMN "active",
DROP COLUMN "bedTempC",
DROP COLUMN "densityGCm3",
DROP COLUMN "diameterMm",
DROP COLUMN "nozzleTempC",
ADD COLUMN     "colorHex" TEXT NOT NULL,
ADD COLUMN     "colorName" TEXT NOT NULL,
ADD COLUMN     "currentStockGrams" DECIMAL(10,2) NOT NULL,
ADD COLUMN     "initialStockGrams" DECIMAL(10,2) NOT NULL,
ADD COLUMN     "material" "FilamentMaterial" NOT NULL,
ADD COLUMN     "rollNumber" INTEGER NOT NULL;

-- CreateTable
CREATE TABLE "MaterialDefaults" (
    "material" "FilamentMaterial" NOT NULL,
    "diameterMm" DECIMAL(4,2) NOT NULL,
    "densityGCm3" DECIMAL(5,3) NOT NULL,
    "nozzleTempC" INTEGER NOT NULL,
    "bedTempC" INTEGER NOT NULL,

    CONSTRAINT "MaterialDefaults_pkey" PRIMARY KEY ("material")
);

-- CreateIndex
CREATE UNIQUE INDEX "Filament_manufacturer_material_colorName_rollNumber_key" ON "Filament"("manufacturer", "material", "colorName", "rollNumber");
