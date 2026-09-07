# Custeio de Impressoras + Estoque de Filamentos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automate printer hourly cost (depreciation + maintenance + energy, all derived, nothing manual) and turn the Filament catalog into a per-roll stock system that production consumes automatically.

**Architecture:** Same stack as the rest of the app (Next.js 15 Server Actions, Prisma/Postgres, Zod, the established `{success,error?}` CRUD contract, `tk-*` CSS component classes). This plan modifies existing, deployed functionality — treat every change as a regression risk against the live app, not just new code.

**Spec:** `docs/superpowers/specs/2026-09-07-custeio-impressora-estoque-filamento-design.md`

## Global Constraints

- All monetary/weight fields stay `Decimal` in Prisma; convert with `.toNumber()` before arithmetic in `lib/costing.ts` — never compute on a raw Decimal.
- Local dev/test Postgres: role `tk3d`/`tk3d_dev_password`, databases `tk3d_dev` (dev) and `tk3d_test` (integration tests) on `localhost:5432`, already running. `tk3d_test` is schema-synced via `prisma db push` (not migration-tracked) — after any schema change, re-run `npx dotenv -e .env -- env DATABASE_URL="$TEST_DATABASE_URL" npx prisma db push --skip-generate` before running tests that touch the new/changed tables (`TEST_DATABASE_URL` is in `.env`).
- All UI text in Portuguese. Currency via `lib/format.ts`'s `formatCurrency` (never hand-rolled `R$ ${x.toFixed(2)}`).
- Follow the established CRUD pattern (read `actions/printers.ts` / `actions/productionRuns.ts` before writing new actions): `{success, error?}` contract, Zod validation with Portuguese messages on every field, `revalidatePath` on mutation.
- `fileParallelism: false` is already set in `vitest.config.ts` — new integration test files must still clean up children before parents in `beforeEach`/`afterAll` (see any existing `tests/integration/*.test.ts` for the pattern).
- Every destructive delete button uses `components/ConfirmDeleteForm.tsx` (already established).

---

### Task 1: Printer costing rework — schema, costing engine, Settings, Printer UI

**Files:**
- Modify: `prisma/schema.prisma` (Settings, Printer)
- Modify: `lib/costing.ts`, `tests/unit/costing.test.ts`
- Modify: `lib/validation/settings.ts`, `actions/settings.ts`, `app/(app)/settings/SettingsForm.tsx`, `app/(app)/settings/page.tsx`
- Modify: `lib/validation/printer.ts`, `actions/printers.ts`, `app/(app)/printers/PrinterForm.tsx`, `app/(app)/printers/page.tsx`
- Modify: `actions/products.ts` (`getProductCostBreakdown`), `app/(app)/products/CostBreakdown.tsx`, `app/(app)/production/page.tsx` (any inline depreciation calc)
- Modify: `lib/reports.ts` (`getTotalWasteCost`'s inline depreciation calc)

**Interfaces:**
- Produces: `calculatePrinterDepreciationCostPerHour({purchasePrice, depreciationHours})`,
  `calculatePrinterMaintenanceCostPerHour({purchasePrice, annualMaintenancePercent, annualUsageHours})`
  in `lib/costing.ts` — Task 2-4 don't consume these directly but any future printer-cost call site must use them, not inline math (this plan's own Task 1 removes ALL existing inline copies — see the "printer cost formula duplication" note the original app's final review flagged; don't reintroduce it).
- `ProductCostBreakdown` gains a `maintenanceCost: number` field.

- [ ] **Step 1: Update `prisma/schema.prisma`**

Remove `maintenanceCost` from `Printer`. Add to `Settings`:

```prisma
  annualMaintenancePercent Decimal @default(0.10) @db.Decimal(5, 4)
  annualUsageHours         Decimal @default(2000) @db.Decimal(10, 2)
```

- [ ] **Step 2: Migrate**

```bash
npx dotenv -e .env -- npx prisma migrate dev --name printer_costing_rework
```

