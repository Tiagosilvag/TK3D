-- Melhoria "Entregas em consignação" §1/§4: agrupa linhas de
-- ConsignmentDelivery criadas na mesma submissão do modal "Registrar
-- entrega" (vários produtos/cores de uma vez) via um token opaco
-- `batchId`, compartilhado entre as linhas do mesmo evento -- não é FK pra
-- outra tabela, só agrupamento. Toda linha existente vira seu próprio
-- "lote" de 1 item (batchId = seu próprio id), preservando exatamente o
-- comportamento antigo (1 entrega = 1 produto) sem inventar agrupamento
-- retroativo que nunca existiu de verdade.

-- AlterTable
ALTER TABLE "ConsignmentDelivery" ADD COLUMN "batchId" TEXT;

-- Backfill: cada linha existente vira seu próprio lote.
UPDATE "ConsignmentDelivery" SET "batchId" = "id" WHERE "batchId" IS NULL;

-- Verify before constraining -- mesma disciplina de
-- 20260907220500_accessory_fk_restrict/ProductAccessoryUsage: aborta a
-- migration inteira (DDL é transacional) em vez de deixar uma linha sem
-- batchId.
DO $$
DECLARE
  missing_count INTEGER;
BEGIN
  SELECT count(*) INTO missing_count FROM "ConsignmentDelivery" WHERE "batchId" IS NULL;
  IF missing_count <> 0 THEN
    RAISE EXCEPTION 'ConsignmentDelivery.batchId backfill incompleto: % linha(s) ainda sem batchId -- abortando migration', missing_count;
  END IF;
END $$;

-- AlterTable: agora seguro tornar obrigatório.
ALTER TABLE "ConsignmentDelivery" ALTER COLUMN "batchId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "ConsignmentDelivery_batchId_idx" ON "ConsignmentDelivery"("batchId");
