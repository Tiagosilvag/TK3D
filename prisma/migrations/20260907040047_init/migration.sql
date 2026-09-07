-- CreateEnum
CREATE TYPE "AccessoryType" AS ENUM ('CORRENTE_BOLINHA', 'CORRENTE_ELO', 'MOSQUETAO', 'CLICKER', 'OUTRO');

-- CreateEnum
CREATE TYPE "SupplyUnit" AS ENUM ('UN', 'ML', 'G');

-- CreateEnum
CREATE TYPE "FinishingType" AS ENUM ('NENHUM', 'CANETA_VERNIZ', 'RESINA_UV', 'OUTRO');

-- CreateEnum
CREATE TYPE "SaleChannel" AS ENUM ('DIRETA', 'MARKETPLACE');

-- CreateTable
CREATE TABLE "Settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "energyCostPerKwh" DECIMAL(10,4) NOT NULL DEFAULT 1.00,
    "laborCostPerHour" DECIMAL(10,2) NOT NULL DEFAULT 10.00,
    "failureRatePercent" DECIMAL(5,4) NOT NULL DEFAULT 0.10,
    "marketplaceFeePercent" DECIMAL(5,4) NOT NULL DEFAULT 0.20,
    "taxPercent" DECIMAL(5,4) NOT NULL DEFAULT 0.055,
    "marketplaceFixedFee" DECIMAL(10,2) NOT NULL DEFAULT 4.00,
    "defaultMarkup" DECIMAL(6,2) NOT NULL DEFAULT 2.00,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Printer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purchasePrice" DECIMAL(10,2) NOT NULL,
    "depreciationHours" DECIMAL(10,2) NOT NULL,
    "maintenanceCost" DECIMAL(10,2) NOT NULL,
    "avgPowerConsumptionKwh" DECIMAL(6,4) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Printer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Filament" (
    "id" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "diameterMm" DECIMAL(4,2) NOT NULL,
    "spoolPrice" DECIMAL(10,2) NOT NULL,
    "spoolWeightKg" DECIMAL(6,3) NOT NULL,
    "densityGCm3" DECIMAL(5,3) NOT NULL,
    "nozzleTempC" INTEGER NOT NULL,
    "bedTempC" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Filament_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackagingItem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitCost" DECIMAL(10,4) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackagingItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Accessory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccessoryType" NOT NULL,
    "unitCost" DECIMAL(10,4) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Accessory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supply" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" "SupplyUnit" NOT NULL,
    "unitCost" DECIMAL(10,4) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Chaveiro',
    "printerId" TEXT NOT NULL,
    "filamentId" TEXT NOT NULL,
    "weightGrams" DECIMAL(10,2) NOT NULL,
    "printTimeHours" DECIMAL(10,3) NOT NULL,
    "laborTimeHours" DECIMAL(10,3) NOT NULL,
    "packagingItemId" TEXT,
    "accessoryId" TEXT,
    "finishingType" "FinishingType" NOT NULL DEFAULT 'NENHUM',
    "usesGlue" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductSupplyUsage" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "supplyId" TEXT NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,

    CONSTRAINT "ProductSupplyUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionRun" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "printerId" TEXT NOT NULL,
    "filamentId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "quantityPlanned" INTEGER NOT NULL,
    "quantitySuccess" INTEGER NOT NULL,
    "quantityFailed" INTEGER NOT NULL,
    "gramsWasted" DECIMAL(10,2) NOT NULL,
    "timeWastedHours" DECIMAL(10,3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL,
    "channel" "SaleChannel" NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "saleDate" TIMESTAMP(3) NOT NULL,
    "buyerOrPlatform" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsignmentPartner" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultCommissionPercent" DECIMAL(5,4) NOT NULL,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsignmentPartner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsignmentDelivery" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantityDelivered" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "deliveryDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsignmentDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsignmentSaleReport" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "quantitySold" INTEGER NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "commissionPercent" DECIMAL(5,4) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsignmentSaleReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Printer_name_key" ON "Printer"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Filament_manufacturer_key" ON "Filament"("manufacturer");

-- CreateIndex
CREATE UNIQUE INDEX "PackagingItem_name_key" ON "PackagingItem"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Supply_name_key" ON "Supply"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSupplyUsage_productId_supplyId_key" ON "ProductSupplyUsage"("productId", "supplyId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "Printer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_filamentId_fkey" FOREIGN KEY ("filamentId") REFERENCES "Filament"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_packagingItemId_fkey" FOREIGN KEY ("packagingItemId") REFERENCES "PackagingItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_accessoryId_fkey" FOREIGN KEY ("accessoryId") REFERENCES "Accessory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSupplyUsage" ADD CONSTRAINT "ProductSupplyUsage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSupplyUsage" ADD CONSTRAINT "ProductSupplyUsage_supplyId_fkey" FOREIGN KEY ("supplyId") REFERENCES "Supply"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionRun" ADD CONSTRAINT "ProductionRun_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionRun" ADD CONSTRAINT "ProductionRun_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "Printer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionRun" ADD CONSTRAINT "ProductionRun_filamentId_fkey" FOREIGN KEY ("filamentId") REFERENCES "Filament"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsignmentDelivery" ADD CONSTRAINT "ConsignmentDelivery_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "ConsignmentPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsignmentDelivery" ADD CONSTRAINT "ConsignmentDelivery_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsignmentSaleReport" ADD CONSTRAINT "ConsignmentSaleReport_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "ConsignmentDelivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
