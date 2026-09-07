# Controle de Produção e Vendas de Impressão 3D Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sistema web para cadastrar custos de impressão 3D (chaveiros e peças), registrar produção/desperdício e controlar vendas (direta, marketplace, consignado), substituindo a planilha atual.

**Architecture:** Next.js 15 (App Router, Server Actions) + TypeScript + Tailwind + Prisma/PostgreSQL, um único container. Login por senha única com cookie assinado. Deploy no Coolify usando o Postgres compartilhado (`postgresql-database-geral`, schema `tk3d`).

**Tech Stack:** Next.js 15, React 18/19, TypeScript 5, Tailwind CSS 3, Prisma 5/6, PostgreSQL 16, Zod, Vitest, Node 20.

**Spec:** `docs/superpowers/specs/2026-09-07-controle-producao-3d-design.md`

## Global Constraints

- Todo texto de UI em português (pt-BR). Moeda formatada como `R$ 1.234,56`.
- Todo valor monetário no banco é `Decimal` (Prisma), nunca `Float`. Ao usar em
  cálculo JS, converter com `.toNumber()` — nunca fazer aritmética direta em
  um objeto `Decimal` do Prisma.
- Banco de desenvolvimento/teste: PostgreSQL 16 local já provisionado neste
  ambiente — role `tk3d` / senha `tk3d_dev_password`, bancos `tk3d_dev` e
  `tk3d_test` (host `localhost`, porta 5432). `.env` local:
  `DATABASE_URL="postgresql://tk3d:tk3d_dev_password@localhost:5432/tk3d_dev"`
  `TEST_DATABASE_URL="postgresql://tk3d:tk3d_dev_password@localhost:5432/tk3d_test"`
- Produção usa o Postgres do Coolify com `?schema=tk3d` — nunca hardcoded no
  código, sempre via `DATABASE_URL`.
- Gerenciador de pacotes: npm. Todas as rotas exceto `/login` e `/api/login`
  passam pelo `middleware.ts` de autenticação (implementado na Task 4) — toda
  task posterior assume que a página só é alcançada autenticada.
- Todas as páginas CRUD seguem o padrão definido na Task 5 (list page +
  form component + server actions com Zod). Não reinventar a estrutura em
  tasks posteriores.
- Commits pequenos e frequentes, um por etapa concluída (schema, feature,
  testes passando).

---

### Task 1: Scaffold do projeto (Next.js + Tailwind + Prisma + Vitest)

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.js`, `tailwind.config.ts`,
  `postcss.config.js`, `.eslintrc.json`, `.gitignore`, `vitest.config.ts`
- Create: `app/layout.tsx`, `app/page.tsx`, `app/globals.css`
- Create: `.env.example`, `.env` (local, git-ignored)
- Create: `lib/prisma.ts`

**Interfaces:**
- Produces: `lib/prisma.ts` exporta `prisma: PrismaClient` (singleton,
  reutilizado por toda ação/rota das tasks seguintes).

- [ ] **Step 1: Criar o app Next.js**

```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir=false --import-alias "@/*" --use-npm --no-turbopack
```

Se o diretório já não estiver vazio (por causa do `.git`/`docs/`), responda
"y" para continuar mesmo assim.

- [ ] **Step 2: Instalar dependências adicionais**

```bash
npm install prisma @prisma/client zod
npm install -D vitest @vitejs/plugin-react vite-tsconfig-paths dotenv-cli
npx prisma init --datasource-provider postgresql
```

- [ ] **Step 3: Configurar `.env.example` e `.env`**

`.env.example`:
```
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DBNAME?schema=tk3d"
TEST_DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DBNAME_test"
APP_PASSWORD="troque-esta-senha"
SESSION_SECRET="gere-uma-string-aleatoria-longa"
```

`.env` (local, não commitado — confirme que `.gitignore` do
`create-next-app` já ignora `.env*` exceto `.env.example`):
```
DATABASE_URL="postgresql://tk3d:tk3d_dev_password@localhost:5432/tk3d_dev"
TEST_DATABASE_URL="postgresql://tk3d:tk3d_dev_password@localhost:5432/tk3d_test"
APP_PASSWORD="dev-password"
SESSION_SECRET="dev-secret-not-for-production-use-only"
```

- [ ] **Step 4: Criar `lib/prisma.ts`**

```typescript
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

- [ ] **Step 5: Configurar `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    globals: true,
  },
})
```

Adicionar em `package.json` `scripts`: `"test": "vitest run"`.

- [ ] **Step 6: Verificar que o app builda e os testes rodam (vazio)**

Run: `npm run build`
Expected: build concluído sem erros.
Run: `npm test`
Expected: "No test files found" (ainda não há testes) — não é falha.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with Tailwind, Prisma, Vitest"
```

---

### Task 2: Schema do Prisma, migração e seed de dados da planilha

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/seed.ts`
- Modify: `package.json` (script `db:seed` + `prisma.seed` config)

**Interfaces:**
- Consumes: `lib/prisma.ts` (Task 1)
- Produces: todos os models Prisma abaixo — toda task seguinte importa os
  tipos gerados de `@prisma/client` (ex: `Printer`, `Product`,
  `AccessoryType`, etc.)

- [ ] **Step 1: Escrever `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Settings {
  id                    Int      @id @default(1)
  energyCostPerKwh      Decimal  @default(1.00) @db.Decimal(10, 4)
  laborCostPerHour      Decimal  @default(10.00) @db.Decimal(10, 2)
  failureRatePercent    Decimal  @default(0.10) @db.Decimal(5, 4)
  marketplaceFeePercent Decimal  @default(0.20) @db.Decimal(5, 4)
  taxPercent            Decimal  @default(0.055) @db.Decimal(5, 4)
  marketplaceFixedFee   Decimal  @default(4.00) @db.Decimal(10, 2)
  defaultMarkup         Decimal  @default(2.00) @db.Decimal(6, 2)
  updatedAt             DateTime @updatedAt
}

model Printer {
  id                     String          @id @default(cuid())
  name                   String          @unique
  purchasePrice          Decimal         @db.Decimal(10, 2)
  depreciationHours      Decimal         @db.Decimal(10, 2)
  maintenanceCost        Decimal         @db.Decimal(10, 2)
  avgPowerConsumptionKwh Decimal         @db.Decimal(6, 4)
  active                 Boolean         @default(true)
  createdAt              DateTime        @default(now())
  updatedAt              DateTime        @updatedAt
  products               Product[]
  productionRuns         ProductionRun[]
}

model Filament {
  id            String          @id @default(cuid())
  manufacturer  String          @unique
  diameterMm    Decimal         @db.Decimal(4, 2)
  spoolPrice    Decimal         @db.Decimal(10, 2)
  spoolWeightKg Decimal         @db.Decimal(6, 3)
  densityGCm3   Decimal         @db.Decimal(5, 3)
  nozzleTempC   Int
  bedTempC      Int
  active        Boolean         @default(true)
  createdAt     DateTime        @default(now())
  updatedAt     DateTime        @updatedAt
  products      Product[]
  productionRuns ProductionRun[]
}

model PackagingItem {
  id        String    @id @default(cuid())
  name      String    @unique
  unitCost  Decimal   @db.Decimal(10, 4)
  active    Boolean   @default(true)
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  products  Product[]
}

enum AccessoryType {
  CORRENTE_BOLINHA
  CORRENTE_ELO
  MOSQUETAO
  CLICKER
  OUTRO
}

model Accessory {
  id        String        @id @default(cuid())
  name      String
  type      AccessoryType
  unitCost  Decimal       @db.Decimal(10, 4)
  active    Boolean       @default(true)
  createdAt DateTime      @default(now())
  updatedAt DateTime      @updatedAt
  products  Product[]
}

enum SupplyUnit {
  UN
  ML
  G
}

model Supply {
  id        String               @id @default(cuid())
  name      String               @unique
  unit      SupplyUnit
  unitCost  Decimal              @db.Decimal(10, 4)
  active    Boolean              @default(true)
  createdAt DateTime             @default(now())
  updatedAt DateTime             @updatedAt
  usages    ProductSupplyUsage[]
}

enum FinishingType {
  NENHUM
  CANETA_VERNIZ
  RESINA_UV
  OUTRO
}

model Product {
  id                    String                  @id @default(cuid())
  name                  String
  category              String                  @default("Chaveiro")
  printerId             String
  printer               Printer                 @relation(fields: [printerId], references: [id])
  filamentId            String
  filament              Filament                @relation(fields: [filamentId], references: [id])
  weightGrams           Decimal                 @db.Decimal(10, 2)
  printTimeHours        Decimal                 @db.Decimal(10, 3)
  laborTimeHours        Decimal                 @db.Decimal(10, 3)
  packagingItemId       String?
  packagingItem         PackagingItem?          @relation(fields: [packagingItemId], references: [id])
  accessoryId           String?
  accessory             Accessory?              @relation(fields: [accessoryId], references: [id])
  finishingType         FinishingType           @default(NENHUM)
  usesGlue              Boolean                 @default(false)
  notes                 String?
  active                Boolean                 @default(true)
  createdAt             DateTime                @default(now())
  updatedAt             DateTime                @updatedAt
  supplyUsages          ProductSupplyUsage[]
  productionRuns        ProductionRun[]
  sales                 Sale[]
  consignmentDeliveries ConsignmentDelivery[]
}

model ProductSupplyUsage {
  id        String   @id @default(cuid())
  productId String
  product   Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  supplyId  String
  supply    Supply   @relation(fields: [supplyId], references: [id])
  quantity  Decimal  @db.Decimal(10, 3)

  @@unique([productId, supplyId])
}

model ProductionRun {
  id              String   @id @default(cuid())
  productId       String
  product         Product  @relation(fields: [productId], references: [id])
  printerId       String
  printer         Printer  @relation(fields: [printerId], references: [id])
  filamentId      String
  filament        Filament @relation(fields: [filamentId], references: [id])
  date            DateTime
  quantityPlanned Int
  quantitySuccess Int
  quantityFailed  Int
  gramsWasted     Decimal  @db.Decimal(10, 2)
  timeWastedHours Decimal  @db.Decimal(10, 3)
  notes           String?
  createdAt       DateTime @default(now())
}

enum SaleChannel {
  DIRETA
  MARKETPLACE
}

model Sale {
  id              String      @id @default(cuid())
  channel         SaleChannel
  productId       String
  product         Product     @relation(fields: [productId], references: [id])
  quantity        Int
  unitPrice       Decimal     @db.Decimal(10, 2)
  saleDate        DateTime
  buyerOrPlatform String?
  notes           String?
  createdAt       DateTime    @default(now())
}

model ConsignmentPartner {
  id                       String                @id @default(cuid())
  name                     String
  defaultCommissionPercent Decimal               @db.Decimal(5, 4)
  notes                    String?
  active                   Boolean               @default(true)
  createdAt                DateTime              @default(now())
  deliveries               ConsignmentDelivery[]
}

model ConsignmentDelivery {
  id                String                  @id @default(cuid())
  partnerId         String
  partner           ConsignmentPartner      @relation(fields: [partnerId], references: [id])
  productId         String
  product           Product                 @relation(fields: [productId], references: [id])
  quantityDelivered Int
  unitPrice         Decimal                 @db.Decimal(10, 2)
  deliveryDate      DateTime
  notes             String?
  createdAt         DateTime                @default(now())
  saleReports       ConsignmentSaleReport[]
}

model ConsignmentSaleReport {
  id                String              @id @default(cuid())
  deliveryId        String
  delivery          ConsignmentDelivery @relation(fields: [deliveryId], references: [id])
  quantitySold      Int
  reportDate        DateTime
  commissionPercent Decimal             @db.Decimal(5, 4)
  notes             String?
  createdAt         DateTime            @default(now())
}
```

