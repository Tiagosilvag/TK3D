-- Non-destructive migration (spec §1.3): existing Accessory rows survive.
-- New columns are added first (nullable / with a temporary default),
-- backfilled from the old data, and only THEN made NOT NULL / dropped.
-- This is the opposite approach from the earlier Filament rework
-- (20260907175151_filament_stock_rework), which explicitly deleted all
-- existing rows -- Accessory keeps its rows here, per explicit spec
-- decision.

-- AlterTable: add the new stock-tracking columns.
ALTER TABLE "Accessory" ADD COLUMN     "colorName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Accessory" ADD COLUMN     "colorHex" TEXT;
ALTER TABLE "Accessory" ADD COLUMN     "currentStock" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "Accessory" ADD COLUMN     "avgUnitCost" DECIMAL(10,4);

-- Backfill avgUnitCost from the old hand-typed unitCost (spec §1.3): the
-- existing value becomes the initial weighted-average cost. currentStock
-- stays at its DEFAULT 0 for every pre-existing row -- there is no real
-- quantity/date to invent a retroactive AccessoryPurchase from, so stock
-- starts at 0 until the user registers a real purchase (same decision
-- already made for Filament's stock rework).
UPDATE "Accessory" SET "avgUnitCost" = "unitCost";

-- Now that every row has a value, enforce NOT NULL and drop the temporary
-- DEFAULT on currentStock (the final schema has no @default on it -- new
-- rows always come from a real purchase via createAccessory).
ALTER TABLE "Accessory" ALTER COLUMN "avgUnitCost" SET NOT NULL;
ALTER TABLE "Accessory" ALTER COLUMN "currentStock" DROP DEFAULT;

-- Old hand-typed cost field, fully replaced by the always-computed avgUnitCost.
ALTER TABLE "Accessory" DROP COLUMN "unitCost";

-- CreateTable
CREATE TABLE "AccessoryPurchase" (
    "id" TEXT NOT NULL,
    "accessoryId" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "totalCost" DECIMAL(10,2) NOT NULL,
    "purchaseDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessoryPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Accessory_name_type_colorName_key" ON "Accessory"("name", "type", "colorName");

-- AddForeignKey
ALTER TABLE "AccessoryPurchase" ADD CONSTRAINT "AccessoryPurchase_accessoryId_fkey" FOREIGN KEY ("accessoryId") REFERENCES "Accessory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
