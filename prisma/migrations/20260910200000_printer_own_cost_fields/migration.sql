-- Melhorias tela Impressoras: apelido + tarifa de energia (R$/kWh) e
-- manutenção (R$/h) passam a ser um valor PRÓPRIO de cada impressora, em
-- vez de vir de Settings.energyCostPerKwh/annualMaintenancePercent/
-- annualUsageHours (globais, compartilhados por todas as impressoras).
-- Settings mantém os 3 campos antigos no schema -- fora do escopo desta
-- mudança remover a tela de Configurações -- eles só deixam de alimentar
-- o custo de impressora a partir daqui.
--
-- Sem backfill calculado por linha aqui de propósito (decisão explícita):
-- toda impressora já cadastrada em qualquer ambiente recebe o DEFAULT da
-- coluna (energyCostPerKwh 1.00 -- mesmo default que Settings sempre teve,
-- então nenhuma impressora que só usava tarifa padrão muda de custo;
-- maintenanceCostPerHour 0 -- fica assim até o usuário abrir a impressora
-- e preencher o valor real, mesmo espírito de "nunca inventar dado" já
-- usado no backfill de avgUnitCost do Accessory/Supply). Nenhuma linha é
-- excluída por esta migration.
ALTER TABLE "Printer" ADD COLUMN "nickname" TEXT;
ALTER TABLE "Printer" ADD COLUMN "energyCostPerKwh" DECIMAL(10,4) NOT NULL DEFAULT 1.00;
ALTER TABLE "Printer" ADD COLUMN "maintenanceCostPerHour" DECIMAL(10,4) NOT NULL DEFAULT 0;
