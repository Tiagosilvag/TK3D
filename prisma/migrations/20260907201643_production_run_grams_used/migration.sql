/*
  Warnings:

  - Added the required column `gramsUsed` to the `ProductionRun` table.

  Backfill-safety note: pre-existing ProductionRun rows have no recorded
  gramsUsed value. Rather than adding the column NOT NULL without a default
  (which fails immediately on any non-empty table with
  "column contains null values"), the column is added with DEFAULT 0 so
  existing historical rows backfill to a reasonable default of 0g used.
  The DEFAULT is kept permanently on the column (not dropped after backfill)
  as a safety net for any other pre-existing rows. Application code (see
  lib/validation/productionRun.ts) still requires an explicit gramsUsed on
  every new run going forward, so prisma/schema.prisma intentionally does NOT
  declare @default(0) for this field -- the default exists at the database
  level only, to protect historical data, not to relax the app's contract.
*/
-- AlterTable
ALTER TABLE "ProductionRun" ADD COLUMN     "gramsUsed" DECIMAL(10,2) NOT NULL DEFAULT 0;