- [ ] **Step 2: Rodar a migração no banco de dev**

Run: `npx dotenv -e .env -- npx prisma migrate dev --name init`
Expected: migração criada em `prisma/migrations/` e aplicada sem erro em
`tk3d_dev`.

- [ ] **Step 3: Escrever `prisma/seed.ts`**

```typescript
import { PrismaClient, AccessoryType, SupplyUnit } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  await prisma.settings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  })

  const printers = [
    { name: 'Bambu Lab A1 Mini', purchasePrice: 3000, depreciationHours: 10000, maintenanceCost: 700, avgPowerConsumptionKwh: 0.15 },
    { name: 'Anycubic Kobra X', purchasePrice: 3600, depreciationHours: 10000, maintenanceCost: 1000, avgPowerConsumptionKwh: 0.27 },
    { name: 'Bambulab A1', purchasePrice: 4800, depreciationHours: 10000, maintenanceCost: 1000, avgPowerConsumptionKwh: 0.15, active: false },
    { name: 'Snapmaker U1', purchasePrice: 15000, depreciationHours: 25000, maintenanceCost: 2300, avgPowerConsumptionKwh: 0.3, active: false },
    { name: 'Anycubic Kobra S1', purchasePrice: 6000, depreciationHours: 10000, maintenanceCost: 1200, avgPowerConsumptionKwh: 0.35, active: false },
  ]
  for (const p of printers) {
    await prisma.printer.upsert({ where: { name: p.name }, update: {}, create: p as any })
  }

  const filaments = [
    { manufacturer: 'Voolt3D PLA', diameterMm: 1.75, spoolPrice: 120, spoolWeightKg: 1, densityGCm3: 1.24, nozzleTempC: 220, bedTempC: 60 },
    { manufacturer: 'Outro', diameterMm: 1.75, spoolPrice: 80, spoolWeightKg: 1, densityGCm3: 1.24, nozzleTempC: 260, bedTempC: 80 },
    { manufacturer: '3nmax', diameterMm: 1.75, spoolPrice: 100, spoolWeightKg: 1, densityGCm3: 1.24, nozzleTempC: 220, bedTempC: 115 },
    { manufacturer: 'Polyterra', diameterMm: 1.75, spoolPrice: 145, spoolWeightKg: 1, densityGCm3: 1.24, nozzleTempC: 220, bedTempC: 100 },
    { manufacturer: 'Bambu Lite', diameterMm: 1.75, spoolPrice: 130, spoolWeightKg: 1, densityGCm3: 1.24, nozzleTempC: 220, bedTempC: 100 },
    { manufacturer: 'eSUN Matte', diameterMm: 1.75, spoolPrice: 135, spoolWeightKg: 1, densityGCm3: 1.24, nozzleTempC: 220, bedTempC: 100 },
    { manufacturer: 'Bambu TPU AMS', diameterMm: 1.75, spoolPrice: 175, spoolWeightKg: 1, densityGCm3: 1.24, nozzleTempC: 220, bedTempC: 100 },
  ]
  for (const f of filaments) {
    await prisma.filament.upsert({ where: { manufacturer: f.manufacturer }, update: {}, create: f as any })
  }

  const packaging = [
    { name: 'Caixa Grande', unitCost: 3.1656 },
    { name: 'Caixa Pequena', unitCost: 1.398 },
    { name: 'Almofada Colmeia', unitCost: 0.8517 },
    { name: 'Fita gomada', unitCost: 0.1933 },
    { name: 'Etiqueta', unitCost: 0.1333 },
  ]
  for (const p of packaging) {
    await prisma.packagingItem.upsert({ where: { name: p.name }, update: {}, create: p })
  }

  const supplies = [
    { name: 'Caneta acrílica', unit: SupplyUnit.UN, unitCost: 0 },
    { name: 'Spray verniz', unit: SupplyUnit.ML, unitCost: 0 },
    { name: 'Resina UV', unit: SupplyUnit.ML, unitCost: 0 },
    { name: 'Cola Tekbond 200', unit: SupplyUnit.ML, unitCost: 0 },
  ]
  for (const s of supplies) {
    await prisma.supply.upsert({ where: { name: s.name }, update: {}, create: s })
  }

  console.log('Seed concluído.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
}).finally(() => prisma.$disconnect())
```

`Printer.name`, `Filament.manufacturer`, `PackagingItem.name` e
`Supply.name` já têm `@unique` no schema do Step 1 — é isso que permite o
`upsert` por `where` abaixo funcionar.

Adicionar em `package.json`:
```json
"prisma": { "seed": "npx dotenv -e .env -- ts-node prisma/seed.ts" }
```
(instalar `ts-node` como dependência de desenvolvimento: `npm install -D ts-node`)

- [ ] **Step 4: Rodar o seed e verificar**

Run: `npx dotenv -e .env -- npx prisma db seed`
Expected: "Seed concluído." impresso, sem erro.
Run: `npx dotenv -e .env -- npx prisma studio --browser none &` (opcional,
apenas para inspeção manual — encerrar o processo depois)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add Prisma schema, migration and seed data from spreadsheet"
```

---

### Task 3: Motor de cálculo de custos + testes unitários

**Files:**
- Create: `lib/costing.ts`
- Test: `tests/unit/costing.test.ts`

**Interfaces:**
- Consumes: nada (funções puras, sem I/O)
- Produces: `calculatePrinterDepreciationCostPerHour`,
  `calculateFilamentPricePerKg`, `calculateProductCost` — usadas pela Task 7
  (Products) e Task 8 (ProductionRun) exatamente com estas assinaturas.

- [ ] **Step 1: Escrever os testes (falhando)**

```typescript
// tests/unit/costing.test.ts
import { describe, it, expect } from 'vitest'
import {
  calculatePrinterDepreciationCostPerHour,
  calculateFilamentPricePerKg,
  calculateProductCost,
} from '@/lib/costing'

describe('calculatePrinterDepreciationCostPerHour', () => {
  it('Bambu Lab A1 Mini', () => {
    expect(calculatePrinterDepreciationCostPerHour({ purchasePrice: 3000, maintenanceCost: 700, depreciationHours: 10000 })).toBeCloseTo(0.37, 4)
  })
  it('Anycubic Kobra X', () => {
    expect(calculatePrinterDepreciationCostPerHour({ purchasePrice: 3600, maintenanceCost: 1000, depreciationHours: 10000 })).toBeCloseTo(0.46, 4)
  })
})

