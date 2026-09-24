-- Frete em Vendas: custo de frete que o vendedor banca NUMA VENDA INTEIRA
-- (um envio cobre o lote inteiro, não cada produto dele separadamente) --
-- por LOTE via batchId, mesmo formato/raciocínio de SaleGiftUsage, nunca
-- uma coluna em Sale (evitaria contar o mesmo frete várias vezes numa
-- venda de vários produtos). Migration puramente aditiva -- 1 tabela nova,
-- sem backfill (venda já registrada nunca teve frete rastreado).

-- CreateTable
CREATE TABLE "SaleFreight" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaleFreight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SaleFreight_batchId_key" ON "SaleFreight"("batchId");

-- CreateIndex
CREATE INDEX "SaleFreight_batchId_idx" ON "SaleFreight"("batchId");
