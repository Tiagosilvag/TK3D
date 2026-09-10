-- Melhorias "Embalagens": estoque real (antes PackagingItem só tinha
-- unitCost hand-typed, sem quantidade nenhuma) -- mesmo padrão não
-- destrutivo do accessory_stock_rework (20260907220000): colunas novas
-- primeiro nullable/com default temporário, backfilladas da coluna
-- antiga, só depois NOT NULL. Nenhuma linha excluída.

-- Embalagem ganha "Ajustar estoque" igual Filamento/Acessório/Insumo
-- (components/AdjustStockButton.tsx) agora que tem estoque real.
ALTER TYPE "StockAdjustmentResourceType" ADD VALUE 'PACKAGING';

ALTER TABLE "PackagingItem" ADD COLUMN     "currentStock" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "PackagingItem" ADD COLUMN     "avgUnitCost" DECIMAL(10,4);
ALTER TABLE "PackagingItem" ADD COLUMN     "minStock" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- Backfill avgUnitCost a partir do unitCost hand-typed antigo -- vira o
-- custo médio ponderado inicial. currentStock fica no DEFAULT 0 pra toda
-- linha já existente -- não há quantidade/data reais pra inventar uma
-- PackagingItemPurchase retroativa (mesma decisão já tomada pro
-- currentStock do Accessory/Supply).
UPDATE "PackagingItem" SET "avgUnitCost" = "unitCost";

ALTER TABLE "PackagingItem" ALTER COLUMN "avgUnitCost" SET NOT NULL;
ALTER TABLE "PackagingItem" ALTER COLUMN "currentStock" DROP DEFAULT;

-- Coluna antiga, totalmente substituída pelo avgUnitCost sempre calculado.
ALTER TABLE "PackagingItem" DROP COLUMN "unitCost";

-- CreateTable
CREATE TABLE "PackagingItemPurchase" (
    "id" TEXT NOT NULL,
    "packagingItemId" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "totalCost" DECIMAL(10,2) NOT NULL,
    "purchaseDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackagingItemPurchase_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "PackagingItemPurchase" ADD CONSTRAINT "PackagingItemPurchase_packagingItemId_fkey" FOREIGN KEY ("packagingItemId") REFERENCES "PackagingItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