describe('calculateFilamentPricePerKg', () => {
  it('Outro: 80/1kg', () => {
    expect(calculateFilamentPricePerKg({ spoolPrice: 80, spoolWeightKg: 1 })).toBeCloseTo(80, 4)
  })
})

describe('calculateProductCost', () => {
  const settings = {
    energyCostPerKwh: 1,
    laborCostPerHour: 10,
    failureRatePercent: 0.10,
    marketplaceFeePercent: 0.20,
    taxPercent: 0.055,
    marketplaceFixedFee: 4,
    defaultMarkup: 2,
  }

  it('Chaveirinho (planilha): Anycubic Kobra X + filamento Outro', () => {
    const result = calculateProductCost({
      weightGrams: 30,
      printTimeHours: 2,
      laborTimeHours: 0.05,
      filamentPricePerKg: 80,
      printerAvgPowerConsumptionKwh: 0.27,
      printerDepreciationCostPerHour: 0.46,
      suppliesCost: 0.3,
      packagingCost: 0,
      accessoryCost: 0,
    }, settings)

    expect(result.filamentCost).toBeCloseTo(2.4, 3)
    expect(result.electricityCost).toBeCloseTo(0.54, 3)
    expect(result.printerCost).toBeCloseTo(0.92, 3)
    expect(result.laborCost).toBeCloseTo(0.5, 3)
    expect(result.subtotal).toBeCloseTo(4.66, 3)
    expect(result.finalCost).toBeCloseTo(5.126, 3)
    expect(result.suggestedPrice).toBeCloseTo(10.252, 3)
  })

  it('Boneco Corinthias (planilha): confirma subtotal e markup', () => {
    const result = calculateProductCost({
      weightGrams: 300,
      printTimeHours: 20,
      laborTimeHours: 1,
      filamentPricePerKg: 100,
      printerAvgPowerConsumptionKwh: 0.27,
      printerDepreciationCostPerHour: 0.46,
      suppliesCost: 0,
      packagingCost: 0,
      accessoryCost: 0,
    }, settings)

    expect(result.filamentCost).toBeCloseTo(30, 3)
    expect(result.electricityCost).toBeCloseTo(5.4, 3)
    expect(result.printerCost).toBeCloseTo(9.2, 3)
    expect(result.laborCost).toBeCloseTo(10, 3)
    expect(result.subtotal).toBeCloseTo(54.6, 3)
    expect(result.finalCost).toBeCloseTo(60.06, 3)
    expect(result.suggestedPrice).toBeCloseTo(120.12, 3)
  })

  it('marketplacePrice a partir de um suggestedPrice conhecido', () => {
    const result = calculateProductCost({
      weightGrams: 30,
      printTimeHours: 2,
      laborTimeHours: 0.25,
      filamentPricePerKg: 80,
      printerAvgPowerConsumptionKwh: 0.27,
      printerDepreciationCostPerHour: 0.46,
      suppliesCost: 0.3,
      packagingCost: 0,
      accessoryCost: 0,
    }, settings)

    // subtotal = 2.4 + 0.54 + 0.92 + 2.5 + 0.3 = 6.66 -> finalCost 7.326 -> suggested 14.652
    expect(result.suggestedPrice).toBeCloseTo(14.652, 3)
    expect(result.marketplacePrice).toBeCloseTo(23.667, 2)
  })
})
```

Nota: o segundo teste do primeiro bloco usa `laborTimeHours: 0.25` (não
`0.05`) porque é o valor que reproduz exatamente o `laborCost=2.5` da linha
"Chaveirinho" da planilha (`10 * 0.25 = 2.5`) — a planilha tinha uma
inconsistência entre a coluna de horas exibida (0.05) e o custo calculado
(2.5); o motor novo usa sempre `laborCostPerHour * laborTimeHours` de forma
consistente (confirmado pela linha "Boneco Corinthias", onde `10 * 1 = 10`
bate exatamente).

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npm test`
Expected: FAIL — `Cannot find module '@/lib/costing'`

- [ ] **Step 3: Implementar `lib/costing.ts`**

```typescript
export interface PrinterDepreciationInput {
  purchasePrice: number
  maintenanceCost: number
  depreciationHours: number
}

export function calculatePrinterDepreciationCostPerHour(input: PrinterDepreciationInput): number {
  return (input.purchasePrice + input.maintenanceCost) / input.depreciationHours
}

export interface FilamentPriceInput {
  spoolPrice: number
  spoolWeightKg: number
}

export function calculateFilamentPricePerKg(input: FilamentPriceInput): number {
  return input.spoolPrice / input.spoolWeightKg
}

export interface Settings {
  energyCostPerKwh: number
  laborCostPerHour: number
  failureRatePercent: number
  marketplaceFeePercent: number
  taxPercent: number
  marketplaceFixedFee: number
  defaultMarkup: number
}

export interface ProductCostInput {
  weightGrams: number
  printTimeHours: number
  laborTimeHours: number
  filamentPricePerKg: number
  printerAvgPowerConsumptionKwh: number
  printerDepreciationCostPerHour: number
  suppliesCost: number
  packagingCost: number
  accessoryCost: number
}

export interface ProductCostBreakdown {
  filamentCost: number
  electricityCost: number
  printerCost: number
  laborCost: number
  suppliesCost: number
  packagingCost: number
  accessoryCost: number
  subtotal: number
  finalCost: number
  suggestedPrice: number
  marketplacePrice: number
}

export function calculateProductCost(input: ProductCostInput, settings: Settings): ProductCostBreakdown {
  const filamentCost = input.weightGrams * (input.filamentPricePerKg / 1000)
  const electricityCost = input.printerAvgPowerConsumptionKwh * settings.energyCostPerKwh * input.printTimeHours
  const printerCost = input.printerDepreciationCostPerHour * input.printTimeHours
  const laborCost = settings.laborCostPerHour * input.laborTimeHours

  const subtotal = filamentCost + electricityCost + printerCost + laborCost
    + input.suppliesCost + input.packagingCost + input.accessoryCost

  const finalCost = subtotal * (1 + settings.failureRatePercent)
  const suggestedPrice = finalCost * settings.defaultMarkup
  const marketplacePrice = suggestedPrice / (1 - settings.marketplaceFeePercent - settings.taxPercent)
    + settings.marketplaceFixedFee

  return {
    filamentCost,
    electricityCost,
    printerCost,
    laborCost,
    suppliesCost: input.suppliesCost,
    packagingCost: input.packagingCost,
    accessoryCost: input.accessoryCost,
    subtotal,
    finalCost,
    suggestedPrice,
    marketplacePrice,
  }
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npm test`
Expected: PASS — todos os testes de `tests/unit/costing.test.ts`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add cost calculation engine with tests validated against spreadsheet"
```

---

### Task 4: Autenticação (senha única) + shell da aplicação

**Files:**
- Create: `lib/auth.ts`
- Create: `app/api/login/route.ts`, `app/api/logout/route.ts`
- Create: `app/login/page.tsx`
- Create: `middleware.ts`
- Create: `app/(app)/layout.tsx` (layout autenticado com navegação)
- Modify: `app/layout.tsx` (layout raiz mínimo)
- Test: `tests/unit/auth.test.ts`

**Interfaces:**
- Produces: `signSession(): string`, `verifySession(token: string): boolean`
  — usados apenas por `middleware.ts` e pelas rotas de login/logout; nenhuma
  outra task depende diretamente disso além de "todas as páginas exigem
  estar logado".

- [ ] **Step 1: Escrever teste de assinatura/verificação de sessão**

```typescript
// tests/unit/auth.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { signSession, verifySession } from '@/lib/auth'

