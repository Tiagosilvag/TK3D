-- Melhoria "Detalhe da entrega em consignação" -- selo "✎ Editada hoje":
-- aditiva, com default pro backfill de linha existente (updatedAt = agora
-- na migration, nunca inventa uma data passada). Prisma mantém esse campo
-- atualizado sozinho em todo UPDATE a partir daqui (@updatedAt).
ALTER TABLE "ConsignmentDelivery" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
