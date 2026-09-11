-- Melhoria "Vendas por variante": Sale ganha colorComboKey, mesma
-- convenção já usada em ConsignmentDelivery.colorComboKey -- permite
-- perguntar qual cor foi vendida quando o produto tem mais de uma
-- variante em estoque. Nulo em vendas existentes (sem backfill --
-- nunca inventa retroativamente qual cor foi vendida).

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN "colorComboKey" TEXT;
