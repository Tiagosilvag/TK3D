-- CreateEnum
CREATE TYPE "Model3DJobStatus" AS ENUM ('PENDENTE', 'PROCESSANDO', 'CONCLUIDO', 'ERRO');

-- CreateTable
CREATE TABLE "Model3DJob" (
    "id" TEXT NOT NULL,
    "status" "Model3DJobStatus" NOT NULL DEFAULT 'PENDENTE',
    "inputImage" BYTEA NOT NULL,
    "inputContentType" TEXT NOT NULL,
    "inputSizeBytes" INTEGER NOT NULL,
    "outputObj" BYTEA,
    "outputStl" BYTEA,
    "errorMessage" TEXT,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Model3DJob_pkey" PRIMARY KEY ("id")
);
