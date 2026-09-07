# Controle de Produção e Vendas de Impressão 3D — Spec de Design

**Data:** 2026-09-07
**Status:** Aprovado pelo usuário (brainstorming architectural path)

## 1. Objetivo

Sistema web pessoal para controlar custos de impressão 3D (chaveiros e outras
peças), produção (incluindo desperdícios), e vendas (venda direta, marketplace
e consignado). Substitui a planilha atual, mantendo a mesma lógica de cálculo
de custos, mas com cadastros normalizados, histórico de produção real e
controle de vendas/consignação que a planilha não tem.

Usuário tem duas impressoras (Bambu Lab A1 Mini e Anycubic Kobra X), usa
diversos filamentos, acessórios de chaveiro (corrente de bolinha, corrente de
elo, mosquetão, clicker), acabamentos (caneta acrílica + verniz spray, resina
UV) e cola Tekbond 200 para peças multi-partes.

## 2. Arquitetura

- **Next.js 15 (App Router) + TypeScript** — front e back no mesmo app
  (Server Actions / Route Handlers), um único container.
- **Tailwind CSS** para estilo; aplicar a skill `impeccable-design` ao
  desenhar as telas (evitar UI genérica).
- **Prisma ORM + PostgreSQL**. Banco: instância compartilhada do Coolify
  (`postgresql-database-geral`), usando o schema dedicado `tk3d` dentro do
  banco `postgres` (isolamento sem precisar criar banco novo).
- **Autenticação:** senha única (env var `APP_PASSWORD`), cookie HTTPOnly
  assinado (env var `SESSION_SECRET`), middleware protegendo todas as rotas
  exceto `/login` e assets estáticos. Sem cadastro de usuários.
- **Deploy:** Dockerfile (build standalone do Next.js) + `docker-compose.yaml`
  na raiz do repo (Coolify já espera esse arquivo, projeto `TK3D` já
  existente). Migrations do Prisma rodam no start do container
  (`prisma migrate deploy`).

## 3. Modelo de dados

Todos os valores monetários em `Decimal` (Prisma `Decimal`, não float) para
evitar erro de arredondamento em custos.

### 3.1 Settings (singleton — uma única linha)
| Campo | Tipo | Padrão (da planilha) |
|---|---|---|
| energyCostPerKwh | Decimal | 1.00 |
| laborCostPerHour | Decimal | 10.00 |
| failureRatePercent | Decimal (0-1) | 0.10 |
| marketplaceFeePercent | Decimal (0-1) | 0.20 |
| taxPercent | Decimal (0-1) | 0.055 |
| marketplaceFixedFee | Decimal | 4.00 |
| defaultMarkup | Decimal | 2.00 |

### 3.2 Printer
`id, name, purchasePrice, depreciationHours, maintenanceCost, avgPowerConsumptionKwh, createdAt, updatedAt`

Campo derivado (calculado em código, não persistido):
`depreciationCostPerHour = (purchasePrice + maintenanceCost) / depreciationHours`

Seed inicial: Bambu Lab A1 Mini (3000, 10000h, 700, 0.15 kWh/h),
Anycubic Kobra X (3600, 10000h, 1000, 0.27 kWh/h). Demais impressoras da
planilha (Bambulab A1, Snapmaker U1, Anycubic Kobra S1) entram também como
histórico de referência, mesmo não sendo as impressoras atuais do usuário —
ficam marcadas com `active=false`.

Adicionar campo `active: boolean` (default true) para permitir desativar sem
apagar (impressora vendida/trocada mas com produtos históricos vinculados).

### 3.3 Filament
`id, manufacturer, diameterMm, spoolPrice, spoolWeightKg, densityGCm3, nozzleTempC, bedTempC, active, createdAt, updatedAt`

Derivado: `pricePerKg = spoolPrice / spoolWeightKg`

Seed: os 7 filamentos da planilha (Voolt3D PLA, Outro, 3nmax, Polyterra,
Bambu Lite, eSUN Matte, Bambu TPU AMS).

### 3.4 PackagingItem
`id, name, unitCost, active, createdAt, updatedAt`

Seed a partir da aba "Embalagem": Caixa Grande (3.1656), Caixa Pequena
(1.398), Almofada Colmeia (0.8517), Fita gomada (0.1933), Etiqueta (0.1333).

