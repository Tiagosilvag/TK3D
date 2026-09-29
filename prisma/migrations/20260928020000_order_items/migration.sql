-- Melhoria "Pedidos com múltiplos itens": Order vira cabeçalho, todo o
-- resto (produto/cor/quantidade/preço/reserva/status/venda) migra pra uma
-- nova tabela OrderItem, 1 linha por produto+cor pedido. Cada Order
-- pré-existente vira 1 cabeçalho + exatamente 1 OrderItem, reaproveitando
-- o MESMO id (o id do Order antigo passa a identificar também o novo
-- OrderItem) -- preserva toda FK que já apontava pro id antigo
-- (OrderReallocation.fromOrderId/toOrderId) sem precisar remapear nada.

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "colorComboKey" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "reservedQuantity" INTEGER NOT NULL DEFAULT 0,
    "status" "OrderStatus" NOT NULL DEFAULT 'AGUARDANDO_PRODUCAO',
    "saleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- Backfill: 1 OrderItem por Order existente, reaproveitando o próprio id.
INSERT INTO "OrderItem" ("id", "orderId", "productId", "colorComboKey", "quantity", "unitPrice", "reservedQuantity", "status", "saleId", "createdAt", "updatedAt")
SELECT "id", "id", "productId", "colorComboKey", "quantity", "unitPrice", "reservedQuantity", "status", "saleId", "createdAt", "updatedAt"
FROM "Order";

-- Drop das constraints/colunas de item que saíram de Order.
ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_productId_fkey";
ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_saleId_fkey";
ALTER TABLE "Order" DROP COLUMN "productId";
ALTER TABLE "Order" DROP COLUMN "colorComboKey";
ALTER TABLE "Order" DROP COLUMN "quantity";
ALTER TABLE "Order" DROP COLUMN "unitPrice";
ALTER TABLE "Order" DROP COLUMN "reservedQuantity";
ALTER TABLE "Order" DROP COLUMN "status";
ALTER TABLE "Order" DROP COLUMN "saleId";

-- Repointa OrderReallocation de Order pra OrderItem (mesmos valores de id
-- continuam válidos -- OrderItem reaproveitou o id do Order de origem).
ALTER TABLE "OrderReallocation" DROP CONSTRAINT IF EXISTS "OrderReallocation_fromOrderId_fkey";
ALTER TABLE "OrderReallocation" DROP CONSTRAINT IF EXISTS "OrderReallocation_toOrderId_fkey";
DROP INDEX IF EXISTS "OrderReallocation_fromOrderId_idx";
DROP INDEX IF EXISTS "OrderReallocation_toOrderId_idx";
ALTER TABLE "OrderReallocation" RENAME COLUMN "fromOrderId" TO "fromOrderItemId";
ALTER TABLE "OrderReallocation" RENAME COLUMN "toOrderId" TO "toOrderItemId";

-- CreateIndex
CREATE INDEX "OrderReallocation_fromOrderItemId_idx" ON "OrderReallocation"("fromOrderItemId");

-- CreateIndex
CREATE INDEX "OrderReallocation_toOrderItemId_idx" ON "OrderReallocation"("toOrderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItem_saleId_key" ON "OrderItem"("saleId");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderReallocation" ADD CONSTRAINT "OrderReallocation_fromOrderItemId_fkey" FOREIGN KEY ("fromOrderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderReallocation" ADD CONSTRAINT "OrderReallocation_toOrderItemId_fkey" FOREIGN KEY ("toOrderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
