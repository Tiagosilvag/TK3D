-- Melhoria "Produção, do pedido ao histórico" §9: registro de alterações por
-- produção. Editar mexe em estoque por rolo e custo -- este log guarda o valor
-- ANTERIOR (e o novo, quando houve) de cada correção/exclusão, pra auditar
-- uma edição feita por engano. Sem FK pra ProductionRun de propósito: a linha
-- de uma produção EXCLUÍDA continua existindo aqui (e uma edição recria a run
-- com o mesmo id). Aditiva -- nenhuma tabela existente é tocada.

-- CreateTable
CREATE TABLE "ProductionRunLog" (
    "id" TEXT NOT NULL,
    "productionRunId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionRunLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductionRunLog_productionRunId_idx" ON "ProductionRunLog"("productionRunId");
