-- CreateEnum
CREATE TYPE "MarketplaceConnectionStatus" AS ENUM ('CONECTADA', 'DESCONECTADA');

-- CreateEnum
CREATE TYPE "MarketplaceOrderInboxStatus" AS ENUM ('PENDENTE', 'CONFIRMADO', 'IGNORADO');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('NOVO_PEDIDO_MARKETPLACE');

-- CreateTable
CREATE TABLE "MarketplaceConnection" (
    "id" TEXT NOT NULL,
    "platform" "MarketplacePlatformKind" NOT NULL,
    "sellerId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "status" "MarketplaceConnectionStatus" NOT NULL DEFAULT 'CONECTADA',
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceOrderInbox" (
    "id" TEXT NOT NULL,
    "platform" "MarketplacePlatformKind" NOT NULL,
    "externalOrderId" TEXT NOT NULL,
    "buyerName" TEXT,
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "items" JSONB NOT NULL,
    "status" "MarketplaceOrderInboxStatus" NOT NULL DEFAULT 'PENDENTE',
    "confirmedOrderId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceOrderInbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "seenAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceConnection_platform_key" ON "MarketplaceConnection"("platform");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceOrderInbox_confirmedOrderId_key" ON "MarketplaceOrderInbox"("confirmedOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceOrderInbox_platform_externalOrderId_key" ON "MarketplaceOrderInbox"("platform", "externalOrderId");

-- AddForeignKey
ALTER TABLE "MarketplaceOrderInbox" ADD CONSTRAINT "MarketplaceOrderInbox_confirmedOrderId_fkey" FOREIGN KEY ("confirmedOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
