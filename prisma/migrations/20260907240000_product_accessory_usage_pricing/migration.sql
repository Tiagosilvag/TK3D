-- Ficha técnica §2 (task-5 brief): generalizes Product's single-accessory
-- FK (`accessoryId String?`) into a list (`ProductAccessoryUsage`, same
-- shape/relations/cascade behavior as the pre-existing ProductSupplyUsage),
-- and adds the two persisted-price fields (§2's "Preço": suggestedPrice/
-- marketplacePrice, only ever written by an explicit user action, never
-- computed automatically).
--
-- Data-safety (brief's literal 3-step sequence): the join table is created
-- and backfilled from every existing non-null Product.accessoryId FIRST —
-- one ProductAccessoryUsage(quantity=1) row per such Product, matching the
-- old "at most one accessory" semantics exactly — with a runtime count
-- assertion between the backfill and the DROP COLUMN below. If the counts
-- ever disagree, the DO block raises and the whole migration transaction
-- rolls back instead of silently losing an accessory reference (same
-- "stop and report BLOCKED, don't force it" discipline this project's
-- other data-migrations already follow). This was additionally verified by
-- hand against the real dev DB before this migration was written: 0
-- Products existed there at all (empty table), so this file's own
-- assertion below is exercised on the trivial 0-vs-0 case in dev/test, but
-- the logic is written to be correct for a populated Product table too.

-- CreateTable
CREATE TABLE "ProductAccessoryUsage" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "accessoryId" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "ProductAccessoryUsage_pkey" PRIMARY KEY ("id")
);

-- Backfill: one ProductAccessoryUsage(quantity=1) row per Product that had a
-- non-null accessoryId. gen_random_uuid()::text (built into PostgreSQL 13+
-- core, confirmed available on this project's Postgres 16 without needing
-- pgcrypto) mints the id -- Prisma's cuid() generator only runs client-side,
-- never in raw SQL, and the exact id *format* doesn't matter (just
-- uniqueness) since nothing reads these ids by shape.
INSERT INTO "ProductAccessoryUsage" ("id", "productId", "accessoryId", "quantity")
SELECT gen_random_uuid()::text, "id", "accessoryId", 1
FROM "Product"
WHERE "accessoryId" IS NOT NULL;

-- Verify before dropping the old column: abort (rolling back everything in
-- this migration, since DDL is transactional in PostgreSQL) rather than
-- proceed if the backfill didn't preserve every reference 1:1.
DO $$
DECLARE
  before_count INTEGER;
  after_count INTEGER;
BEGIN
  SELECT count(*) INTO before_count FROM "Product" WHERE "accessoryId" IS NOT NULL;
  SELECT count(*) INTO after_count FROM "ProductAccessoryUsage";
  IF before_count <> after_count THEN
    RAISE EXCEPTION 'ProductAccessoryUsage backfill mismatch: % Products with non-null accessoryId vs % ProductAccessoryUsage rows created -- aborting migration, NOT dropping Product.accessoryId', before_count, after_count;
  END IF;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX "ProductAccessoryUsage_productId_accessoryId_key" ON "ProductAccessoryUsage"("productId", "accessoryId");

-- AddForeignKey (same shape as ProductSupplyUsage's: Cascade on the product
-- side, default Restrict on the accessory side -- blocks deleteAccessory
-- while any product still references it, same guarantee
-- Product_accessoryId_fkey had after 20260907220500_accessory_fk_restrict).
ALTER TABLE "ProductAccessoryUsage" ADD CONSTRAINT "ProductAccessoryUsage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductAccessoryUsage" ADD CONSTRAINT "ProductAccessoryUsage_accessoryId_fkey" FOREIGN KEY ("accessoryId") REFERENCES "Accessory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- DropForeignKey: now safe -- every referenced accessoryId has been copied
-- into ProductAccessoryUsage above (verified by the count check above).
ALTER TABLE "Product" DROP CONSTRAINT "Product_accessoryId_fkey";

-- AlterTable: drop the old single-accessory column, add the two
-- persisted-price fields (§2's "Preço") -- both nullable, no default.
ALTER TABLE "Product" DROP COLUMN "accessoryId",
ADD COLUMN     "marketplacePrice" DECIMAL(10,2),
ADD COLUMN     "suggestedPrice" DECIMAL(10,2);
