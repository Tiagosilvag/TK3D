-- Product.accessoryId's FK previously used Prisma's implicit default for an
-- optional relation (ON DELETE SET NULL), which would silently orphan the
-- pointer on delete instead of blocking it. deleteAccessory (task-3 brief)
-- needs a real FK error to propagate when a Product still references the
-- accessory -- same "não referenciado" guarantee deleteFilament already has
-- for free from its required relation. This does not change what the FK
-- references, only what happens on delete.
ALTER TABLE "Product" DROP CONSTRAINT "Product_accessoryId_fkey";

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_accessoryId_fkey" FOREIGN KEY ("accessoryId") REFERENCES "Accessory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
