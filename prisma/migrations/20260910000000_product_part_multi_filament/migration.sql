-- Ajuste "peça multi-filamento": uma ProductPart pode precisar de mais de
-- um filamento/cor SIMULTANEAMENTE (impressão multi-material). O par único
-- filamentId/weightGrams vira ProductPartFilament (1 linha por componente
-- da receita) -- toda peça existente vira 1 componente, preservando
-- exatamente o custo/peso que já tinha.
--
-- Também adiciona: ProductionRunFilamentUsage (consumo real por cor numa
-- produção de peça multi-filamento -- vazio pra toda produção existente,
-- que continua só nos campos escalares de ProductionRun) e
-- ProductAssembly.colorChoices (cor escolhida por peça numa leva de
-- montagem -- nulo em montagens já existentes, nunca inventado
-- retroativamente).

-- CreateTable
CREATE TABLE "ProductPartFilament" (
    "id" TEXT NOT NULL,
    "productPartId" TEXT NOT NULL,
    "filamentId" TEXT NOT NULL,
    "weightGrams" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "ProductPartFilament_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ProductPartFilament" ADD CONSTRAINT "ProductPartFilament_productPartId_fkey" FOREIGN KEY ("productPartId") REFERENCES "ProductPart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPartFilament" ADD CONSTRAINT "ProductPartFilament_filamentId_fkey" FOREIGN KEY ("filamentId") REFERENCES "Filament"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: cada ProductPart existente vira 1 componente com seu
-- filamentId/weightGrams atual.
INSERT INTO "ProductPartFilament" ("id", "productPartId", "filamentId", "weightGrams")
SELECT gen_random_uuid()::text, "id", "filamentId", "weightGrams" FROM "ProductPart";

-- DropForeignKey
ALTER TABLE "ProductPart" DROP CONSTRAINT "ProductPart_filamentId_fkey";

-- AlterTable
ALTER TABLE "ProductPart" DROP COLUMN "filamentId",
    DROP COLUMN "weightGrams";

-- CreateTable
CREATE TABLE "ProductionRunFilamentUsage" (
    "id" TEXT NOT NULL,
    "productionRunId" TEXT NOT NULL,
    "filamentId" TEXT NOT NULL,
    "gramsUsed" DECIMAL(10,2) NOT NULL,
    "gramsWasted" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "ProductionRunFilamentUsage_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ProductionRunFilamentUsage" ADD CONSTRAINT "ProductionRunFilamentUsage_productionRunId_fkey" FOREIGN KEY ("productionRunId") REFERENCES "ProductionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionRunFilamentUsage" ADD CONSTRAINT "ProductionRunFilamentUsage_filamentId_fkey" FOREIGN KEY ("filamentId") REFERENCES "Filament"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "ProductAssembly" ADD COLUMN "colorChoices" JSONB;
