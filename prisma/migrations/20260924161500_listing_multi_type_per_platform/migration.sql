-- Melhoria "mais de 1 anúncio por produto": Mercado Livre permite ter
-- Clássico E Premium do mesmo produto simultaneamente -- o unique antigo
-- ([productId, platformId]) travava em 1 anúncio por produto+plataforma
-- TOTAL, impedindo cadastrar o 2º tipo (bug reportado: "já foi cadastrado
-- clássico e não deixa cadastrar premium"). Substituído por 2 índices
-- únicos PARCIAIS: um cobre Shopee (sem Tipo, sempre null -- continua no
-- máximo 1 por produto+plataforma) e outro cobre Mercado Livre (no máximo
-- 1 de cada Tipo por produto).
DROP INDEX "Listing_productId_platformId_key";

CREATE UNIQUE INDEX "Listing_productId_platformId_no_type_key" ON "Listing"("productId", "platformId") WHERE "listingType" IS NULL;

CREATE UNIQUE INDEX "Listing_productId_platformId_listingType_key" ON "Listing"("productId", "platformId", "listingType") WHERE "listingType" IS NOT NULL;
