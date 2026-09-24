-- Melhoria "Estoque de filamento por custo médio ponderado" (confirmado
-- pelo usuário): consolida N linhas por marca+material+cor (cada uma um
-- rolo físico com rollNumber/spoolWeightKg/spoolPrice próprios) em 1 única
-- linha por SKU, com estoque em gramas somado e custo médio ponderado por
-- grama -- mesmo modelo já usado por Accessory/Supply (avgUnitCost +
-- tabela de Purchase). Cada rolo existente vira 1 FilamentPurchase
-- (histórico nunca perdido), e toda FK que apontava pra um rolo
-- não-canônico é repontada pro rolo canônico do mesmo grupo antes de
-- apagar as linhas extras.

-- CreateTable
CREATE TABLE "FilamentPurchase" (
    "id" TEXT NOT NULL,
    "filamentId" TEXT NOT NULL,
    "weightGrams" DECIMAL(10,2) NOT NULL,
    "totalCost" DECIMAL(10,2) NOT NULL,
    "purchaseDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FilamentPurchase_pkey" PRIMARY KEY ("id")
);

-- Mapeamento rolo -> linha canônica do seu grupo (marca+material+cor),
-- escolhendo o menor rollNumber (normalmente o Rolo #001) como sobrevivente.
CREATE TEMP TABLE "_FilamentCanonical" AS
SELECT
  f.id AS "oldId",
  first_value(f.id) OVER (PARTITION BY f.manufacturer, f.material, f."colorName" ORDER BY f."rollNumber", f.id) AS "canonicalId"
FROM "Filament" f;

-- Histórico: 1 FilamentPurchase por rolo existente, já apontando pra linha
-- canônica do grupo -- nenhum dado de compra é perdido na consolidação.
INSERT INTO "FilamentPurchase" ("id", "filamentId", "weightGrams", "totalCost", "purchaseDate", "notes", "createdAt")
SELECT
  gen_random_uuid()::text,
  c."canonicalId",
  f."initialStockGrams",
  f."spoolPrice",
  f."createdAt",
  'Migrado do modelo por rolo (Rolo #' || f."rollNumber" || ')',
  f."createdAt"
FROM "Filament" f
JOIN "_FilamentCanonical" c ON c."oldId" = f.id;

-- Repontea toda FK que apontava pra um rolo não-canônico pro canônico do
-- mesmo grupo -- feito ANTES de apagar as linhas extras (senão a
-- violação de integridade referencial bloquearia o DELETE abaixo).
UPDATE "Product" p SET "filamentId" = c."canonicalId"
FROM "_FilamentCanonical" c
WHERE p."filamentId" = c."oldId" AND c."oldId" <> c."canonicalId";

UPDATE "ProductPartFilament" ppf SET "filamentId" = c."canonicalId"
FROM "_FilamentCanonical" c
WHERE ppf."filamentId" = c."oldId" AND c."oldId" <> c."canonicalId";

UPDATE "ProductionRun" pr SET "filamentId" = c."canonicalId"
FROM "_FilamentCanonical" c
WHERE pr."filamentId" = c."oldId" AND c."oldId" <> c."canonicalId";

UPDATE "ProductionRunFilamentUsage" pru SET "filamentId" = c."canonicalId"
FROM "_FilamentCanonical" c
WHERE pru."filamentId" = c."oldId" AND c."oldId" <> c."canonicalId";

-- StockAdjustment.resourceId é polimórfico sem FK física (mesmo padrão de
-- StockConsumption) -- repontear aqui também, senão um ajuste antigo feito
-- num rolo não-canônico "sumiria" do histórico da linha que sobrevive.
UPDATE "StockAdjustment" sa SET "resourceId" = c."canonicalId"
FROM "_FilamentCanonical" c
WHERE sa."resourceType" = 'FILAMENT' AND sa."resourceId" = c."oldId" AND c."oldId" <> c."canonicalId";

-- Agrega estoque (soma de todo o grupo) e custo médio ponderado
-- (SUM(spoolPrice) / SUM(initialStockGrams) -- equivalente a
-- calculateWeightedAverageCost partindo de estoque/custo zerados) na linha
-- canônica.
ALTER TABLE "Filament" ADD COLUMN "avgUnitCostPerGram" DECIMAL(10,4);

UPDATE "Filament" f SET
  "currentStockGrams" = agg."totalCurrentStock",
  "avgUnitCostPerGram" = CASE WHEN agg."totalInitialStock" > 0 THEN agg."totalCost" / agg."totalInitialStock" ELSE 0 END
FROM (
  SELECT c."canonicalId", SUM(g."currentStockGrams") AS "totalCurrentStock", SUM(g."spoolPrice") AS "totalCost", SUM(g."initialStockGrams") AS "totalInitialStock"
  FROM "Filament" g
  JOIN "_FilamentCanonical" c ON c."oldId" = g.id
  GROUP BY c."canonicalId"
) agg
WHERE f.id = agg."canonicalId";

-- Apaga os rolos não-canônicos -- seguro agora que toda FK/StockAdjustment
-- já foi repontada e o histórico virou FilamentPurchase.
DELETE FROM "Filament" f
USING "_FilamentCanonical" c
WHERE f.id = c."oldId" AND c."oldId" <> c."canonicalId";

DROP TABLE "_FilamentCanonical";

-- AlterTable: remove colunas do modelo por rolo, torna avgUnitCostPerGram
-- obrigatório (já preenchido pra toda linha que sobrou acima).
ALTER TABLE "Filament"
  ALTER COLUMN "avgUnitCostPerGram" SET NOT NULL,
  DROP COLUMN "rollNumber",
  DROP COLUMN "spoolWeightKg",
  DROP COLUMN "spoolPrice",
  DROP COLUMN "initialStockGrams";

-- DropIndex / CreateIndex: unicidade agora é só marca+material+cor (1 linha
-- por SKU, sem rollNumber).
DROP INDEX "Filament_manufacturer_material_colorName_rollNumber_key";
CREATE UNIQUE INDEX "Filament_manufacturer_material_colorName_key" ON "Filament"("manufacturer", "material", "colorName");

-- AddForeignKey
ALTER TABLE "FilamentPurchase" ADD CONSTRAINT "FilamentPurchase_filamentId_fkey" FOREIGN KEY ("filamentId") REFERENCES "Filament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
