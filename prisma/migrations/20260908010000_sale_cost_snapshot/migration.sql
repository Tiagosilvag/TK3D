-- Additive, non-destructive migration (task-10 brief, new feature): Sale
-- gains a nullable costSnapshot column, mirroring ProductionRun's
-- costSnapshot exactly (see 20260908000000_production_run_lifecycle). No
-- existing column is dropped or narrowed, no existing row is deleted, and
-- no backfill is attempted -- pre-existing sales genuinely have no
-- historical Printer/Filament/Accessory/Supply/Settings state to
-- reconstruct a snapshot from, so they stay NULL and getSaleProfit() falls
-- back to a live recompute for them.

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "costSnapshot" JSONB;
