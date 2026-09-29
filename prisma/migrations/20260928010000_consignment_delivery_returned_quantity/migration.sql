-- Melhoria "editar tudo no consignado" (revisão): devolver uma peça ao
-- próprio estoque deixa de decrementar ConsignmentDelivery.quantityDelivered
-- direto -- passa a incrementar este novo contador, preservando o fato
-- histórico "quanto foi entregue" intacto (mesma filosofia de
-- ProductionRun.status=CANCELADA, que também nunca reescreve os números
-- originais da produção).
ALTER TABLE "ConsignmentDelivery" ADD COLUMN "returnedQuantity" INTEGER NOT NULL DEFAULT 0;