### 3.5 Accessory (acessórios de chaveiro)
`id, name, type (enum: CORRENTE_BOLINHA | CORRENTE_ELO | MOSQUETAO | CLICKER | OUTRO), unitCost, active, createdAt, updatedAt`

Não existe na planilha — novo cadastro pedido pelo usuário. Seed vazio (ele
cadastra os que usa).

### 3.6 Supply (insumos de acabamento — consumíveis)
`id, name, unit (enum: UN | ML | G), unitCost, active, createdAt, updatedAt`

Seed sugerido: "Caneta acrílica" (UN), "Spray verniz" (ML), "Resina UV" (ML),
"Cola Tekbond 200" (ML) — usuário ajusta os custos reais depois.

### 3.7 Product (cadastro da peça/chaveiro — o "molde", não uma impressão específica)
```
id
name
category            (string livre, default "Chaveiro")
printerId            -> Printer
filamentId           -> Filament
weightGrams          Decimal
printTimeHours        Decimal
laborTimeHours        Decimal
packagingItemId      -> PackagingItem (nullable)
accessoryId          -> Accessory (nullable)
finishingType        enum: NENHUM | CANETA_VERNIZ | RESINA_UV | OUTRO
usesGlue             boolean            (Tekbond 200, peça multi-partes)
notes                string?
active               boolean
createdAt / updatedAt
```

Relação N:N com `Supply` via tabela `ProductSupplyUsage`
(`productId, supplyId, quantity`) — cobre caneta+verniz, resina UV, cola,
podendo ter mais de um insumo por produto (ex: caneta + verniz no mesmo
chaveiro).

**Custos calculados (função pura, não persistidos — sempre recalculados a
partir do cadastro + Settings vigentes):**

```
filamentCost      = weightGrams * (filament.pricePerKg / 1000)
electricityCost   = printer.avgPowerConsumptionKwh * settings.energyCostPerKwh * printTimeHours
printerCost       = printerDepreciationCostPerHour * printTimeHours
laborCost         = settings.laborCostPerHour * laborTimeHours
suppliesCost      = sum(usage.quantity * supply.unitCost) para cada ProductSupplyUsage
packagingCost     = packagingItem?.unitCost ?? 0
accessoryCost     = accessory?.unitCost ?? 0

subtotal          = filamentCost + electricityCost + printerCost + laborCost
                    + suppliesCost + packagingCost + accessoryCost
finalCost         = subtotal * (1 + settings.failureRatePercent)
suggestedPrice    = finalCost * settings.defaultMarkup
marketplacePrice  = suggestedPrice / (1 - settings.marketplaceFeePercent - settings.taxPercent)
                    + settings.marketplaceFixedFee
```

Fórmulas validadas linha a linha contra a planilha anexada (ex. "Chaveirinho":
filamentCost 2.40, electricityCost 0.54, printerCost 0.92, subtotal 6.66,
finalCost 7.326, suggestedPrice 14.652, marketplacePrice 23.667 — todos batem
com a fórmula acima usando os valores de Settings default).

### 3.8 ProductionRun (registro de produção / desperdício)
```
id
productId          -> Product
printerId           -> Printer (pode diferir do printer padrão do produto)
filamentId          -> Filament (idem)
date
quantityPlanned      int
quantitySuccess      int
quantityFailed       int
gramsWasted          Decimal   (filamento perdido em falhas)
timeWastedHours       Decimal   (tempo de impressora perdido em falhas)
notes                string?
createdAt
```

Custo do desperdício (calculado): `gramsWasted * filament.pricePerKg/1000 +
timeWastedHours * (printer.depreciationCostPerHour + settings.energyCostPerKwh * printer.avgPowerConsumptionKwh)`.

### 3.9 Vendas

`SaleChannel` enum: `DIRETA | MARKETPLACE`. Consignado é modelado à parte
(3.10) porque tem ciclo de vida diferente (entrega → venda parcial → estoque
remanescente).

**Sale** (venda direta e marketplace)
```
id
channel              SaleChannel
productId            -> Product
quantity             int
unitPrice            Decimal   (preço praticado)
saleDate
buyerOrPlatform      string?   (nome do comprador ou "Mercado Livre", "Shopee" etc)
notes                string?
createdAt
```

