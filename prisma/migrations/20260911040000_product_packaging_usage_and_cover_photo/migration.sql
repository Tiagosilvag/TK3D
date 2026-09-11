-- Melhoria "Produtos" §3: generaliza Product.packagingItemId (FK único)
-- numa lista real (ProductPackagingUsage), mesmo padrão não-destrutivo já
-- usado em 20260907240000_product_accessory_usage_pricing: tabela nova
-- criada e backfillada a partir de toda linha existente ANTES de apagar a
-- coluna antiga, com um assert de contagem no meio pra abortar (rollback
-- automático, DDL é transacional) em vez de perder referência silenciosamente.

-- CreateTable
CREATE TABLE "ProductPackagingUsage" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "packagingItemId" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "ProductPackagingUsage_pkey" PRIMARY KEY ("id")
);

-- Backfill: um ProductPackagingUsage(quantity=1) por Product que tinha
-- packagingItemId não-nulo, preservando a semântica antiga de "no máximo 1
-- embalagem" como o caso degenerado de uma lista de 1 item.
INSERT INTO "ProductPackagingUsage" ("id", "productId", "packagingItemId", "quantity")
SELECT gen_random_uuid()::text, "id", "packagingItemId", 1
FROM "Product"
WHERE "packagingItemId" IS NOT NULL;

-- Verifica antes de apagar a coluna antiga: aborta a migração inteira se o
-- backfill não preservou toda referência 1:1.
DO $$
DECLARE
  before_count INTEGER;
  after_count INTEGER;
BEGIN
  SELECT count(*) INTO before_count FROM "Product" WHERE "packagingItemId" IS NOT NULL;
  SELECT count(*) INTO after_count FROM "ProductPackagingUsage";
  IF before_count <> after_count THEN
    RAISE EXCEPTION 'ProductPackagingUsage backfill mismatch: % Products com packagingItemId vs % linhas criadas -- abortando, NAO apagando Product.packagingItemId', before_count, after_count;
  END IF;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX "ProductPackagingUsage_productId_packagingItemId_key" ON "ProductPackagingUsage"("productId", "packagingItemId");

-- AddForeignKey (mesmo formato de ProductSupplyUsage: Cascade no lado do
-- produto, Restrict -- default -- no lado da embalagem, bloqueando
-- deletePackagingItem enquanto algum produto ainda referenciar ela)
ALTER TABLE "ProductPackagingUsage" ADD CONSTRAINT "ProductPackagingUsage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductPackagingUsage" ADD CONSTRAINT "ProductPackagingUsage_packagingItemId_fkey" FOREIGN KEY ("packagingItemId") REFERENCES "PackagingItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- DropForeignKey: seguro agora -- toda referência já foi copiada acima
-- (verificado pelo assert).
ALTER TABLE "Product" DROP CONSTRAINT "Product_packagingItemId_fkey";

-- AlterTable
ALTER TABLE "Product" DROP COLUMN "packagingItemId";

-- Melhoria "Produtos" §3: foto de capa -- clicar numa foto já enviada marca
-- ela, sem campo de upload separado. Índice único parcial garante no
-- máximo 1 capa por produto direto no banco (mais forte que confiar só na
-- aplicação pra nunca marcar duas).
ALTER TABLE "ProductPhoto" ADD COLUMN "isCover" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "ProductPhoto_productId_cover_key" ON "ProductPhoto"("productId") WHERE "isCover" = true;
