-- 2.6 Ajuste de estoque com justificativa: log único de auditoria pra
-- Filamentos, Acessórios, Insumos e Meu Estoque (ver comentário no schema
-- pra por que resourceId não tem FK física).

-- CreateEnum
CREATE TYPE "StockAdjustmentResourceType" AS ENUM ('FILAMENT', 'ACCESSORY', 'SUPPLY', 'PRODUCT');

-- CreateEnum
CREATE TYPE "StockAdjustmentReason" AS ENUM ('INVENTARIO_FISICO', 'PERDA_DANO', 'PERDA_FALHA_IMPRESSAO', 'PRODUTO_VENCIDO', 'CORRECAO_CADASTRO', 'CONSUMO_NAO_REGISTRADO', 'OUTRO');

-- CreateTable
CREATE TABLE "StockAdjustment" (
    "id" TEXT NOT NULL,
    "resourceType" "StockAdjustmentResourceType" NOT NULL,
    "resourceId" TEXT NOT NULL,
    "previousQty" DECIMAL(12,3) NOT NULL,
    "newQty" DECIMAL(12,3) NOT NULL,
    "difference" DECIMAL(12,3) NOT NULL,
    "reason" "StockAdjustmentReason" NOT NULL,
    "reasonNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockAdjustment_resourceType_resourceId_idx" ON "StockAdjustment"("resourceType", "resourceId");
