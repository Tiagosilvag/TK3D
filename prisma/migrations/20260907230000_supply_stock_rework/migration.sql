-- Non-destructive migration (spec §1.2/§1.3, task-4 brief -- mirrors
-- 20260907220000_accessory_stock_rework for Accessory): existing Supply
-- rows survive. New columns are added first (nullable / with a temporary
-- default), backfilled from the old data, and only THEN made NOT NULL /
-- dropped.

-- AlterEnum: add the two new SupplyUnit values (task-4 brief) alongside the
-- existing UN/ML/G, which are NOT removed. ALTER TYPE ... ADD VALUE cannot
-- run in the same transaction as a statement that USES the new value, but
-- nothing below reads 'M'/'OUTRO', so it is safe inside this migration's
-- single transaction.
ALTER TYPE "SupplyUnit" ADD VALUE 'M';
ALTER TYPE "SupplyUnit" ADD VALUE 'OUTRO';

-- AlterTable: add the new stock-tracking columns.
ALTER TABLE "Supply" ADD COLUMN     "currentStock" DECIMAL(10,3) NOT NULL DEFAULT 0;
ALTER TABLE "Supply" ADD COLUMN     "avgUnitCost" DECIMAL(10,4);

-- Backfill avgUnitCost from the old hand-typed unitCost (spec §1.3): the
-- existing value becomes the initial weighted-average cost. currentStock
-- stays at its DEFAULT 0 for every pre-existing row -- there is no real
-- quantity/date to invent a retroactive SupplyPurchase from, so stock
-- starts at 0 until the user registers a real purchase (same decision
-- already made for Filament and Accessory).
UPDATE "Supply" SET "avgUnitCost" = "unitCost";

-- Now that every row has a value, enforce NOT NULL and drop the temporary
-- DEFAULT on currentStock (the final schema has no @default on it -- new
-- rows always come from a real purchase via createSupply).
ALTER TABLE "Supply" ALTER COLUMN "avgUnitCost" SET NOT NULL;
ALTER TABLE "Supply" ALTER COLUMN "currentStock" DROP DEFAULT;

-- Old hand-typed cost field, fully replaced by the always-computed avgUnitCost.
ALTER TABLE "Supply" DROP COLUMN "unitCost";

-- CreateTable
CREATE TABLE "SupplyPurchase" (
    "id" TEXT NOT NULL,
    "supplyId" TEXT NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "totalCost" DECIMAL(10,2) NOT NULL,
    "purchaseDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplyPurchase_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "SupplyPurchase" ADD CONSTRAINT "SupplyPurchase_supplyId_fkey" FOREIGN KEY ("supplyId") REFERENCES "Supply"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Note: ProductSupplyUsage_supplyId_fkey already uses ON DELETE RESTRICT
-- since the original init migration (Supply.usages is a required relation),
-- unlike Accessory's Product.accessoryId FK which needed an explicit fix in
-- 20260907220500_accessory_fk_restrict -- no equivalent migration is needed
-- here.
