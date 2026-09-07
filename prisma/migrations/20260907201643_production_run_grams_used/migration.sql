/*
  Warnings:

  - Added the required column `gramsUsed` to the `ProductionRun` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ProductionRun" ADD COLUMN     "gramsUsed" DECIMAL(10,2) NOT NULL;
