-- Melhoria "Produção" §3/§4: agrupa ProductionRun criadas na mesma
-- submissão do modal "Registrar produção" (várias peças de um produto
-- composto marcadas de uma vez) via um token opaco `batchId`, compartilhado
-- entre as runs do mesmo evento -- não é FK pra outra tabela, só
-- agrupamento (mesmo padrão de ConsignmentDelivery.batchId, ver
-- 20260911030000_consignment_delivery_batches). Toda run existente vira seu
-- próprio "lote" de 1 (batchId = seu próprio id), preservando exatamente o
-- comportamento antigo (1 produção = 1 linha) sem inventar agrupamento
-- retroativo que nunca existiu de verdade.

-- AlterTable
ALTER TABLE "ProductionRun" ADD COLUMN "batchId" TEXT;

-- Backfill: cada linha existente vira seu próprio lote.
UPDATE "ProductionRun" SET "batchId" = "id" WHERE "batchId" IS NULL;

-- Verify before constraining -- aborta a migration inteira (DDL é
-- transacional) em vez de deixar uma linha sem batchId.
DO $$
DECLARE
  missing_count INTEGER;
BEGIN
  SELECT count(*) INTO missing_count FROM "ProductionRun" WHERE "batchId" IS NULL;
  IF missing_count <> 0 THEN
    RAISE EXCEPTION 'ProductionRun.batchId backfill incompleto: % linha(s) ainda sem batchId -- abortando migration', missing_count;
  END IF;
END $$;

-- AlterTable: agora seguro tornar obrigatório.
ALTER TABLE "ProductionRun" ALTER COLUMN "batchId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "ProductionRun_batchId_idx" ON "ProductionRun"("batchId");
