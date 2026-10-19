-- Melhoria "Preço por canal": substitui Product.suggestedPrice/
-- marketplacePrice (1 valor "genérico" de marketplace pra ML e Shopee
-- juntos, que nunca batia certo com nenhum dos dois de verdade -- taxas
-- bem diferentes: Shopee 20%+R$5, Mercado Livre 12%+R$0) por 1 preço POR
-- CANAL (Direta/Mercado Livre/Shopee/Consignado). Os 2 campos antigos
-- continuam existindo (ninguém mais os grava depois desta melhoria, mas
-- não removidos -- fora de escopo mexer em quem ainda os lê em telas que
-- não foram tocadas aqui) -- só esta tabela nova entra no lugar como
-- fonte de verdade de "preço aplicado" pra Produtos/Preço por canal.

-- CreateTable
CREATE TABLE "ProductChannelPrice" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "marginTarget" DECIMAL(5,4),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductChannelPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductChannelPrice_productId_channel_key" ON "ProductChannelPrice"("productId", "channel");

-- AddForeignKey
ALTER TABLE "ProductChannelPrice" ADD CONSTRAINT "ProductChannelPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: "preço sugerido" aplicado antes desta melhoria virava preço de
-- Direta E de Consignado (os 2 canais sem taxa de plataforma, mesmo valor
-- que já alimentava os dois antes de existir "por canal"); "preço
-- marketplace" virava preço de Mercado Livre E de Shopee (o único valor
-- que já representava "os dois juntos" antes). Só até o usuário reaplicar
-- um preço de verdade por canal na tela nova -- gen_random_uuid()::text
-- mesma técnica já usada noutras migrations deste projeto pra mintar id
-- em backfill de várias linhas por linha-pai (cuid() só roda client-side).
INSERT INTO "ProductChannelPrice" ("id", "productId", "channel", "price", "updatedAt")
SELECT gen_random_uuid()::text, "id", channel, "suggestedPrice", CURRENT_TIMESTAMP
FROM "Product"
CROSS JOIN (VALUES ('DIRETA'), ('CONSIGNADO')) AS c(channel)
WHERE "suggestedPrice" IS NOT NULL AND "isGift" = false;

INSERT INTO "ProductChannelPrice" ("id", "productId", "channel", "price", "updatedAt")
SELECT gen_random_uuid()::text, "id", channel, "marketplacePrice", CURRENT_TIMESTAMP
FROM "Product"
CROSS JOIN (VALUES ('MERCADO_LIVRE'), ('SHOPEE')) AS c(channel)
WHERE "marketplacePrice" IS NOT NULL AND "isGift" = false;
