-- Melhoria "Histórico de consumo": log de QUANTO de Acessório/Insumo/
-- Embalagem foi consumido, QUANDO, e POR QUAL produto/evento -- até aqui
-- confirmAssembly só decrementava currentStock sem deixar rastro nenhum.
-- Embalagem nunca era consumida em lugar nenhum (bug); passa a ser
-- consumida na venda (Sale), não na montagem (ver comentário no schema).
-- resourceId é polimórfico sem FK física, mesmo padrão de
-- StockAdjustment.resourceId.

-- CreateEnum
CREATE TYPE "StockConsumptionResourceType" AS ENUM ('ACCESSORY', 'SUPPLY', 'PACKAGING');

-- CreateEnum
CREATE TYPE "StockConsumptionSource" AS ENUM ('ASSEMBLY', 'SALE');

-- CreateTable
CREATE TABLE "StockConsumption" (
    "id" TEXT NOT NULL,
    "resourceType" "StockConsumptionResourceType" NOT NULL,
    "resourceId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "productId" TEXT NOT NULL,
    "source" "StockConsumptionSource" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "consumedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockConsumption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockConsumption_resourceType_resourceId_idx" ON "StockConsumption"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "StockConsumption_source_sourceId_idx" ON "StockConsumption"("source", "sourceId");

-- AddForeignKey
ALTER TABLE "StockConsumption" ADD CONSTRAINT "StockConsumption_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
