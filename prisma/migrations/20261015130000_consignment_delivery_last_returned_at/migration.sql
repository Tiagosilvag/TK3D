-- Melhoria "Rastreio por unidade" (/stock, modal Variações) -- data da
-- devolução pro passo "Devolvida dd/mm" da trilha por unidade.
-- Aditiva, sem backfill (nulo em toda linha existente -- nunca inventa
-- uma data retroativa que não foi registrada).
ALTER TABLE "ConsignmentDelivery" ADD COLUMN "lastReturnedAt" TIMESTAMP(3);
