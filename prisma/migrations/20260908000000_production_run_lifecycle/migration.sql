-- Non-destructive migration (spec §5.4, task-7 brief): ProductionRun gains
-- lifecycle/cancellation fields plus a historical cost snapshot. No existing
-- column is dropped or narrowed and no existing row is deleted.

-- CreateEnum
CREATE TYPE "WasteReason" AS ENUM ('FALHA_IMPRESSAO', 'ERRO_CONFIGURACAO', 'SUPORTE_EXCESSIVO', 'QUEBRA', 'TESTE', 'PURGA', 'TROCA_FILAMENTO', 'OUTRO');

-- CreateEnum
CREATE TYPE "ProductionStatus" AS ENUM ('CONCLUIDA', 'PARCIAL', 'COM_FALHAS', 'CANCELADA');

-- AlterTable: costSnapshot is nullable with NO default -- pre-existing runs
-- genuinely have no historical cost snapshot to backfill (there is no
-- retroactive Printer/Filament/Settings state to reconstruct one from), so
-- they are left NULL rather than invented. status gets a temporary DEFAULT
-- so the NOT NULL constraint is satisfiable for existing rows, then the
-- UPDATE below backfills it accurately from data those rows already have
-- (quantityFailed/quantitySuccess/quantityPlanned), using the exact same
-- rule createProductionRun applies to new rows (spec §5.4). wasteReason/
-- cancelReason/cancelDate are all nullable with no backfill needed --
-- no pre-existing run was ever cancelled or classified by waste reason.
ALTER TABLE "ProductionRun" ADD COLUMN     "costSnapshot" JSONB,
ADD COLUMN     "status" "ProductionStatus" NOT NULL DEFAULT 'CONCLUIDA',
ADD COLUMN     "wasteReason" "WasteReason",
ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelDate" TIMESTAMP(3);

-- Backfill status for pre-existing rows using the same rule as spec §5.4
-- ("CANCELADA só via ação de cancelamento; senão COM_FALHAS se
-- quantityFailed > 0; senão PARCIAL se quantitySuccess < quantityPlanned;
-- senão CONCLUIDA") -- no pre-existing row was ever cancelled (that action
-- didn't exist yet), so CANCELADA never applies here.
UPDATE "ProductionRun" SET "status" = CASE
  WHEN "quantityFailed" > 0 THEN 'COM_FALHAS'::"ProductionStatus"
  WHEN "quantitySuccess" < "quantityPlanned" THEN 'PARCIAL'::"ProductionStatus"
  ELSE 'CONCLUIDA'::"ProductionStatus"
END;
