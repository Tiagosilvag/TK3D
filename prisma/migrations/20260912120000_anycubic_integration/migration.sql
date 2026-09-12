ALTER TABLE "Printer" ADD COLUMN "anycubicEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Printer" ADD COLUMN "anycubicPrinterKey" TEXT;

ALTER TABLE "Settings" ADD COLUMN "anycubicAuthTokenEncrypted" TEXT;
ALTER TABLE "Settings" ADD COLUMN "anycubicUserEmail" TEXT;
ALTER TABLE "Settings" ADD COLUMN "anycubicUserId" TEXT;
