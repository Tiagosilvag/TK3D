-- Brinde (spec "Brinde reciclado no sistema"): produto que nunca é
-- vendido sozinho, só anexado como custo extra numa Venda. Migration
-- puramente aditiva -- isGift tem DEFAULT false, giftEnergyCostPerKwh é
-- nullable, as 3 tabelas novas são CREATE TABLE -- sem backfill/verify,
-- diferente de Sale.batchId (que era NOT NULL sem default).

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "isGift" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN "giftEnergyCostPerKwh" DECIMAL(10,4);

-- CreateTable
CREATE TABLE "ProductGiftMaterial" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unitCost" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductGiftMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductGiftEquipmentUsage" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purchasePrice" DECIMAL(10,2) NOT NULL,
    "usefulLifeUses" INTEGER NOT NULL,
    "powerWatts" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "minutesPerUnit" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductGiftEquipmentUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleGiftUsage" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" DECIMAL(10,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaleGiftUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SaleGiftUsage_batchId_key" ON "SaleGiftUsage"("batchId");

-- CreateIndex
CREATE INDEX "SaleGiftUsage_batchId_idx" ON "SaleGiftUsage"("batchId");

-- AddForeignKey
ALTER TABLE "ProductGiftMaterial" ADD CONSTRAINT "ProductGiftMaterial_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductGiftEquipmentUsage" ADD CONSTRAINT "ProductGiftEquipmentUsage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleGiftUsage" ADD CONSTRAINT "SaleGiftUsage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
