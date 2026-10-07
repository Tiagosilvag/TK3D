-- Redesign "Pedidos" -- selo "Editado" + histórico de alterações: 1 linha
-- por sessão de edição salva no drawer de detalhe (não 1 por campo
-- mudado), com um array de diffs já formatado em `changes`. Migration
-- puramente aditiva (tabela nova), sem backfill -- pedido existente
-- simplesmente não tem histórico de edição antes de hoje.
CREATE TABLE "OrderEditLog" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderEditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrderEditLog_orderId_idx" ON "OrderEditLog"("orderId");

ALTER TABLE "OrderEditLog" ADD CONSTRAINT "OrderEditLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
