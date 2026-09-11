-- Melhoria "Configurações" §7: modo de arredondamento "Personalizado" --
-- além dos 4 modos fixos (NONE/R90/R99/R00), o usuário escolhe os 2 dígitos
-- finais desejados (roundingCustomCents, 0 a 99), usado só quando
-- roundingMode=CUSTOM.

-- AlterEnum
ALTER TYPE "RoundingMode" ADD VALUE 'CUSTOM';

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN "roundingCustomCents" INTEGER;
