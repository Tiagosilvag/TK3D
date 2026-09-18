-- Melhoria "Vendas: múltiplos produtos numa venda": agrupa linhas de Sale
-- criadas na mesma submissão do formulário de registro (vários produtos
-- de uma vez) via um token opaco `batchId`, compartilhado entre as linhas
-- do mesmo evento -- não é FK pra outra tabela, só agrupamento. Toda linha
-- existente vira seu próprio "lote" de 1 item (batchId = seu próprio id),
-- preservando exatamente o comportamento antigo (1 venda = 1 produto) sem
-- inventar agrupamento retroativo que nunca existiu de verdade. Mesmo
-- padrão de 20260911030000_consignment_delivery_batches.

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN "batchId" TEXT;

-- Backfill: cada linha existente vira seu próprio lote.
UPDATE "Sale" SET "batchId" = "id" WHERE "batchId" IS NULL;

-- Verify before constraining -- mesma disciplina de
-- 20260911030000_consignment_delivery_batches: aborta a migration inteira
-- (DDL é transacional) em vez de deixar uma linha sem batchId.
DO $$
DECLARE
  missing_count INTEGER;
BEGIN
  SELECT count(*) INTO missing_count FROM "Sale" WHERE "batchId" IS NULL;
  IF missing_count <> 0 THEN
    RAISE EXCEPTION 'Sale.batchId backfill incompleto: % linha(s) ainda sem batchId -- abortando migration', missing_count;
  END IF;
END $$;

-- AlterTable: agora seguro tornar obrigatório.
ALTER TABLE "Sale" ALTER COLUMN "batchId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Sale_batchId_idx" ON "Sale"("batchId");