describe('session token', () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = 'test-secret'
  })

  it('assina e verifica um token válido', () => {
    const token = signSession()
    expect(verifySession(token)).toBe(true)
  })

  it('rejeita token adulterado', () => {
    const token = signSession()
    expect(verifySession(token + 'x')).toBe(false)
  })

  it('rejeita string vazia', () => {
    expect(verifySession('')).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npm test`
Expected: FAIL — `Cannot find module '@/lib/auth'`

- [ ] **Step 3: Implementar `lib/auth.ts`**

```typescript
import crypto from 'crypto'

function getSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET não configurado')
  return secret
}

export function signSession(): string {
  const payload = String(Date.now())
  const hmac = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex')
  return `${payload}.${hmac}`
}

export function verifySession(token: string): boolean {
  if (!token || !token.includes('.')) return false
  const [payload, hmac] = token.split('.')
  const expected = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex')
  const a = Buffer.from(hmac)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export function checkPassword(password: string): boolean {
  const appPassword = process.env.APP_PASSWORD
  if (!appPassword) throw new Error('APP_PASSWORD não configurado')
  const a = Buffer.from(password)
  const b = Buffer.from(appPassword)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Rota de login/logout**

```typescript
// app/api/login/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { checkPassword, signSession } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const { password } = await req.json()
  if (!checkPassword(password)) {
    return NextResponse.json({ error: 'Senha incorreta' }, { status: 401 })
  }
  const res = NextResponse.json({ ok: true })
  res.cookies.set('session', signSession(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  })
  return res
}
```

```typescript
// app/api/logout/route.ts
import { NextResponse } from 'next/server'

export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.cookies.delete('session')
  return res
}
```

- [ ] **Step 6: Página de login**

```tsx
// app/login/page.tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (res.ok) {
      router.push('/dashboard')
      router.refresh()
    } else {
      setError('Senha incorreta')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-xl bg-white p-8 shadow-sm">
        <h1 className="mb-6 text-xl font-semibold text-slate-900">Controle de Produção 3D</h1>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Senha"
          className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          autoFocus
        />
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        <button type="submit" className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700">
          Entrar
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 7: `middleware.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth'

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (pathname.startsWith('/login') || pathname.startsWith('/api/login') || pathname.startsWith('/_next')) {
    return NextResponse.next()
  }
  const token = req.cookies.get('session')?.value ?? ''
  if (!verifySession(token)) {
    const loginUrl = new URL('/login', req.url)
    return NextResponse.redirect(loginUrl)
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

- [ ] **Step 8: Layout autenticado com navegação**

Criar `app/(app)/layout.tsx` envolvendo todas as páginas internas (dashboard,
products, printers, filaments, packaging, accessories, supplies, settings,
production, sales, consignment) com uma barra de navegação lateral/topo
contendo links para cada seção e um botão "Sair" que faz `POST
/api/logout` e redireciona para `/login`. Mover as páginas dessas seções
(criadas nas tasks seguintes) para dentro do grupo `app/(app)/`.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add single-password auth with signed session cookie"
```

---

### Task 5: Padrão de CRUD (referência) — Impressoras e Filamentos

Esta task define o **padrão** que as Tasks 6, 7, 8, 9 e 10 seguem: Zod schema
de validação + Server Actions (`create`/`update`/`delete`) + página de lista
+ formulário. Implementar para as duas entidades abaixo; tasks seguintes
repetem exatamente esta estrutura para suas próprias entidades e campos.

**Files:**
- Create: `lib/validation/printer.ts`, `lib/validation/filament.ts`
- Create: `actions/printers.ts`, `actions/filaments.ts`
- Create: `app/(app)/printers/page.tsx`, `app/(app)/printers/PrinterForm.tsx`
- Create: `app/(app)/filaments/page.tsx`, `app/(app)/filaments/FilamentForm.tsx`
- Test: `tests/integration/printers.test.ts`

**Interfaces:**
- Consumes: `lib/prisma.ts` (Task 1), schema Prisma (Task 2)
- Produces: o padrão `actions/<entidade>.ts` exportando
  `create<Entidade>(formData: FormData): Promise<{success: boolean; error?: string}>`,
  `update<Entidade>(id: string, formData: FormData)`, `delete<Entidade>(id: string)`
  — Tasks 6-10 replicam esse contrato para suas entidades.

- [ ] **Step 1: Teste de integração (falhando) para Printer**

```typescript
// tests/integration/printers.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createPrinter, updatePrinter, deletePrinter } from '@/actions/printers'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

beforeAll(async () => {
  await prisma.$connect()
})
afterAll(async () => {
  await prisma.$disconnect()
})
beforeEach(async () => {
  await prisma.printer.deleteMany()
})

function fd(obj: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(obj)) f.append(k, v)
  return f
}

describe('printers actions', () => {
  it('cria uma impressora válida', async () => {
    const result = await createPrinter(fd({
      name: 'Teste X1',
      purchasePrice: '3000',
      depreciationHours: '10000',
      maintenanceCost: '700',
      avgPowerConsumptionKwh: '0.15',
    }))
    expect(result.success).toBe(true)
    const printer = await prisma.printer.findFirst({ where: { name: 'Teste X1' } })
    expect(printer).not.toBeNull()
  })

  it('rejeita nome vazio', async () => {
    const result = await createPrinter(fd({
      name: '',
      purchasePrice: '3000',
      depreciationHours: '10000',
      maintenanceCost: '700',
      avgPowerConsumptionKwh: '0.15',
    }))
    expect(result.success).toBe(false)
  })

  it('atualiza e depois remove', async () => {
    const created = await createPrinter(fd({
      name: 'Teste Y1', purchasePrice: '1000', depreciationHours: '5000', maintenanceCost: '200', avgPowerConsumptionKwh: '0.2',
    }))
    expect(created.success).toBe(true)
    const printer = await prisma.printer.findFirstOrThrow({ where: { name: 'Teste Y1' } })

    const updated = await updatePrinter(printer.id, fd({
      name: 'Teste Y1 Atualizada', purchasePrice: '1100', depreciationHours: '5000', maintenanceCost: '200', avgPowerConsumptionKwh: '0.2',
    }))
    expect(updated.success).toBe(true)

    const del = await deletePrinter(printer.id)
    expect(del.success).toBe(true)
    const softDeleted = await prisma.printer.findUniqueOrThrow({ where: { id: printer.id } })
    expect(softDeleted.active).toBe(false)
  })
})
```

Nota: `deletePrinter` faz soft-delete (Step 4 abaixo), então o teste confere
`active: false`, não a ausência da linha — a linha continua existindo no
banco.

Configurar no `vitest.config.ts` (Task 1) `test.env = { DATABASE_URL:
process.env.TEST_DATABASE_URL }` ou usar `dotenv -e .env.test` — usar a
mesma técnica em todos os testes de integração das tasks seguintes.

- [ ] **Step 2: Rodar e confirmar falha**

Run: `dotenv -e .env -- npx prisma migrate deploy` (aplica migrações no
banco de teste antes, apontando `DATABASE_URL` para `TEST_DATABASE_URL` via
`cross-env` ou script dedicado `db:test:push`)
Run: `npm test`
Expected: FAIL — `Cannot find module '@/actions/printers'`

- [ ] **Step 3: Zod schema**

```typescript
// lib/validation/printer.ts
import { z } from 'zod'

export const printerSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório'),
  purchasePrice: z.coerce.number().positive(),
  depreciationHours: z.coerce.number().positive(),
  maintenanceCost: z.coerce.number().nonnegative(),
  avgPowerConsumptionKwh: z.coerce.number().positive(),
})

export type PrinterInput = z.infer<typeof printerSchema>
```

```typescript
// lib/validation/filament.ts
import { z } from 'zod'

export const filamentSchema = z.object({
  manufacturer: z.string().min(1, 'Nome/fabricante é obrigatório'),
  diameterMm: z.coerce.number().positive(),
  spoolPrice: z.coerce.number().positive(),
  spoolWeightKg: z.coerce.number().positive(),
  densityGCm3: z.coerce.number().positive(),
  nozzleTempC: z.coerce.number().int().positive(),
  bedTempC: z.coerce.number().int().nonnegative(),
})

export type FilamentInput = z.infer<typeof filamentSchema>
```

- [ ] **Step 4: Server actions**

```typescript
// actions/printers.ts
'use server'
import { prisma } from '@/lib/prisma'
import { printerSchema } from '@/lib/validation/printer'
import { revalidatePath } from 'next/cache'

function parse(formData: FormData) {
  return printerSchema.safeParse(Object.fromEntries(formData))
}

export async function createPrinter(formData: FormData) {
  const parsed = parse(formData)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  await prisma.printer.create({ data: parsed.data })
  revalidatePath('/printers')
  return { success: true }
}

export async function updatePrinter(id: string, formData: FormData) {
  const parsed = parse(formData)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  await prisma.printer.update({ where: { id }, data: parsed.data })
  revalidatePath('/printers')
  return { success: true }
}

export async function deletePrinter(id: string) {
  await prisma.printer.update({ where: { id }, data: { active: false } })
  revalidatePath('/printers')
  return { success: true }
}
```

`deletePrinter` faz soft-delete (`active: false`) em vez de apagar a linha,
porque `Product` e `ProductionRun` referenciam `Printer` — impressoras
usadas em produtos existentes não podem ser removidas fisicamente. Repita
esse padrão de soft-delete em toda entidade de catálogo referenciada por
`Product` (Filament, PackagingItem, Accessory, Supply) nas Tasks 6 e 7.

`actions/filaments.ts` segue exatamente o mesmo padrão com `filamentSchema`
e `prisma.filament`.

- [ ] **Step 5: Rodar e confirmar sucesso**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Página de lista + formulário (Printers)**

```tsx
// app/(app)/printers/page.tsx
import { prisma } from '@/lib/prisma'
import { calculatePrinterDepreciationCostPerHour } from '@/lib/costing'
import { PrinterForm } from './PrinterForm'
import { deletePrinter } from '@/actions/printers'

export default async function PrintersPage() {
  const printers = await prisma.printer.findMany({ where: { active: true }, orderBy: { name: 'asc' } })

  return (
    <div className="p-6">
      <h1 className="mb-4 text-lg font-semibold">Impressoras</h1>
      <PrinterForm />
      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="border-b text-left text-slate-500">
            <th className="py-2">Nome</th>
            <th>Preço</th>
            <th>Depreciação R$/h</th>
            <th>Consumo kWh/h</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {printers.map((p) => {
            const depCost = calculatePrinterDepreciationCostPerHour({
              purchasePrice: p.purchasePrice.toNumber(),
              maintenanceCost: p.maintenanceCost.toNumber(),
              depreciationHours: p.depreciationHours.toNumber(),
            })
            return (
              <tr key={p.id} className="border-b">
                <td className="py-2">{p.name}</td>
                <td>R$ {p.purchasePrice.toNumber().toFixed(2)}</td>
                <td>R$ {depCost.toFixed(4)}</td>
                <td>{p.avgPowerConsumptionKwh.toNumber()}</td>
                <td>
                  <form action={async () => { 'use server'; await deletePrinter(p.id) }}>
                    <button className="text-red-600 hover:underline">Remover</button>
                  </form>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
```

```tsx
// app/(app)/printers/PrinterForm.tsx
'use client'
import { useRef } from 'react'
import { createPrinter } from '@/actions/printers'

export function PrinterForm() {
  const formRef = useRef<HTMLFormElement>(null)

  async function action(formData: FormData) {
    const result = await createPrinter(formData)
    if (result.success) formRef.current?.reset()
    else alert(result.error)
  }

  return (
    <form ref={formRef} action={action} className="grid grid-cols-5 gap-2 rounded-lg border border-slate-200 p-4">
      <input name="name" placeholder="Nome" className="rounded border px-2 py-1 text-sm" required />
      <input name="purchasePrice" type="number" step="0.01" placeholder="Preço" className="rounded border px-2 py-1 text-sm" required />
      <input name="depreciationHours" type="number" step="1" placeholder="Horas depreciação" className="rounded border px-2 py-1 text-sm" required />
      <input name="maintenanceCost" type="number" step="0.01" placeholder="Custo manutenção" className="rounded border px-2 py-1 text-sm" required />
      <input name="avgPowerConsumptionKwh" type="number" step="0.001" placeholder="Consumo kWh/h" className="rounded border px-2 py-1 text-sm" required />
      <button className="col-span-5 mt-2 rounded bg-slate-900 py-1.5 text-sm text-white hover:bg-slate-700">Adicionar</button>
    </form>
  )
}
```

`app/(app)/filaments/page.tsx` e `FilamentForm.tsx` seguem exatamente o
mesmo padrão, trocando os campos pelos de `filamentSchema` e exibindo
`calculateFilamentPricePerKg` na coluna de preço/kg.

- [ ] **Step 7: Adicionar links no menu do layout `(app)` (Task 4) para "Impressoras" e "Filamentos"**

- [ ] **Step 8: Verificação manual**

Run: `npm run dev` e acessar `/printers` e `/filaments` logado — confirmar
que criar/remover funciona na UI.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add printers and filaments CRUD (reference pattern for catalogs)"
```

---

### Task 6: Catálogos restantes — Embalagens, Acessórios, Insumos e Configurações

Seguir exatamente o padrão da Task 5 (Zod schema + server actions +
página + formulário, soft-delete via `active: false`) para cada entidade
abaixo. `Settings` é exceção: é um singleton (`id` sempre `1`), então tem
apenas `updateSettings`, sem create/delete, e uma única página de formulário
pré-preenchido.

**Files:**
- Create: `lib/validation/packaging.ts`, `lib/validation/accessory.ts`,
  `lib/validation/supply.ts`, `lib/validation/settings.ts`
- Create: `actions/packaging.ts`, `actions/accessories.ts`,
  `actions/supplies.ts`, `actions/settings.ts`
- Create: `app/(app)/packaging/page.tsx` + `PackagingForm.tsx`
- Create: `app/(app)/accessories/page.tsx` + `AccessoryForm.tsx`
- Create: `app/(app)/supplies/page.tsx` + `SupplyForm.tsx`
- Create: `app/(app)/settings/page.tsx` + `SettingsForm.tsx`
- Test: `tests/integration/packaging.test.ts`, `tests/integration/accessories.test.ts`,
  `tests/integration/supplies.test.ts`, `tests/integration/settings.test.ts`

**Interfaces:**
- Consumes: padrão de `actions/printers.ts` (Task 5)
- Produces: `create/update/deletePackagingItem`, `create/update/deleteAccessory`,
  `create/update/deleteSupply`, `updateSettings` — usados pela Task 7
  (dropdowns de PackagingItem/Accessory/Supply no formulário de Product) e
  por toda leitura de `Settings` nas Tasks 7, 8, 9, 11.

Campos por entidade (Zod + Prisma já definidos na Task 2):
- **PackagingItem**: `name` (string, obrigatório), `unitCost` (number, positivo).
- **Accessory**: `name` (string, obrigatório), `type` (enum
  `CORRENTE_BOLINHA | CORRENTE_ELO | MOSQUETAO | CLICKER | OUTRO`, select no
  formulário), `unitCost` (number, positivo).
- **Supply**: `name` (string, obrigatório), `unit` (enum `UN | ML | G`,
  select), `unitCost` (number, não-negativo).
- **Settings** (todos number, todos entre 0 e 1 exceto os marcados):
  `energyCostPerKwh` (positivo), `laborCostPerHour` (positivo),
  `failureRatePercent` (0-1), `marketplaceFeePercent` (0-1), `taxPercent`
  (0-1), `marketplaceFixedFee` (não-negativo, valor livre em R$),
  `defaultMarkup` (positivo, valor livre, tipicamente ≥1).

- [ ] **Step 1: Escrever os 4 testes de integração seguindo o modelo de
  `tests/integration/printers.test.ts`** (create válido, create rejeitado
  por campo inválido, update, delete/soft-delete). Para `settings.test.ts`,
  testar apenas `updateSettings` (não há create/delete) e que os valores
  persistem.

- [ ] **Step 2: Rodar e confirmar falha** (`npm test` — módulos inexistentes)

- [ ] **Step 3: Implementar os 4 Zod schemas** seguindo exatamente o modelo
  de `lib/validation/printer.ts`, com os campos listados acima.

- [ ] **Step 4: Implementar as 4 server actions** seguindo exatamente o
  modelo de `actions/printers.ts`. `updateSettings` difere:

```typescript
// actions/settings.ts
'use server'
import { prisma } from '@/lib/prisma'
import { settingsSchema } from '@/lib/validation/settings'
import { revalidatePath } from 'next/cache'

export async function updateSettings(formData: FormData) {
  const parsed = settingsSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  await prisma.settings.upsert({ where: { id: 1 }, update: parsed.data, create: { id: 1, ...parsed.data } })
  revalidatePath('/settings')
  return { success: true }
}
```

- [ ] **Step 5: Rodar e confirmar sucesso**

- [ ] **Step 6: Implementar as páginas e formulários** seguindo exatamente
  o modelo de `app/(app)/printers/page.tsx` e `PrinterForm.tsx` — lista +
  formulário de criação inline + botão remover (soft-delete) para
  Packaging/Accessory/Supply; para Settings, um único formulário
  pré-preenchido com os valores atuais (sem lista/tabela).

- [ ] **Step 7: Adicionar os 4 links no menu do layout `(app)`**

- [ ] **Step 8: Verificação manual** (`npm run dev`, testar as 4 telas)

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add packaging, accessories, supplies and settings CRUD"
```

---

### Task 7: Produtos (chaveiros/peças) com cálculo de custo ao vivo

**Files:**
- Create: `lib/validation/product.ts`
- Create: `actions/products.ts`
- Create: `app/(app)/products/page.tsx`, `app/(app)/products/ProductForm.tsx`,
  `app/(app)/products/CostBreakdown.tsx`
- Test: `tests/integration/products.test.ts`

**Interfaces:**
- Consumes: `calculateProductCost`, `calculateFilamentPricePerKg`,
  `calculatePrinterDepreciationCostPerHour` (Task 3); `Settings`, `Printer`,
  `Filament`, `PackagingItem`, `Accessory`, `Supply` (Tasks 2, 5, 6).
- Produces: `createProduct`, `updateProduct`, `deleteProduct` (mesmo
  contrato das Tasks 5/6); função `getProductCostBreakdown(productId:
  string): Promise<ProductCostBreakdown>` — usada pela Task 9 (Sales, para
  mostrar lucro) e Task 11 (Dashboard).

Campos de `Product` no formulário: `name` (string), `category` (string,
default "Chaveiro"), `printerId` (select de impressoras ativas),
`filamentId` (select de filamentos ativos), `weightGrams` (number),
`printTimeHours` (number), `laborTimeHours` (number), `packagingItemId`
(select opcional), `accessoryId` (select opcional), `finishingType` (enum
select), `usesGlue` (checkbox), `notes` (textarea opcional). Uso de insumos
(`ProductSupplyUsage`) é uma lista dinâmica no formulário: adicionar N pares
`supplyId` + `quantity`.

- [ ] **Step 1: Teste de integração (falhando)**

```typescript
// tests/integration/products.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createProduct, getProductCostBreakdown, addProductSupplyUsage } from '@/actions/products'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

beforeAll(async () => { await prisma.$connect() })
afterAll(async () => { await prisma.$disconnect() })
beforeEach(async () => {
  await prisma.product.deleteMany()
  await prisma.printer.deleteMany()
  await prisma.filament.deleteMany()
  await prisma.settings.deleteMany()
})

function fd(obj: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(obj)) f.append(k, v)
  return f
}

describe('products actions', () => {
  it('cria um produto e calcula o custo corretamente', async () => {
    await prisma.settings.create({ data: { id: 1 } })
    const printer = await prisma.printer.create({ data: { name: 'P1', purchasePrice: 3600, depreciationHours: 10000, maintenanceCost: 1000, avgPowerConsumptionKwh: 0.27 } })
    const filament = await prisma.filament.create({ data: { manufacturer: 'F1', diameterMm: 1.75, spoolPrice: 80, spoolWeightKg: 1, densityGCm3: 1.24, nozzleTempC: 220, bedTempC: 60 } })
    const supply = await prisma.supply.create({ data: { name: 'Insumo Teste', unit: 'UN', unitCost: 0.3 } })

    const result = await createProduct(fd({
      name: 'Chaveirinho Teste',
      category: 'Chaveiro',
      printerId: printer.id,
      filamentId: filament.id,
      weightGrams: '30',
      printTimeHours: '2',
      laborTimeHours: '0.25',
      finishingType: 'NENHUM',
      usesGlue: 'false',
    }))
    expect(result.success).toBe(true)

    const product = await prisma.product.findFirstOrThrow({ where: { name: 'Chaveirinho Teste' } })
    await addProductSupplyUsage(fd({ productId: product.id, supplyId: supply.id, quantity: '1' }))

    const breakdown = await getProductCostBreakdown(product.id)
    // subtotal = filament 2.4 + electricity 0.54 + printer 0.92 + labor 2.5 + supplies 0.3 = 6.66
    // finalCost = 6.66 * 1.10 = 7.326 -> suggestedPrice = 7.326 * 2 = 14.652 (same fixture as Task 3)
    expect(breakdown.suggestedPrice).toBeCloseTo(14.652, 2)
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

- [ ] **Step 3: Zod schema**

```typescript
// lib/validation/product.ts
import { z } from 'zod'

export const productSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório'),
  category: z.string().min(1).default('Chaveiro'),
  printerId: z.string().min(1, 'Selecione uma impressora'),
  filamentId: z.string().min(1, 'Selecione um filamento'),
  weightGrams: z.coerce.number().positive(),
  printTimeHours: z.coerce.number().positive(),
  laborTimeHours: z.coerce.number().nonnegative(),
  packagingItemId: z.string().optional().nullable(),
  accessoryId: z.string().optional().nullable(),
  finishingType: z.enum(['NENHUM', 'CANETA_VERNIZ', 'RESINA_UV', 'OUTRO']),
  usesGlue: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  // `z.coerce.boolean()` would turn the literal string "false" into `true`
  // (any non-empty string is truthy in JS) — use this enum+transform instead.
  // The checkbox in the form must render `<input type="checkbox" name="usesGlue" value="true" />`
  // so a checked box submits "true"; an unchecked box omits the field entirely
  // (checkboxes never submit when unchecked), which falls through to the
  // `.default('false')` above.
  notes: z.string().optional().nullable(),
})
```

- [ ] **Step 4: Server actions**

```typescript
// actions/products.ts
'use server'
import { prisma } from '@/lib/prisma'
import { productSchema } from '@/lib/validation/product'
import { calculateProductCost } from '@/lib/costing'
import { revalidatePath } from 'next/cache'

function parse(formData: FormData) {
  const raw = Object.fromEntries(formData)
  return productSchema.safeParse({
    ...raw,
    packagingItemId: raw.packagingItemId || null,
    accessoryId: raw.accessoryId || null,
  })
}

export async function createProduct(formData: FormData) {
  const parsed = parse(formData)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  await prisma.product.create({ data: parsed.data })
  revalidatePath('/products')
  return { success: true }
}

export async function updateProduct(id: string, formData: FormData) {
  const parsed = parse(formData)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  await prisma.product.update({ where: { id }, data: parsed.data })
  revalidatePath('/products')
  return { success: true }
}

export async function deleteProduct(id: string) {
  await prisma.product.update({ where: { id }, data: { active: false } })
  revalidatePath('/products')
  return { success: true }
}

export async function getProductCostBreakdown(productId: string) {
  const [product, settings] = await Promise.all([
    prisma.product.findUniqueOrThrow({
      where: { id: productId },
      include: { printer: true, filament: true, packagingItem: true, accessory: true, supplyUsages: { include: { supply: true } } },
    }),
    prisma.settings.findUniqueOrThrow({ where: { id: 1 } }),
  ])

  const printerDepreciationCostPerHour = (product.printer.purchasePrice.toNumber() + product.printer.maintenanceCost.toNumber()) / product.printer.depreciationHours.toNumber()
  const suppliesCost = product.supplyUsages.reduce((sum, u) => sum + u.quantity.toNumber() * u.supply.unitCost.toNumber(), 0)

  return calculateProductCost({
    weightGrams: product.weightGrams.toNumber(),
    printTimeHours: product.printTimeHours.toNumber(),
    laborTimeHours: product.laborTimeHours.toNumber(),
    filamentPricePerKg: product.filament.spoolPrice.toNumber() / product.filament.spoolWeightKg.toNumber(),
    printerAvgPowerConsumptionKwh: product.printer.avgPowerConsumptionKwh.toNumber(),
    printerDepreciationCostPerHour,
    suppliesCost,
    packagingCost: product.packagingItem?.unitCost.toNumber() ?? 0,
    accessoryCost: product.accessory?.unitCost.toNumber() ?? 0,
  }, {
    energyCostPerKwh: settings.energyCostPerKwh.toNumber(),
    laborCostPerHour: settings.laborCostPerHour.toNumber(),
    failureRatePercent: settings.failureRatePercent.toNumber(),
    marketplaceFeePercent: settings.marketplaceFeePercent.toNumber(),
    taxPercent: settings.taxPercent.toNumber(),
    marketplaceFixedFee: settings.marketplaceFixedFee.toNumber(),
    defaultMarkup: settings.defaultMarkup.toNumber(),
  })
}
```

- [ ] **Step 5: Rodar e confirmar sucesso**

- [ ] **Step 6: Server actions de insumo do produto**, no mesmo arquivo
  `actions/products.ts`:

```typescript
const supplyUsageSchema = z.object({
  productId: z.string().min(1),
  supplyId: z.string().min(1),
  quantity: z.coerce.number().positive(),
})

export async function addProductSupplyUsage(formData: FormData) {
  const parsed = supplyUsageSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  await prisma.productSupplyUsage.upsert({
    where: { productId_supplyId: { productId: parsed.data.productId, supplyId: parsed.data.supplyId } },
    update: { quantity: parsed.data.quantity },
    create: parsed.data,
  })
  revalidatePath('/products')
  return { success: true }
}

export async function removeProductSupplyUsage(usageId: string) {
  await prisma.productSupplyUsage.delete({ where: { id: usageId } })
  revalidatePath('/products')
  return { success: true }
}
```

(`import { z } from 'zod'` no topo do arquivo, junto dos outros imports.)

- [ ] **Step 7: Página de lista + formulário**, seguindo o padrão da Task 5,
  com os selects de impressora/filamento/embalagem/acessório carregando as
  opções ativas via `prisma.<entidade>.findMany({ where: { active: true } })`
  no Server Component da página. A tabela de listagem mostra, por produto,
  as colunas: Nome, Categoria, Custo Final, Preço Sugerido, Preço
  Marketplace (via `getProductCostBreakdown`). O gerenciamento de
  `ProductSupplyUsage` (insumos usados) fica em uma seção dentro da página
  de edição do produto: uma lista das linhas atuais (`supplyUsages` do
  `findUnique` com `include`) com botão "Remover" chamando
  `removeProductSupplyUsage`, e um formulário abaixo com select de
  `Supply` + campo `quantity` chamando `addProductSupplyUsage`.

- [ ] **Step 8: Link no menu**

- [ ] **Step 9: Verificação manual**

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add products CRUD with live cost calculation"
```

---

### Task 8: Registro de produção e desperdício

**Files:**
- Create: `lib/validation/productionRun.ts`
- Create: `actions/productionRuns.ts`
- Create: `app/(app)/production/page.tsx`, `app/(app)/production/ProductionRunForm.tsx`
- Test: `tests/integration/productionRuns.test.ts`

**Interfaces:**
- Consumes: `Product`, `Printer`, `Filament` (Tasks 2, 5, 7)
- Produces: `createProductionRun`, `deleteProductionRun`; função
  `calculateWasteCost(run, filamentPricePerKg, printer)` em
  `lib/costing.ts` — usada pela Task 11 (Dashboard).

Campos: `productId` (select), `printerId` (select, pode diferir do padrão
do produto), `filamentId` (select, idem), `date` (date), `quantityPlanned`
(int), `quantitySuccess` (int), `quantityFailed` (int, `quantitySuccess +
quantityFailed` deve ser `<= quantityPlanned` — validar no Zod com
`.refine`), `gramsWasted` (number, não-negativo), `timeWastedHours` (number,
não-negativo), `notes` (opcional).

- [ ] **Step 1: Teste de integração (falhando)** seguindo o modelo das
  tasks anteriores: criar produto/impressora/filamento de apoio, criar um
  `ProductionRun` válido, e um caso rejeitado onde
  `quantitySuccess + quantityFailed > quantityPlanned`.

- [ ] **Step 2: Rodar e confirmar falha**

- [ ] **Step 3: Adicionar em `lib/costing.ts`**

```typescript
export interface WasteCostInput {
  gramsWasted: number
  timeWastedHours: number
  filamentPricePerKg: number
  printerDepreciationCostPerHour: number
  printerAvgPowerConsumptionKwh: number
  energyCostPerKwh: number
}

export function calculateWasteCost(input: WasteCostInput): number {
  const filamentWasteCost = input.gramsWasted * (input.filamentPricePerKg / 1000)
  const timeWasteCost = input.timeWastedHours * (input.printerDepreciationCostPerHour + input.energyCostPerKwh * input.printerAvgPowerConsumptionKwh)
  return filamentWasteCost + timeWasteCost
}
```

Adicionar teste correspondente em `tests/unit/costing.test.ts` antes de
implementar (mesmo ciclo TDD da Task 3).

- [ ] **Step 4: Zod schema com `.refine`**

```typescript
// lib/validation/productionRun.ts
import { z } from 'zod'

export const productionRunSchema = z.object({
  productId: z.string().min(1),
  printerId: z.string().min(1),
  filamentId: z.string().min(1),
  date: z.coerce.date(),
  quantityPlanned: z.coerce.number().int().positive(),
  quantitySuccess: z.coerce.number().int().nonnegative(),
  quantityFailed: z.coerce.number().int().nonnegative(),
  gramsWasted: z.coerce.number().nonnegative(),
  timeWastedHours: z.coerce.number().nonnegative(),
  notes: z.string().optional().nullable(),
}).refine((data) => data.quantitySuccess + data.quantityFailed <= data.quantityPlanned, {
  message: 'Sucesso + falhas não pode ser maior que o planejado',
  path: ['quantityFailed'],
})
```

- [ ] **Step 5: Server actions** seguindo o padrão (`createProductionRun`,
  `deleteProductionRun` — sem soft-delete aqui, é um log histórico, delete
  físico é aceitável para corrigir erro de digitação).

- [ ] **Step 6: Rodar e confirmar sucesso**

- [ ] **Step 7: Página de lista + formulário**, mostrando na tabela o custo
  de desperdício calculado por linha via `calculateWasteCost`.

- [ ] **Step 8: Link no menu**

- [ ] **Step 9: Verificação manual**

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add production run log with waste cost calculation"
```

---

### Task 9: Vendas — Direta e Marketplace

**Files:**
- Create: `lib/validation/sale.ts`
- Create: `actions/sales.ts`
- Create: `app/(app)/sales/page.tsx`, `app/(app)/sales/SaleForm.tsx`
- Test: `tests/integration/sales.test.ts`

**Interfaces:**
- Consumes: `Product` (Task 7), `getProductCostBreakdown` (Task 7),
  `Settings` (Task 6)
- Produces: `createSale`, `deleteSale`; `getSaleProfit(sale, product):
  number` — usada pela Task 11.

Campos: `channel` (select `DIRETA`/`MARKETPLACE`), `productId` (select),
`quantity` (int positivo), `unitPrice` (number positivo — para
`MARKETPLACE`, pré-preencher no formulário com o `marketplacePrice`
calculado do produto selecionado via fetch client-side, mas o campo
continua editável), `saleDate` (date), `buyerOrPlatform` (opcional),
`notes` (opcional).

- [ ] **Step 1: Teste de integração (falhando)**, criando produto de apoio,
  uma venda `DIRETA` válida, uma `MARKETPLACE` válida, e um caso rejeitado
  (`quantity` zero ou negativo).

- [ ] **Step 2: Rodar e confirmar falha**

- [ ] **Step 3: Zod schema**

```typescript
// lib/validation/sale.ts
import { z } from 'zod'

export const saleSchema = z.object({
  channel: z.enum(['DIRETA', 'MARKETPLACE']),
  productId: z.string().min(1),
  quantity: z.coerce.number().int().positive(),
  unitPrice: z.coerce.number().positive(),
  saleDate: z.coerce.date(),
  buyerOrPlatform: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
})
```

- [ ] **Step 4: Server actions** (`createSale`, `deleteSale`, seguindo o
  padrão; delete físico permitido — venda registrada errada pode ser
  removida).

```typescript
// em actions/sales.ts, além de create/delete:
import { getProductCostBreakdown } from './products'

export async function getSaleProfit(saleId: string) {
  const sale = await prisma.sale.findUniqueOrThrow({ where: { id: saleId } })
  const breakdown = await getProductCostBreakdown(sale.productId)
  return sale.quantity.valueOf() * (sale.unitPrice.toNumber() - breakdown.finalCost)
}
```

- [ ] **Step 5: Rodar e confirmar sucesso**

- [ ] **Step 6: Página de lista + formulário**, com filtro por canal no
  topo da lista e coluna de lucro calculada via `getSaleProfit`.

- [ ] **Step 7: Link no menu**

- [ ] **Step 8: Verificação manual**

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add direct and marketplace sales tracking"
```

---

### Task 10: Consignado — Parceiros, Entregas e Relatórios de Venda

**Files:**
- Create: `lib/validation/consignment.ts`
- Create: `actions/consignmentPartners.ts`, `actions/consignmentDeliveries.ts`,
  `actions/consignmentSaleReports.ts`
- Create: `app/(app)/consignment/partners/page.tsx` + `PartnerForm.tsx`
- Create: `app/(app)/consignment/deliveries/page.tsx` + `DeliveryForm.tsx`
- Create: `app/(app)/consignment/reports/page.tsx` + `SaleReportForm.tsx`
- Test: `tests/integration/consignment.test.ts`

**Interfaces:**
- Consumes: `Product` (Task 7)
- Produces: `createConsignmentPartner/Delivery/SaleReport`,
  `getPartnerStock(partnerId): Promise<{productId, productName, delivered, sold, remaining}[]>`
  — usada pela Task 11 (Dashboard, estoque em consignação).

Campos:
- **ConsignmentPartner**: `name` (obrigatório), `defaultCommissionPercent`
  (0-1), `notes` (opcional).
- **ConsignmentDelivery**: `partnerId` (select), `productId` (select),
  `quantityDelivered` (int positivo), `unitPrice` (number positivo),
  `deliveryDate` (date), `notes` (opcional).
- **ConsignmentSaleReport**: `deliveryId` (select, mostrando parceiro +
  produto + saldo restante daquela entrega), `quantitySold` (int positivo,
  `.refine` — não pode exceder o saldo restante da entrega),
  `reportDate` (date), `commissionPercent` (number 0-1, pré-preenchido com
  o `defaultCommissionPercent` do parceiro mas editável), `notes` (opcional).

- [ ] **Step 1: Teste de integração (falhando)** cobrindo: criar parceiro,
  criar entrega, criar relatório de venda válido, e um relatório rejeitado
  por exceder o saldo restante (`quantitySold > quantityDelivered -
  somaJaReportada`).

- [ ] **Step 2: Rodar e confirmar falha**

- [ ] **Step 3: Zod schemas** (3 schemas, seguindo o padrão; o `.refine` de
  saldo em `ConsignmentSaleReport` precisa ser feito na server action, não
  no Zod puro, porque depende de uma consulta ao banco — validar ali e
  retornar `{success: false, error: 'Quantidade excede o saldo disponível'}`.

- [ ] **Step 4: Server actions**

```typescript
// actions/consignmentSaleReports.ts (essencial)
'use server'
import { prisma } from '@/lib/prisma'
import { consignmentSaleReportSchema } from '@/lib/validation/consignment'
import { revalidatePath } from 'next/cache'

export async function createConsignmentSaleReport(formData: FormData) {
  const parsed = consignmentSaleReportSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const delivery = await prisma.consignmentDelivery.findUniqueOrThrow({
    where: { id: parsed.data.deliveryId },
    include: { saleReports: true },
  })
  const alreadySold = delivery.saleReports.reduce((sum, r) => sum + r.quantitySold, 0)
  const remaining = delivery.quantityDelivered - alreadySold
  if (parsed.data.quantitySold > remaining) {
    return { success: false, error: `Quantidade excede o saldo disponível (${remaining})` }
  }

  await prisma.consignmentSaleReport.create({ data: parsed.data })
  revalidatePath('/consignment/reports')
  return { success: true }
}

export async function getPartnerStock(partnerId: string) {
  const deliveries = await prisma.consignmentDelivery.findMany({
    where: { partnerId },
    include: { product: true, saleReports: true },
  })
  return deliveries.map((d) => {
    const sold = d.saleReports.reduce((sum, r) => sum + r.quantitySold, 0)
    return {
      productId: d.productId,
      productName: d.product.name,
      delivered: d.quantityDelivered,
      sold,
      remaining: d.quantityDelivered - sold,
    }
  })
}
```

`actions/consignmentPartners.ts` e `actions/consignmentDeliveries.ts`
seguem o padrão simples de create/update/delete (soft-delete para
`ConsignmentPartner`, delete físico aceitável para `ConsignmentDelivery`
sem relatórios de venda associados — bloquear delete se houver
`saleReports`).

- [ ] **Step 5: Rodar e confirmar sucesso**

- [ ] **Step 6: As 3 páginas** seguindo o padrão de lista+formulário; a
  página de entregas mostra o saldo restante por entrega
  (delivered - soldSum); a página de relatórios usa `getPartnerStock`
  indiretamente ao popular o select de entregas com saldo > 0.

- [ ] **Step 7: 3 links no menu (agrupados em "Consignado")**

- [ ] **Step 8: Verificação manual**

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add consignment tracking (partners, deliveries, sale reports)"
```

---

### Task 11: Dashboard

**Files:**
- Create: `app/(app)/dashboard/page.tsx`
- Create: `lib/reports.ts`
- Test: `tests/integration/reports.test.ts`

**Interfaces:**
- Consumes: `Sale` (Task 9), `ConsignmentSaleReport`/`getPartnerStock`
  (Task 10), `ProductionRun`/`calculateWasteCost` (Task 8),
  `getProductCostBreakdown` (Task 7)

- [ ] **Step 1: Teste de integração (falhando) para `lib/reports.ts`**

```typescript
// tests/integration/reports.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { getRevenueByChannel } from '@/lib/reports'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

beforeAll(async () => { await prisma.$connect() })
afterAll(async () => { await prisma.$disconnect() })
beforeEach(async () => {
  await prisma.sale.deleteMany()
  await prisma.product.deleteMany()
  await prisma.printer.deleteMany()
  await prisma.filament.deleteMany()
})

describe('getRevenueByChannel', () => {
  it('soma receita por canal corretamente', async () => {
    const printer = await prisma.printer.create({ data: { name: 'P', purchasePrice: 1, depreciationHours: 1, maintenanceCost: 0, avgPowerConsumptionKwh: 0.1 } })
    const filament = await prisma.filament.create({ data: { manufacturer: 'F', diameterMm: 1.75, spoolPrice: 100, spoolWeightKg: 1, densityGCm3: 1.2, nozzleTempC: 200, bedTempC: 60 } })
    const product = await prisma.product.create({ data: { name: 'X', printerId: printer.id, filamentId: filament.id, weightGrams: 10, printTimeHours: 1, laborTimeHours: 0 } })
    await prisma.sale.create({ data: { channel: 'DIRETA', productId: product.id, quantity: 2, unitPrice: 10, saleDate: new Date() } })
    await prisma.sale.create({ data: { channel: 'MARKETPLACE', productId: product.id, quantity: 1, unitPrice: 20, saleDate: new Date() } })

    const result = await getRevenueByChannel()
    expect(result.DIRETA).toBeCloseTo(20, 2)
    expect(result.MARKETPLACE).toBeCloseTo(20, 2)
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

- [ ] **Step 3: Implementar `lib/reports.ts`**

```typescript
import { prisma } from '@/lib/prisma'
import { calculateWasteCost } from '@/lib/costing'

export async function getRevenueByChannel(): Promise<Record<'DIRETA' | 'MARKETPLACE', number>> {
  const sales = await prisma.sale.findMany()
  const result: Record<string, number> = { DIRETA: 0, MARKETPLACE: 0 }
  for (const s of sales) {
    result[s.channel] += s.quantity * s.unitPrice.toNumber()
  }
  return result as Record<'DIRETA' | 'MARKETPLACE', number>
}

export async function getTotalWasteCost(): Promise<number> {
  const runs = await prisma.productionRun.findMany({ include: { printer: true, filament: true } })
  const settings = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })
  return runs.reduce((sum, run) => {
    const printerDepreciationCostPerHour = (run.printer.purchasePrice.toNumber() + run.printer.maintenanceCost.toNumber()) / run.printer.depreciationHours.toNumber()
    return sum + calculateWasteCost({
      gramsWasted: run.gramsWasted.toNumber(),
      timeWastedHours: run.timeWastedHours.toNumber(),
      filamentPricePerKg: run.filament.spoolPrice.toNumber() / run.filament.spoolWeightKg.toNumber(),
      printerDepreciationCostPerHour,
      printerAvgPowerConsumptionKwh: run.printer.avgPowerConsumptionKwh.toNumber(),
      energyCostPerKwh: settings.energyCostPerKwh.toNumber(),
    })
  }, 0)
}

export async function getTopProducts(limit = 5) {
  const grouped = await prisma.sale.groupBy({
    by: ['productId'],
    _sum: { quantity: true },
    orderBy: { _sum: { quantity: 'desc' } },
    take: limit,
  })
  const products = await prisma.product.findMany({ where: { id: { in: grouped.map((g) => g.productId) } } })
  return grouped.map((g) => ({
    product: products.find((p) => p.id === g.productId)!,
    quantitySold: g._sum.quantity ?? 0,
  }))
}

export async function getConsignmentStockSummary() {
  const deliveries = await prisma.consignmentDelivery.findMany({
    include: { partner: true, product: true, saleReports: true },
  })
  return deliveries
    .map((d) => ({
      partnerName: d.partner.name,
      productName: d.product.name,
      remaining: d.quantityDelivered - d.saleReports.reduce((s, r) => s + r.quantitySold, 0),
    }))
    .filter((d) => d.remaining > 0)
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

- [ ] **Step 5: Página do dashboard** consumindo as 4 funções acima em um
  Server Component, exibindo: cards de receita por canal e total, custo de
  desperdício total, tabela de top 5 produtos, tabela de estoque em
  consignação por parceiro. Aplicar a skill `impeccable-design` no layout
  desta página especificamente — é a tela de maior impacto visual do app.

- [ ] **Step 6: Tornar `/dashboard` a rota raiz pós-login** (redirecionar
  `app/page.tsx` para `/dashboard` se autenticado).

- [ ] **Step 7: Verificação manual**

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add dashboard with revenue, waste cost and consignment stock"
```

---

### Task 12: Deploy no Coolify

**Files:**
- Create: `Dockerfile`
- Modify: `docker-compose.yaml` (substituir o placeholder nginx detectado
  pelo Coolify)
- Create: `.dockerignore`
- Modify: `next.config.js` (adicionar `output: 'standalone'`)
- Modify: `README.md` (instruções de deploy)

- [ ] **Step 1: `next.config.js`**

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
}
module.exports = nextConfig
```

- [ ] **Step 2: `Dockerfile`**

```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/.bin ./node_modules/.bin
EXPOSE 3000
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && (node_modules/.bin/prisma db seed || true) && node server.js"]
```

`node_modules/prisma` e `node_modules/.bin` precisam ser copiados
explicitamente porque o output `standalone` do Next.js só inclui o que é
importado em código (`@prisma/client`), não o CLI `prisma` usado em
`migrate deploy`/`db seed` em runtime. Testar a build local (Step 5) para
confirmar que os dois comandos rodam dentro do container.

- [ ] **Step 3: `docker-compose.yaml`**

```yaml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: ${DATABASE_URL}
      APP_PASSWORD: ${APP_PASSWORD}
      SESSION_SECRET: ${SESSION_SECRET}
    restart: unless-stopped
```

- [ ] **Step 4: `.dockerignore`**

```
node_modules
.next
.git
.env
*.log
```

- [ ] **Step 5: Build local de verificação (se Docker estiver disponível
  no ambiente de execução; caso contrário, pular para o Step 6 e validar
  apenas no Coolify)**

Run: `docker build -t tk3d-test .`
Expected: build concluído sem erro.

- [ ] **Step 6: README com instruções de deploy**

Documentar em `README.md`: as 3 variáveis de ambiente exigidas
(`DATABASE_URL` com `?schema=tk3d` apontando para
`postgresql-database-geral`, `APP_PASSWORD`, `SESSION_SECRET`) e como
gerá-las. O seed roda automaticamente a cada start do container (`CMD` do
Dockerfile, Step 2) — `prisma db seed` usa `upsert` por campo único, então
rodar de novo em um banco já populado não duplica nem falha, apenas não
faz nada nas linhas que já existem.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: add Dockerfile, docker-compose and deploy docs for Coolify"
```

- [ ] **Step 8: Push e deploy**

```bash
git push origin claude/install-superpowers-skill-l9mj5a
```

Após o usuário configurar as 3 variáveis de ambiente no Coolify (projeto
TK3D, aplicação `t-k3-d`), disparar o deploy via ferramenta MCP `deploy`
com o UUID `0gm6qi07yczzysnrxsnq5aik`, ou instruir o usuário a clicar em
"Deploy" na UI do Coolify.
