-- 2.1 Produto composto (BOM): Product ganha um flag isComposite e uma
-- lista de ProductPart (peça: impressora/filamento/peso/tempo/quantidade
-- por unidade própria). ProductionRun ganha um FK opcional pra ProductPart
-- -- presente quando a produção é de uma peça específica, não do produto
-- pronto. Nenhuma coluna existente de Product muda de tipo/nulidade —
-- produtos simples continuam exatamente como eram.

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "isComposite" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ProductPart" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "printerId" TEXT NOT NULL,
    "filamentId" TEXT NOT NULL,
    "weightGrams" DECIMAL(10,2) NOT NULL,
    "printTimeHours" DECIMAL(10,3) NOT NULL,
    "quantityPerUnit" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductPart_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductPart_productId_name_key" ON "ProductPart"("productId", "name");

-- AddForeignKey
ALTER TABLE "ProductPart" ADD CONSTRAINT "ProductPart_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPart" ADD CONSTRAINT "ProductPart_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "Printer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPart" ADD CONSTRAINT "ProductPart_filamentId_fkey" FOREIGN KEY ("filamentId") REFERENCES "Filament"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "ProductionRun" ADD COLUMN "productPartId" TEXT;

-- AddForeignKey
ALTER TABLE "ProductionRun" ADD CONSTRAINT "ProductionRun_productPartId_fkey" FOREIGN KEY ("productPartId") REFERENCES "ProductPart"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