Campos derivados exibidos (não persistidos): custo unitário do produto no
momento da consulta (`finalCost` atual), lucro = `quantity * (unitPrice -
finalCost)`; para `MARKETPLACE`, também mostra taxa/imposto/taxa fixa
descontados do valor bruto.

### 3.10 Consignado

**ConsignmentPartner** (loja ou pessoa)
```
id, name, defaultCommissionPercent (Decimal 0-1), notes?, active, createdAt
```

**ConsignmentDelivery** (o que foi deixado lá)
```
id, partnerId -> ConsignmentPartner, productId -> Product,
quantityDelivered int, unitPrice Decimal (valor de venda combinado),
deliveryDate, notes?, createdAt
```

**ConsignmentSaleReport** (o que a loja reportou que vendeu)
```
id, deliveryId -> ConsignmentDelivery, quantitySold int, reportDate,
commissionPercent Decimal (snapshot — pode divergir do default do parceiro),
notes?, createdAt
```

Estoque restante com o parceiro para uma entrega =
`quantityDelivered - sum(quantitySold reportado)`. Valor a receber por venda
reportada = `quantitySold * unitPrice * (1 - commissionPercent)`.

## 4. Dashboard

Uma página `/dashboard` com:
- Receita total e por canal (direta / marketplace / consignado) — período
  filtrável (mês atual, últimos 30 dias, tudo).
- Custo total de produção (soma de `finalCost` das unidades vendidas) e lucro.
- Custo de desperdício (soma de `ProductionRun` no período).
- Estoque em consignação por parceiro (quantidade ainda não vendida).
- Top 5 produtos mais vendidos.

## 5. Autenticação

- Página `/login` com campo de senha, compara com `APP_PASSWORD` (hash não é
  necessário para uma única senha de app pessoal, mas comparamos com
  `crypto.timingSafeEqual` para evitar timing attack).
- Cookie `session` HTTPOnly + `Secure` + `SameSite=Lax`, valor assinado com
  HMAC-SHA256 usando `SESSION_SECRET`, validade 30 dias.
- `middleware.ts` bloqueia qualquer rota exceto `/login` e `/api/login` sem
  cookie válido.

## 6. Deploy no Coolify

- `Dockerfile` multi-stage (deps → build `next build` com `output: standalone`
  → runtime `node:20-alpine` mínimo).
- `docker-compose.yaml` na raiz, serviço único `app`, porta 3000 (já
  configurada no projeto Coolify TK3D), `command` executa
  `prisma migrate deploy && node server.js`.
- Variáveis de ambiente a configurar manualmente no Coolify (o usuário faz
  isso na UI, fora do escopo desta automação):
  - `DATABASE_URL` — string de conexão do Postgres compartilhado +
    `?schema=tk3d`
  - `APP_PASSWORD` — senha escolhida pelo usuário
  - `SESSION_SECRET` — string aleatória (sugerimos uma ao final do plano)

## 7. Não-objetivos (fora de escopo desta primeira versão)

- Múltiplos usuários / permissões.
- Integração automática com APIs de marketplace (import de vendas).
- App mobile nativo (o layout responsivo cobre uso no celular via navegador).
- Emissão de nota fiscal / integração contábil.

## 8. Testes

- Testes unitários (Vitest) para o motor de cálculo de custos (`lib/costing.ts`),
  cobrindo os casos validados contra a planilha.
- Testes de integração para as rotas de API críticas (products, sales,
  consignment) rodando contra um Postgres real local (mesmo provider da
  produção, evita bugs de divergência SQLite/Postgres): banco `tk3d_test` em
  uma instância PostgreSQL 16 local ao ambiente de desenvolvimento, resetado
  (`prisma migrate reset`) antes de cada rodada de testes.
- Ambiente de desenvolvimento usa banco local `tk3d_dev` (mesma instância
  Postgres local); produção usa o Postgres compartilhado do Coolify (schema
  `tk3d`) conforme seção 6. `DATABASE_URL` e `TEST_DATABASE_URL` ficam em
  `.env` (não versionado) e `.env.example` documenta o formato.
