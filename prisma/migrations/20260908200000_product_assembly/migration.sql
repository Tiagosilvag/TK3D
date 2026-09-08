-- 2.3 Montagem de produto composto: cada linha registra que `quantity`
-- unidades do produto foram montadas, consumindo quantity ×
-- ProductPart.quantityPerUnit de cada peça (ver comentário no schema).

-- CreateTable
CREATE TABLE "ProductAssembly" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "assembledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductAssembly_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ProductAssembly" ADD CONSTRAINT "ProductAssembly_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
