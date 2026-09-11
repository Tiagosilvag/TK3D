-- Melhoria "Insumos": Supply.defaultUsage guarda quanto desse insumo uma
-- peça/produção costuma consumir (ex.: 1ml de cola), informado manualmente
-- no cadastro -- pré-preenche o campo de quantidade sempre que o insumo é
-- adicionado numa ficha técnica, continuando editável ali. Opcional/nulo
-- pra insumo já cadastrado, nunca inventado retroativamente.

-- AlterTable
ALTER TABLE "Supply" ADD COLUMN "defaultUsage" DECIMAL(10,3);
