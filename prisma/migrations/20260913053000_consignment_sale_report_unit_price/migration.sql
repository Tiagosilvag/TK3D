-- Melhoria "Registrar venda": permite sobrescrever o preço unitário de uma
-- venda específica, quando o parceiro vendeu por um valor diferente do
-- cadastrado na entrega (ConsignmentDelivery.unitPrice). Nulo em todo
-- relatório existente (e em qualquer venda nova sem sobrescrever) -- nunca
-- inventa retroativamente um preço; cálculos de bruto/repasse passam a ler
-- `report.unitPrice ?? delivery.unitPrice`.

-- AlterTable
ALTER TABLE "ConsignmentSaleReport" ADD COLUMN "unitPrice" DECIMAL(10,2);
