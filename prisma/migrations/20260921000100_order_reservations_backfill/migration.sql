-- Backfill de deliveryDate: única data que existia antes deste campo era
-- orderDate -- aproximação aceita pra pedido histórico (mesmo raciocínio
-- de Sale.batchId = id próprio: nunca inventa dado que não existia, só
-- usa o mais próximo disponível). Todo pedido criado a partir de agora
-- manda deliveryDate de verdade.
UPDATE "Order" SET "deliveryDate" = "orderDate" WHERE "deliveryDate" IS NULL;

DO $$
DECLARE
  missing_count INTEGER;
BEGIN
  SELECT count(*) INTO missing_count FROM "Order" WHERE "deliveryDate" IS NULL;
  IF missing_count <> 0 THEN
    RAISE EXCEPTION 'Order.deliveryDate backfill incompleto: % linha(s) ainda sem deliveryDate -- abortando migration', missing_count;
  END IF;
END $$;

ALTER TABLE "Order" ALTER COLUMN "deliveryDate" SET NOT NULL;

-- AlterTable: default do status muda de RECEBIDO pro novo
-- AGUARDANDO_PRODUCAO -- só podia vir aqui (migration seguinte à que
-- criou o valor), não na mesma transação que o ADD VALUE. Só afeta
-- INSERT novo; linha existente é corrigida pelos UPDATEs abaixo.
ALTER TABLE "Order" ALTER COLUMN "status" SET DEFAULT 'AGUARDANDO_PRODUCAO';

-- Backfill de status: mapeamento grosseiro pro status novo mais próximo
-- -- não precisa ser exato, porque reservedQuantity de todo pedido aberto
-- começa em 0 (coluna nova) e reconcileOrderReservations recalcula
-- status+reservedQuantity do zero na primeira vez que produção/montagem/
-- pedido novo tocar naquele produto+variação depois deste deploy. Até
-- lá, um pedido rotulado errado não distorce "Disponível" (a soma de
-- reservado usa reservedQuantity, que é 0 pra todo mundo aqui).
UPDATE "Order" SET "status" = 'AGUARDANDO_PRODUCAO' WHERE "status" IN ('RECEBIDO', 'EM_PRODUCAO');
UPDATE "Order" SET "status" = 'PRONTO_RESERVADO' WHERE "status" = 'PRONTO';
UPDATE "Order" SET "status" = 'ENTREGUE' WHERE "status" IN ('DESPACHADO', 'CONCLUIDO');
