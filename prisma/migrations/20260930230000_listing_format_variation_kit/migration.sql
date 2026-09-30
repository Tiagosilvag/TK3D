-- Melhoria "Anúncios: Unidade/Variação/Kit": um anúncio real nem sempre é
-- 1 produto solto -- Listing ganha `format` (default UNIDADE, migration
-- puramente aditiva pra toda linha existente) + os 2 campos usados só por
-- VARIACAO (`includedVariantKeys`, lista de colorComboKey) e só por KIT
-- (`kitName` + a nova tabela ListingKitItem, mesmo precedente de
-- ProductComponentUsage). `productId` vira opcional -- só formato KIT o
-- deixa nulo (o anúncio representa vários produtos, não 1); as 2 unique
-- indexes parciais existentes (productId+platformId[+listingType])
-- continuam funcionando sem ajuste: postgres nunca considera 2 NULLs
-- conflitantes numa unique, então vários Kits na mesma plataforma nunca
-- esbarram nelas.

-- CreateEnum
CREATE TYPE "ListingFormat" AS ENUM ('UNIDADE', 'VARIACAO', 'KIT');

-- AlterTable
ALTER TABLE "Listing"
  ADD COLUMN "format" "ListingFormat" NOT NULL DEFAULT 'UNIDADE',
  ADD COLUMN "includedVariantKeys" JSONB,
  ADD COLUMN "kitName" TEXT,
  ALTER COLUMN "productId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ListingKitItem" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ListingKitItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ListingKitItem_listingId_productId_key" ON "ListingKitItem"("listingId", "productId");

-- AddForeignKey
ALTER TABLE "ListingKitItem" ADD CONSTRAINT "ListingKitItem_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingKitItem" ADD CONSTRAINT "ListingKitItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
