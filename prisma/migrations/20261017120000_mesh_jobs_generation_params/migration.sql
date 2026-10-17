-- AlterTable
ALTER TABLE "Model3DJob"
  ADD COLUMN "generateTexture" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "seed" INTEGER,
  ADD COLUMN "octreeResolution" INTEGER NOT NULL DEFAULT 384,
  ADD COLUMN "textureResolution" INTEGER NOT NULL DEFAULT 512,
  ADD COLUMN "simplifyTarget" INTEGER,
  ADD COLUMN "outputGlb" BYTEA;
