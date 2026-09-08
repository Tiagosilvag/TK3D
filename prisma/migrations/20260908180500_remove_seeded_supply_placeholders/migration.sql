-- Bug 2: prisma/seed.ts used to upsert 4 placeholder Supply rows (Caneta
-- acrílica, Spray verniz, Resina UV, Cola Tekbond 200) with
-- currentStock=0/avgUnitCost=0 on every deploy. A Supply that starts at
-- zero stock is permanently "Esgotado" (nothing ever restocks a row nobody
-- knows exists) and, once esgotado, deleteSupply refuses to remove it
-- (spec §1.3 -- "itens esgotados não podem ser excluídos") -- so these 4
-- rows kept surfacing in the Dashboard's "insumos esgotados ou críticos"
-- alert forever, with no way to clear them from the UI.
--
-- Distinguishing signal: every REAL Supply is created via createSupply,
-- which always inserts its first SupplyPurchase in the same transaction
-- (actions/supplies.ts) -- so a genuine Supply always has >=1 purchase.
-- These seed rows never went through that path and have zero
-- SupplyPurchase rows. Deleting by "one of the 4 known seed names AND no
-- purchase history at all" removes exactly (and only) the untouched
-- placeholders, never a real item -- even one that happens to share a
-- similar name but was actually purchased through the app.
DELETE FROM "Supply"
WHERE "name" IN ('Caneta acrílica', 'Spray verniz', 'Resina UV', 'Cola Tekbond 200')
  AND NOT EXISTS (
    SELECT 1 FROM "SupplyPurchase" WHERE "SupplyPurchase"."supplyId" = "Supply"."id"
  );
