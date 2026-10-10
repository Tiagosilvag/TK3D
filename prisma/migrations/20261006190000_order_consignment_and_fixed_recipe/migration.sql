-- Pedido do usuário "criar pedidos de encomendas de consignados também":
-- Order ganha um canal novo e um parceiro opcional (obrigatório só
-- quando channel=CONSIGNADO, checado no Zod); OrderItem ganha um link
-- opcional e único pra ConsignmentDelivery, mesmo papel de saleId/sale
-- (ver updateOrderItemStatus em actions/orders.ts) -- os dois nunca
-- preenchidos ao mesmo tempo num mesmo item, decidido pelo canal do
-- pedido. ALTER TYPE ... ADD VALUE não é usado em DEFAULT nem backfill
-- nesta mesma migration, então não precisa de uma migration separada
-- (diferente do precedente de OrderStatus em 20260921000000, que
-- backfillava com os valores novos).
ALTER TYPE "OrderChannel" ADD VALUE 'CONSIGNADO';

ALTER TABLE "Order" ADD COLUMN "consignmentPartnerId" TEXT;
ALTER TABLE "Order" ADD CONSTRAINT "Order_consignmentPartnerId_fkey" FOREIGN KEY ("consignmentPartnerId") REFERENCES "ConsignmentPartner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OrderItem" ADD COLUMN "consignmentDeliveryId" TEXT;
CREATE UNIQUE INDEX "OrderItem_consignmentDeliveryId_key" ON "OrderItem"("consignmentDeliveryId");
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_consignmentDeliveryId_fkey" FOREIGN KEY ("consignmentDeliveryId") REFERENCES "ConsignmentDelivery"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Pedido do usuário "receita fixa em qualquer peça": até aqui "receita
-- fixa" era 100% derivado de filamentComponents.length >= 2
-- (actions/orders.ts#getOrderablePartOptions) -- este flag deixa fixar
-- a cor de uma peça de 1 filamento também. Default false preserva o
-- comportamento de toda peça já cadastrada (continua "cor variável"
-- como sempre foi).
ALTER TABLE "ProductPart" ADD COLUMN "fixedRecipe" BOOLEAN NOT NULL DEFAULT false;
