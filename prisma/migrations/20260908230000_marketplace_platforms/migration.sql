-- 3.6 + 4.1: canal de venda passa a exigir plataforma específica
-- (Direta/Shopee/Mercado Livre) e cada marketplace ganha taxas próprias
-- configuráveis. MARKETPLACE é mantido no enum só para não reescrever
-- vendas já registradas (nunca inventamos qual plataforma real foi usada
-- retroativamente) -- o formulário de nova venda não oferece mais essa
-- opção genérica.

-- AlterEnum
ALTER TYPE "SaleChannel" ADD VALUE 'SHOPEE';
ALTER TYPE "SaleChannel" ADD VALUE 'MERCADO_LIVRE';

-- CreateEnum
CREATE TYPE "MarketplacePlatformKind" AS ENUM ('SHOPEE', 'MERCADO_LIVRE');

-- CreateTable
CREATE TABLE "MarketplacePlatform" (
    "id" TEXT NOT NULL,
    "platform" "MarketplacePlatformKind" NOT NULL,
    "feePercent" DECIMAL(5,4) NOT NULL,
    "feeFixed" DECIMAL(10,2) NOT NULL,
    "avgFreight" DECIMAL(10,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplacePlatform_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketplacePlatform_platform_key" ON "MarketplacePlatform"("platform");

-- Seed the two known platforms with zeroed fees -- real values are unknown
-- here and must be filled in by the user at /settings/marketplace-platforms.
INSERT INTO "MarketplacePlatform" ("id", "platform", "feePercent", "feeFixed", "avgFreight", "updatedAt")
VALUES
  ('mktplat_shopee', 'SHOPEE', 0, 0, 0, CURRENT_TIMESTAMP),
  ('mktplat_mercadolivre', 'MERCADO_LIVRE', 0, 0, 0, CURRENT_TIMESTAMP);
