-- Melhoria "Montagem em uma tela só" §4: acessório/insumo debita
-- min(estoque, necessário) e guarda o que foi REALMENTE debitado
-- (StockConsumption.quantity, já existente) pra devolver exatamente o mesmo ao
-- desfazer. `neededQuantity` guarda o que a montagem PRECISAVA -- é o que
-- permite refazer o débito pela diferença ao corrigir a quantidade de uma
-- montagem (quantity pode ser menor que o necessário quando faltou estoque).
-- Nulo em toda linha anterior: nelas debitado == necessário (o débito antigo
-- nunca era limitado), então o código trata nulo como `quantity`. Aditiva.

-- AlterTable
ALTER TABLE "StockConsumption" ADD COLUMN "neededQuantity" DECIMAL(12,3);
