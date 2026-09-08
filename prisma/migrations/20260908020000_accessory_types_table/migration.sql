-- Tipos de acessório: movidos de enum fixo ("AccessoryType") para tabela
-- editável em runtime ("accessory_types"), com CRUD em Configurações. Os 5
-- tipos originais mantêm exatamente o texto do antigo enum como `id` --
-- Accessory."type" já guarda esse mesmo texto em toda linha existente, então
-- convertê-lo de enum pra texto simples referenciando accessory_types(id)
-- não exige reescrever nenhuma linha de Accessory.

-- CreateTable
CREATE TABLE "accessory_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accessory_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accessory_types_name_key" ON "accessory_types"("name");

-- Seed the 5 pre-existing enum values as rows, id = old enum text (so every
-- existing Accessory."type" value already matches a row here).
INSERT INTO "accessory_types" ("id", "name") VALUES
  ('CORRENTE_BOLINHA', 'Corrente bolinha'),
  ('CORRENTE_ELO', 'Corrente elo'),
  ('MOSQUETAO', 'Mosquetão'),
  ('CLICKER', 'Clicker'),
  ('OUTRO', 'Outro');

-- Convert Accessory."type" from the enum to plain text carrying the same
-- values, then point it at accessory_types(id).
ALTER TABLE "Accessory" ALTER COLUMN "type" TYPE TEXT USING "type"::TEXT;

-- AddForeignKey
ALTER TABLE "Accessory" ADD CONSTRAINT "Accessory_type_fkey" FOREIGN KEY ("type") REFERENCES "accessory_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The enum type is no longer referenced by any column.
DROP TYPE "AccessoryType";