Confirm the generated migration drops `Printer.maintenanceCost` and adds the two `Settings` columns. Apply the same shape to the test DB: `DATABASE_URL="$TEST_DATABASE_URL" npx prisma db push --skip-generate` (read `TEST_DATABASE_URL` from `.env`).

- [ ] **Step 3: Rewrite the printer-cost unit tests (TDD — write first, confirm they fail against the old `lib/costing.ts`)**

Replace the printer-related tests in `tests/unit/costing.test.ts` (keep the filament-price and product-cost-shape tests that don't depend on the old maintenance-in-depreciation formula; the `calculateProductCost` tests need updating since `ProductCostBreakdown` gains `maintenanceCost` and `subtotal` changes):

```typescript
describe('calculatePrinterDepreciationCostPerHour (no maintenance folded in)', () => {
  it('Bambu Lab A1 Mini: 3000 / 10000h', () => {
    expect(calculatePrinterDepreciationCostPerHour({ purchasePrice: 3000, depreciationHours: 10000 })).toBeCloseTo(0.30, 4)
  })
})

describe('calculatePrinterMaintenanceCostPerHour', () => {
  it('exemplo da spec: 3000 * 10% / 8000h', () => {
    expect(calculatePrinterMaintenanceCostPerHour({ purchasePrice: 3000, annualMaintenancePercent: 0.10, annualUsageHours: 8000 })).toBeCloseTo(0.0375, 4)
  })
})
```

Update `calculateProductCost`'s existing test cases: add `printerMaintenanceCostPerHour` to the `ProductCostInput`-shaped test input (alongside the existing `printerDepreciationCostPerHour` field — both are precomputed by the caller and passed in, same convention as today) and assert `result.maintenanceCost` and the new `result.subtotal` that includes it. The `Settings` interface itself (energyCostPerKwh, laborCostPerHour, etc.) does NOT gain a printer field — printer costs are only ever passed via `ProductCostInput`. Compute the expected numbers by hand from the new formulas before writing the assertions — don't guess.

- [ ] **Step 4: Run and confirm failures, then implement `lib/costing.ts`**

```typescript
export interface PrinterDepreciationInput {
  purchasePrice: number
  depreciationHours: number
}

export function calculatePrinterDepreciationCostPerHour(input: PrinterDepreciationInput): number {
  return input.purchasePrice / input.depreciationHours
}

export interface PrinterMaintenanceInput {
  purchasePrice: number
  annualMaintenancePercent: number
  annualUsageHours: number
}

export function calculatePrinterMaintenanceCostPerHour(input: PrinterMaintenanceInput): number {
  return (input.purchasePrice * input.annualMaintenancePercent) / input.annualUsageHours
}
```

Update `ProductCostInput` to take `printerDepreciationCostPerHour` and a new `printerMaintenanceCostPerHour` (both precomputed by the caller, same convention as today), `ProductCostBreakdown` to add `maintenanceCost: number`, and `calculateProductCost`'s body:

```typescript
const printerCost = input.printerDepreciationCostPerHour * input.printTimeHours
const maintenanceCost = input.printerMaintenanceCostPerHour * input.printTimeHours
// ...
const subtotal = filamentCost + electricityCost + printerCost + maintenanceCost + laborCost
  + input.suppliesCost + input.packagingCost + input.accessoryCost
```

Return `maintenanceCost` in the breakdown object alongside the existing fields.

- [ ] **Step 5: Run and confirm the unit tests pass**

- [ ] **Step 6: Settings — add the two fields**

`lib/validation/settings.ts`: add `annualMaintenancePercent` (reuse the existing `percent()` helper — 0 to 1) and `annualUsageHours` (`z.coerce.number().positive('Deve ser maior que zero')`), Portuguese messages. `actions/settings.ts`'s `updateSettings` needs no change beyond the schema picking up the new fields (it already spreads `parsed.data`). Add the two inputs to `SettingsForm.tsx` following the existing field pattern (label + `tk-input-full`, `defaultValue={settings.annualMaintenancePercent}` etc.), and pass the new values through in `settings/page.tsx`'s prop mapping (same `.toNumber()` pattern as the existing fields).

- [ ] **Step 7: Printer — drop the manual maintenance field, wire the new calc**

`lib/validation/printer.ts`: remove `maintenanceCost` from `printerSchema`.

`actions/printers.ts`: `createPrinter`/`updatePrinter` no longer parse/write `maintenanceCost` (Zod already drops it from `parsed.data` once removed from the schema — no other change needed there).

`app/(app)/printers/PrinterForm.tsx`: remove the "Custo manutenção" input. Convert the form into a small client component (it's currently likely a server-rendered form posting a server action directly — keep that for submission, but wrap the numeric inputs in local `useState` so a live preview can render below the fields). Fetch current `Settings` values as props from the server page (`page.tsx` already queries `Settings` elsewhere in the app — add a `prisma.settings.findUniqueOrThrow({where:{id:1}})` call there and pass `annualMaintenancePercent`/`annualUsageHours`/`energyCostPerKwh` as props into `PrinterForm`). Inside the form, on every keystroke of `purchasePrice`/`depreciationHours`/`avgPowerConsumptionKwh`, recompute and display (below the button, small muted text) the same three derived lines the table shows, using the exact same formulas as `lib/costing.ts` (duplicate the two small pure functions inline in the client component — they're one-liners, not worth importing a server-only module into a client bundle over). If `purchasePrice` or `depreciationHours` is empty/zero/NaN, show "—" instead of a computed value (never `NaN`/`Infinity`).

`app/(app)/printers/page.tsx`: the list table gains 3 columns (Manutenção R$/h, Custo total R$/h — Energia R$/h likely already exists from the earlier design pass, confirm). Compute all four (`depreciationCostPerHour`, `maintenanceCostPerHour`, `electricityCostPerHour` = `avgPowerConsumptionKwh * settings.energyCostPerKwh`, and their sum) per printer row using the `lib/costing.ts` functions, fetching `Settings` once for the whole page.

- [ ] **Step 8: Fix every other call site that computed printer depreciation inline**

Grep the codebase for the old inline formula `(purchasePrice... + maintenanceCost...) / depreciationHours` and any place recomputing printer cost by hand (`actions/products.ts`'s `getProductCostBreakdown`, `app/(app)/production/page.tsx`, `lib/reports.ts`'s `getTotalWasteCost`) — replace every one with calls to `calculatePrinterDepreciationCostPerHour` + `calculatePrinterMaintenanceCostPerHour` from `lib/costing.ts`, and thread `maintenanceCost` into whatever cost breakdown each call site displays (e.g. `CostBreakdown.tsx` needs a new "Manutenção" line next to the existing "Depreciação da impressora" line). This is exactly the "inline formula duplication" the app's original final review flagged as a latent risk — Task 1 is the chance to actually remove it, not add a fourth copy.

- [ ] **Step 9: Verify**

`npm run build`, `npm test`, `npm run lint` all clean. Manually reason through the spec's worked example (purchasePrice 3000, depreciationHours 8000 → depreciation R$/h... wait, the spec's maintenance example uses 8000h for a maintenance-only illustration, not tied to a specific depreciationHours value — don't conflate the two; just confirm each formula independently matches its own spec example).

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: automate printer depreciation/maintenance cost calculation"
```

---

### Task 2: Filament schema rework (new roll-based model, destructive reset)

**Files:**
- Modify: `prisma/schema.prisma` (new `FilamentMaterial` enum, new `MaterialDefaults` model, rewritten `Filament` model)
- Create: `prisma/migrations/<timestamp>_filament_stock_rework/migration.sql` (hand-adjusted — see Step 2)
- Modify: `prisma/seed.ts` (remove old filament seed rows, add `MaterialDefaults` seed)

**Interfaces:**
- Produces: `Filament` model with `manufacturer, material, colorName, colorHex, rollNumber, spoolWeightKg, spoolPrice, initialStockGrams, currentStockGrams` — Task 3 (Filament CRUD) and Task 4 (Production integration) both depend on this exact shape.
- Produces: `MaterialDefaults` model keyed by `material` — informational only, not consumed by `lib/costing.ts`.

- [ ] **Step 1: Rewrite the `Filament` block in `prisma/schema.prisma`**

```prisma
enum FilamentMaterial {
  PLA
  PETG
  TPU
  OUTRO
}

model MaterialDefaults {
  material    FilamentMaterial @id
  diameterMm  Decimal          @db.Decimal(4, 2)
  densityGCm3 Decimal          @db.Decimal(5, 3)
  nozzleTempC Int
  bedTempC    Int
}

model Filament {
  id                String           @id @default(cuid())
  manufacturer      String
  material          FilamentMaterial
  colorName         String
  colorHex          String
  rollNumber        Int
  spoolWeightKg     Decimal          @db.Decimal(6, 3)
  spoolPrice        Decimal          @db.Decimal(10, 2)
  initialStockGrams Decimal          @db.Decimal(10, 2)
  currentStockGrams Decimal          @db.Decimal(10, 2)
  createdAt         DateTime         @default(now())
  updatedAt         DateTime         @updatedAt
  products          Product[]
  productionRuns    ProductionRun[]

  @@unique([manufacturer, material, colorName, rollNumber])
}
```

Remove the old fields (`diameterMm`, `densityGCm3`, `nozzleTempC`, `bedTempC`, `active`) — they move to `MaterialDefaults` (the temperature/diameter/density ones) or disappear entirely (`active` — this model has no soft-delete, see spec §3.2).

- [ ] **Step 2: Generate the migration, then hand-edit it to empty the table first (destructive reset, per explicit user decision)**

```bash
npx dotenv -e .env -- npx prisma migrate dev --create-only --name filament_stock_rework
```

Open the generated (not-yet-applied) `migration.sql`. Prisma will generate `ALTER TABLE` statements for the changed columns, likely failing or requiring manual resolution because old NOT-NULL-incompatible columns are being removed/added on a non-empty table. Add a single line at the very top of the file, before any `ALTER TABLE "Filament"` statement:

```sql
DELETE FROM "Filament";
```

This is the explicit "start from scratch" the user chose — it empties the table before the column shape changes, so the subsequent `ALTER TABLE ... ADD COLUMN ... NOT NULL` statements succeed without needing a default value. If a `Product` row already references a deleted `Filament` row via a NOT NULL foreign key, this `DELETE` fails with a foreign key violation instead of silently orphaning data — that's the correct, safe failure mode; if it happens, stop and report BLOCKED rather than adding `ON DELETE CASCADE` or force-deleting the referencing `Product` rows without asking.

Then apply:

```bash
npx dotenv -e .env -- npx prisma migrate dev
```

Confirm it applies cleanly against `tk3d_dev`. Apply the same to the test DB: `DATABASE_URL="$TEST_DATABASE_URL" npx prisma db push --skip-generate` (this one doesn't need the hand-edited DELETE — `db push` doesn't run migration files, it diffs schema directly and will just recreate the columns; the test DB has no real data to protect anyway).

- [ ] **Step 3: Update `prisma/seed.ts`**

Remove the entire filament-seeding block (the 7 old filament rows). Add:

```typescript
const materialDefaults = [
  { material: MaterialType.PLA, diameterMm: 1.75, densityGCm3: 1.24, nozzleTempC: 210, bedTempC: 60 },
  { material: MaterialType.PETG, diameterMm: 1.75, densityGCm3: 1.27, nozzleTempC: 240, bedTempC: 80 },
  { material: MaterialType.TPU, diameterMm: 1.75, densityGCm3: 1.21, nozzleTempC: 220, bedTempC: 50 },
  { material: MaterialType.OUTRO, diameterMm: 1.75, densityGCm3: 1.24, nozzleTempC: 220, bedTempC: 60 },
]
for (const d of materialDefaults) {
  await prisma.materialDefaults.upsert({ where: { material: d.material }, update: {}, create: d })
}
```

(Import `FilamentMaterial as MaterialType` from `@prisma/client` at the top, alongside the existing `AccessoryType`/`SupplyUnit` imports — check the exact enum name Prisma generates, likely `FilamentMaterial`.)

- [ ] **Step 4: Run the seed, verify**

```bash
npx dotenv -e .env -- npx prisma db seed
```

Expected: no errors, `MaterialDefaults` has exactly 4 rows, `Filament` has 0 rows (confirm via `npx prisma studio` or a quick `SELECT count(*)` — this is the intended empty state per the user's "start from scratch" choice).

- [ ] **Step 5: `npm run build` will fail here** — every file still referencing the old `Filament` fields (`diameterMm` etc.) or the old `filaments/page.tsx`/`FilamentForm.tsx` won't type-check yet. That's expected and fixed in Task 3. Do NOT try to patch those files in this task — this task is schema-only. Confirm the build fails with the EXPECTED errors (old Filament field references), not something unrelated, then stop here.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: rework Filament schema into per-roll stock model (destructive reset)"
```

Note in the commit message and your report that `npm run build` is red at this commit on purpose — Task 3 fixes it. This is the one deliberate exception to the "always leave the build green" norm in this codebase; flag it loudly to the task reviewer so it isn't mistaken for a defect.

---

### Task 3: Filament CRUD — new cadastro, stock list, filters, esgotados

**Files:**
- Create: `lib/validation/filament.ts` (rewrite)
- Create: `actions/filaments.ts` (rewrite)
- Create: `app/(app)/filaments/page.tsx`, `app/(app)/filaments/FilamentForm.tsx` (rewrite)
- Test: `tests/integration/filaments.test.ts` (rewrite)

**Interfaces:**
- Consumes: `Filament`/`MaterialDefaults`/`FilamentMaterial` (Task 2)
- Produces: `createFilament(formData)`, `deleteFilament(id)` (physical delete — no soft-delete in this model), `calculateFilamentPricePerKg`/`calculateFilamentPricePerGram` (extend `lib/costing.ts` if `calculateFilamentPricePerGram` doesn't already exist — check first) — Task 4 (Production) consumes the price-per-gram function.

- [ ] **Step 1: `npm run build` should still be red from Task 2** — confirm, then start fixing it here.

- [ ] **Step 2: Zod schema**

```typescript
// lib/validation/filament.ts
import { z } from 'zod'

export const filamentSchema = z.object({
  manufacturer: z.string().min(1, 'Marca/fabricante é obrigatório'),
  material: z.enum(['PLA', 'PETG', 'TPU', 'OUTRO'], { errorMap: () => ({ message: 'Selecione um material' }) }),
  colorName: z.string().min(1, 'Nome da cor é obrigatório'),
  colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida'),
  spoolWeightKg: z.coerce.number({ invalid_type_error: 'Peso inválido' }).positive('Peso deve ser maior que zero'),
  spoolPrice: z.coerce.number({ invalid_type_error: 'Preço inválido' }).positive('Preço deve ser maior que zero'),
})
```

- [ ] **Step 3: `actions/filaments.ts`**

```typescript
'use server'
import { prisma } from '@/lib/prisma'
import { filamentSchema } from '@/lib/validation/filament'
import { revalidatePath } from 'next/cache'

export async function createFilament(formData: FormData) {
  const parsed = filamentSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const existingCount = await prisma.filament.count({
    where: { manufacturer: parsed.data.manufacturer, material: parsed.data.material, colorName: parsed.data.colorName },
  })
  const initialStockGrams = parsed.data.spoolWeightKg * 1000

  await prisma.filament.create({
    data: {
      ...parsed.data,
      rollNumber: existingCount + 1,
      initialStockGrams,
      currentStockGrams: initialStockGrams,
    },
  })
  revalidatePath('/filaments')
  return { success: true }
}

export async function deleteFilament(id: string) {
  await prisma.filament.delete({ where: { id } })
  revalidatePath('/filaments')
  return { success: true }
}
```

(`deleteFilament` is a real physical delete — if a `Product`/`ProductionRun` references this roll, Postgres's FK constraint blocks it and Prisma throws; let that propagate as an unhandled error for now, matching the existing precedent elsewhere in this codebase of not handling FK-constraint deletes specially — do not add bespoke handling here beyond what other delete actions already do.)

- [ ] **Step 4: Extend `lib/costing.ts` with `calculateFilamentPricePerGram`** (if not already present)

```typescript
export function calculateFilamentPricePerGram(input: FilamentPriceInput): number {
  return calculateFilamentPricePerKg(input) / 1000
}
```

Add a unit test in `tests/unit/costing.test.ts`.

- [ ] **Step 5: Integration test** (`tests/integration/filaments.test.ts`, full rewrite)

Cover: create a filament, confirm `initialStockGrams`/`currentStockGrams` both equal `spoolWeightKg*1000` and `rollNumber` is 1; create a second filament with the SAME manufacturer+material+colorName, confirm its `rollNumber` is 2; create with a different color, confirm `rollNumber` resets to 1 for that new combination; reject invalid input (missing manufacturer, bad hex color); delete a filament and confirm it's gone. Follow the cleanup-ordering pattern from `tests/integration/printers.test.ts` (children before parents — `Filament` has no children yet in this task, `Product`/`ProductionRun` FKs come in Task 4's territory but don't create test data that would collide).

- [ ] **Step 6: Rebuild the page — list + create form + esgotados section + filters**

`app/(app)/filaments/FilamentForm.tsx`: fields per the Zod schema above, plus a live-computed (client-side, same pattern as the Printer form in Task 1) preview of `pricePerKg`, `pricePerGram`, and `estoque inicial (g)` as the user types weight/price. Color input: `<input type="color" name="colorHex">` next to a plain text `<input name="colorName">`.

`app/(app)/filaments/page.tsx`: query `prisma.filament.findMany({ where: { currentStockGrams: { gt: 0 } }, orderBy: [{ manufacturer: 'asc' }, { colorName: 'asc' }] })` for the main list, and a separate query with `currentStockGrams: { lte: 0 }` for the esgotados `<details>` section (same collapsible pattern as the other catalogs' "Mostrar inativos"). Table columns: a small colored circle (`<span style={{background: f.colorHex}} className="inline-block h-3 w-3 rounded-full">`), Marca, Material, Estoque atual (g), % restante, R$/g, Status (emoji + label per the spec's thresholds — write a small `getStockStatus(percentRemaining: number)` helper, either inline or in `lib/costing.ts` if you judge it belongs there since it's a pure function of a number).

Filters: read `searchParams` for `material` (PLA/PETG/TPU/OUTRO/undefined=todas), `stock` (`baixo` = 10-30%, `esgotado` handled by the separate section instead of this filter), and `color` (exact `colorName` match) — render as simple `<Link href="?...">` tabs/select, following the exact pattern `app/(app)/sales/page.tsx` already uses for its channel filter tabs.

- [ ] **Step 7: Fix `app/(app)/products/ProductForm.tsx`'s filament select**

It currently maps filaments to `{id, name: f.manufacturer}` — update the label to include material/color/roll, e.g. `` `${f.manufacturer} ${f.colorName} (${f.material}) — Rolo #${String(f.rollNumber).padStart(3,'0')}` ``, and filter the query to `currentStockGrams: { gt: 0 }` (don't let a product's default filament be a depleted roll going forward — existing products already pointing at a since-depleted roll are unaffected, this only constrains the dropdown for new selections).

- [ ] **Step 8: Verify `npm run build` is green again, `npm test`, `npm run lint`**

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: rebuild filament catalog as per-roll stock system"
```

---

### Task 4: Production integration — stock deduction on production run

**Files:**
- Modify: `prisma/schema.prisma` (`ProductionRun.gramsUsed`)
- Modify: `lib/validation/productionRun.ts`, `actions/productionRuns.ts`, `app/(app)/production/ProductionRunForm.tsx`, `app/(app)/production/page.tsx`
- Test: `tests/integration/productionRuns.test.ts`

**Interfaces:**
- Consumes: `Filament.currentStockGrams` (Task 2/3), `calculateFilamentPricePerGram` (Task 3)
- Produces: `createProductionRun` now also decrements filament stock — no other task depends on this beyond the schema field itself.

- [ ] **Step 1: Add the field**

```prisma
// in ProductionRun
  gramsUsed Decimal @db.Decimal(10, 2)
```

Add it right after `quantityFailed` in the model (matches the spec's field ordering). Migrate: `npx dotenv -e .env -- npx prisma migrate dev --name production_run_grams_used` (this one is additive/non-destructive, no hand-editing needed — pick a reasonable default like `0` only if migrate dev prompts for one on existing rows, otherwise leave it required with no default since new rows will always supply it). Push the same to the test DB.

- [ ] **Step 2: Zod schema — extend the `.refine`**

Add `gramsUsed: z.coerce.number({ invalid_type_error: 'Peso inválido' }).nonnegative('Não pode ser negativo')` to `productionRunSchema`. The existing cross-field `.refine` (quantities) stays; stock-sufficiency can't be a Zod `.refine` (needs a DB read), so it's checked in the server action instead — same reasoning as `createConsignmentSaleReport`'s balance check.

- [ ] **Step 3: Integration test (TDD — write first)**

Add to `tests/integration/productionRuns.test.ts`: a valid run that deducts `gramsUsed + gramsWasted` from the filament's `currentStockGrams` (create a filament with a known `currentStockGrams`, create the run, re-fetch the filament, assert the new stock value); a rejected run where `gramsUsed + gramsWasted` exceeds `currentStockGrams`, asserting the error message names the actual remaining amount and that NEITHER the `ProductionRun` row NOR the stock deduction happened (verify both — a partial failure here is exactly the class of bug a transaction is meant to prevent).

- [ ] **Step 4: Run and confirm failure, then implement**

```typescript
export async function createProductionRun(formData: FormData) {
  const parsed = productionRunSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const totalConsumed = parsed.data.gramsUsed + parsed.data.gramsWasted
  const filament = await prisma.filament.findUniqueOrThrow({ where: { id: parsed.data.filamentId } })
  const currentStock = filament.currentStockGrams.toNumber()
  if (totalConsumed > currentStock) {
    return { success: false, error: `Quantidade excede o estoque disponível (${currentStock}g)` }
  }

  await prisma.$transaction([
    prisma.productionRun.create({ data: parsed.data }),
    prisma.filament.update({
      where: { id: parsed.data.filamentId },
      data: { currentStockGrams: { decrement: totalConsumed } },
    }),
  ])

  revalidatePath('/production')
  revalidatePath('/filaments')
  return { success: true }
}
```

(Revalidating `/filaments` too — stock changed, that page's cached data is now stale, same class of cross-page staleness the earlier final review fixed via `force-dynamic`; since `/filaments` already carries `force-dynamic` per Task 3, this revalidate is belt-and-suspenders but costs nothing and documents the dependency.)

- [ ] **Step 5: Run and confirm the tests pass**

- [ ] **Step 6: UI — form and list**

`ProductionRunForm.tsx`: add a `gramsUsed` number input next to the existing `gramsWasted` one. Update the filament `<select>`'s option labels to match Task 3 Step 7's format (manufacturer + color + material + roll + remaining stock, e.g. append ` (${stock}g restantes)`), and filter to `currentStockGrams: { gt: 0 }` (production should not be logged against an already-depleted roll — if the user genuinely needs to, they can't, and that's intentional: a run that would drive stock negative is exactly what Step 4's check blocks anyway, so hiding depleted rolls from the picker is a UX nicety, not a new invariant).

`app/(app)/production/page.tsx`: add a "Custo do filamento" column showing `gramsUsed * calculateFilamentPricePerGram(...)` per row (informative only, not stored).

- [ ] **Step 7: Verify**

`npm run build`, `npm test`, `npm run lint` clean.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: deduct filament stock automatically on production run"
```

## Execution Handoff

Use superpowers:subagent-driven-development. Tasks are sequential and each depends on the previous one's schema/interface (Task 1 is actually independent of 2-4 and could run first or in parallel in principle, but there is no isolation set up for true parallel execution in this session — run in order 1 → 2 → 3 → 4). Task 2 deliberately leaves the build red; the controller must not treat that as a fix-loop trigger when reviewing Task 2's diff, and must confirm Task 3 turns it green again before considering the pair done.
