-- Anúncios: vínculo Produto × Plataforma com preço real, frete, brinde e
-- lucro. Migration puramente aditiva -- 3 enums novos (não valores novos
-- em enum já existente, então cabem na mesma transação junto com a tabela
-- que os usa, diferente do caso do OrderStatus), 1 tabela nova (Listing) e
-- 1 coluna nova nullable em MarketplacePlatform (feeTiersPremium, 2ª
-- tabela de taxa do Mercado Livre -- Clássico/Premium). Sem backfill.

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('RASCUNHO', 'ONLINE', 'PAUSADO');

-- CreateEnum
CREATE TYPE "ListingFreightType" AS ENUM ('GRATIS_SUBSIDIADO', 'PAGO_COMPRADOR', 'PERSONALIZADO');

-- CreateEnum
CREATE TYPE "ListingType" AS ENUM ('CLASSICO', 'PREMIUM');

-- AlterTable
ALTER TABLE "MarketplacePlatform" ADD COLUMN "feeTiersPremium" JSONB;

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "listingType" "ListingType",
    "status" "ListingStatus" NOT NULL DEFAULT 'RASCUNHO',
    "price" DECIMAL(10,2) NOT NULL,
    "freightType" "ListingFreightType" NOT NULL DEFAULT 'GRATIS_SUBSIDIADO',
    "freightCost" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "hasGift" BOOLEAN NOT NULL DEFAULT false,
    "giftCost" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "listingUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Listing_productId_platformId_key" ON "Listing"("productId", "platformId");

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "MarketplacePlatform"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
