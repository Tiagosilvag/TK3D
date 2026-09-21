-- Melhoria "Pedidos com reserva de estoque": RECEBIDO/EM_PRODUCAO/PRONTO/
-- DESPACHADO/CONCLUIDO viram legado (nunca mais escritos por código
-- novo, mas ficam no enum -- Postgres não deixa remover valor sem
-- recriar o tipo, mesmo precedente de SaleChannel.MARKETPLACE). Cada
-- ALTER TYPE ... ADD VALUE roda na sua própria linha -- Postgres não
-- deixa usar um valor recém-adicionado na MESMA transação em que foi
-- criado, então o backfill que usa esses valores novos (mapear
-- RECEBIDO/EM_PRODUCAO/PRONTO/DESPACHADO/CONCLUIDO pros status novos)
-- fica pra migration seguinte (20260921000100), não pode estar aqui.
ALTER TYPE "OrderStatus" ADD VALUE 'AGUARDANDO_PRODUCAO';
ALTER TYPE "OrderStatus" ADD VALUE 'PARCIAL_AGUARDANDO_PRODUCAO';
ALTER TYPE "OrderStatus" ADD VALUE 'AGUARDANDO_MONTAGEM';
ALTER TYPE "OrderStatus" ADD VALUE 'PRONTO_RESERVADO';
ALTER TYPE "OrderStatus" ADD VALUE 'ENTREGUE';
ALTER TYPE "OrderStatus" ADD VALUE 'CANCELADO';

-- AlterTable: colorComboKey/buyerOrPlatform nullable (produto sem
-- variante conhecida / comprador não informado), reservedQuantity com
-- default 0 (todo pedido nasce sem nada reservado, reconcileOrderReservations
-- preenche em seguida). deliveryDate nasce nullable aqui -- backfillado e
-- só então tornado NOT NULL na migration seguinte (mesmo padrão de
-- Sale.batchId em 20260918130000_sale_batches).
ALTER TABLE "Order" ADD COLUMN "colorComboKey" TEXT;
ALTER TABLE "Order" ADD COLUMN "deliveryDate" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "buyerOrPlatform" TEXT;
ALTER TABLE "Order" ADD COLUMN "reservedQuantity" INTEGER NOT NULL DEFAULT 0;

-- Nota: o DEFAULT de "status" só muda pra 'AGUARDANDO_PRODUCAO' na
-- migration seguinte (20260921000100) -- Postgres não deixa usar um
-- valor de enum recém-adicionado na MESMA transação em que foi criado
-- (nem pra um DEFAULT), só depois de commitado.

-- CreateTable
CREATE TABLE "OrderReallocation" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "colorComboKey" TEXT,
    "quantity" INTEGER NOT NULL,
    "fromOrderId" TEXT NOT NULL,
    "toOrderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderReallocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderReallocation_fromOrderId_idx" ON "OrderReallocation"("fromOrderId");

-- CreateIndex
CREATE INDEX "OrderReallocation_toOrderId_idx" ON "OrderReallocation"("toOrderId");

-- AddForeignKey
ALTER TABLE "OrderReallocation" ADD CONSTRAINT "OrderReallocation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderReallocation" ADD CONSTRAINT "OrderReallocation_fromOrderId_fkey" FOREIGN KEY ("fromOrderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderReallocation" ADD CONSTRAINT "OrderReallocation_toOrderId_fkey" FOREIGN KEY ("toOrderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
