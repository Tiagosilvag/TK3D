-- Melhoria "Parceiros de consignação" §5: entrega a parceiro passa a
-- registrar QUAL combinação de cor foi entregue (colorComboKey, mesma
-- convenção de ProductAssembly.colorChoices), e a ficha técnica do Produto
-- ganha um mapa opcional/adicional de "quais acessórios (já com cor
-- específica) cada combinação de cor usa" -- só pra alimentar os chips de
-- acessório no detalhe por cor da tela de Parceiros. Nenhuma das duas
-- mudanças toca Montagem/custeio (ProductAccessoryUsage, a lista flat
-- consumida por confirmAssembly, continua exatamente como era).

-- AlterTable
ALTER TABLE "ConsignmentDelivery" ADD COLUMN "colorComboKey" TEXT;

-- CreateTable
CREATE TABLE "ProductAccessoryColorUsage" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "colorComboKey" TEXT NOT NULL,
    "accessoryId" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "ProductAccessoryColorUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductAccessoryColorUsage_product_combo_accessory_key" ON "ProductAccessoryColorUsage"("productId", "colorComboKey", "accessoryId");

-- AddForeignKey (same shape as ProductAccessoryUsage: Cascade on the
-- product side, default Restrict on the accessory side)
ALTER TABLE "ProductAccessoryColorUsage" ADD CONSTRAINT "ProductAccessoryColorUsage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductAccessoryColorUsage" ADD CONSTRAINT "ProductAccessoryColorUsage_accessoryId_fkey" FOREIGN KEY ("accessoryId") REFERENCES "Accessory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
