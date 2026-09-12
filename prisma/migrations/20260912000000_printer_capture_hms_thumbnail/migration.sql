-- Ajuste "extrair mais dados" (2026-09-12): código HMS bruto (hex) da falha
-- e foto/thumbnail do histórico oficial da nuvem Bambu.
ALTER TABLE "PrinterCapture" ADD COLUMN "hmsCode" TEXT;
ALTER TABLE "PrinterCapture" ADD COLUMN "thumbnailUrl" TEXT;
