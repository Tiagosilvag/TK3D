-- Melhoria "Produção" (reformulação Plate): várias peças -- do mesmo
-- produto ou de produtos diferentes -- impressas juntas na mesma
-- impressão física, com custo de impressora rateado entre elas (ver
-- lib/costing.ts#allocatePlatePrintTime). Toda ProductionRun existente
-- continua "produção individual" (plateId NULL) -- nenhum backfill
-- necessário, é exatamente o que já eram.

-- CreateTable
CREATE TABLE "Plate" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "printerId" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Plate_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Plate" ADD CONSTRAINT "Plate_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "Printer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "ProductionRun" ADD COLUMN "plateId" TEXT;

-- AddForeignKey
ALTER TABLE "ProductionRun" ADD CONSTRAINT "ProductionRun_plateId_fkey" FOREIGN KEY ("plateId") REFERENCES "Plate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "ProductionRun_plateId_idx" ON "ProductionRun"("plateId");
