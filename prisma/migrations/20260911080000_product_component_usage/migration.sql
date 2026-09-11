-- Melhoria "Produto-como-componente": um Product pode ser usado como
-- ingrediente de outro Product composto (ex.: Mosquetão dentro de Chaveiro
-- Café), com estoque compartilhado entre todos os produtos pai que o usam.
-- ProductAssembly ganha um costSnapshot (congelado, nulo em montagens sem
-- componente-produto ou anteriores a este ajuste -- sem backfill).

-- CreateTable
CREATE TABLE "ProductComponentUsage" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "componentProductId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ProductComponentUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductComponentUsage_productId_componentProductId_key" ON "ProductComponentUsage"("productId", "componentProductId");

-- AddForeignKey
ALTER TABLE "ProductComponentUsage" ADD CONSTRAINT "ProductComponentUsage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductComponentUsage" ADD CONSTRAINT "ProductComponentUsage_componentProductId_fkey" FOREIGN KEY ("componentProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "ProductAssembly" ADD COLUMN "costSnapshot" JSONB;
