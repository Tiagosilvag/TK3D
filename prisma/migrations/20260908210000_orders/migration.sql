-- 2.4 Sistema de pedidos: registra um pedido recebido antes de ser
-- produzido/despachado. Ao concluir, gera automaticamente 1 Sale vinculada
-- (saleId, único -- nunca duas Sale pro mesmo pedido).

-- CreateEnum
CREATE TYPE "OrderChannel" AS ENUM ('DIRETA', 'SHOPEE', 'MERCADO_LIVRE');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('RECEBIDO', 'EM_PRODUCAO', 'PRONTO', 'DESPACHADO', 'CONCLUIDO');

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "channel" "OrderChannel" NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "orderDate" TIMESTAMP(3) NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'RECEBIDO',
    "orderNumber" TEXT,
    "notes" TEXT,
    "saleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Order_saleId_key" ON "Order"("saleId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;
