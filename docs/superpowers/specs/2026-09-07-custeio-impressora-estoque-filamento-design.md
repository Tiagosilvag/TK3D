# Custeio automático de impressoras + Estoque de filamentos — Spec

**Data:** 2026-09-07
**Status:** Aprovado (decisões de escopo confirmadas pelo usuário)

## 1. Objetivo

Duas mudanças arquiteturais no sistema já em produção:

1. **Impressoras**: eliminar a digitação manual de custo de manutenção e do
   custo de depreciação R$/h. Ambos passam a ser 100% calculados a partir de
   preço de compra + configurações globais.
2. **Filamentos**: transformar o cadastro simples de filamento em um sistema
   de estoque por rolo, com cor, material, baixa automática de estoque na
   produção, e status visual de nível de estoque.

## 2. Impressoras — custeio automático

### 2.1 Settings (novos campos globais)
| Campo | Tipo | Default |
|---|---|---|
| `annualMaintenancePercent` | Decimal (0-1) | 0.10 |
| `annualUsageHours` | Decimal | 2000 |

### 2.2 Printer (schema)
Remove `maintenanceCost` (deixa de existir — manutenção não é mais digitada
por impressora). Campos que sobram para o usuário preencher: `name`,
`purchasePrice`, `depreciationHours`, `avgPowerConsumptionKwh`.

### 2.3 Fórmulas (todas em `lib/costing.ts`, puras, sem I/O)

```
depreciationCostPerHour = purchasePrice / depreciationHours
maintenanceCostPerHour  = (purchasePrice * settings.annualMaintenancePercent) / settings.annualUsageHours
electricityCostPerHour  = avgPowerConsumptionKwh * settings.energyCostPerKwh
totalCostPerHour        = depreciationCostPerHour + maintenanceCostPerHour + electricityCostPerHour
```

`calculateProductCost` ganha um campo novo no breakdown: `maintenanceCost`
(paralelo a `printerCost`/`electricityCost`), calculado como
`maintenanceCostPerHour * printTimeHours`. `subtotal` passa a somar também
esse campo. Isso muda a forma do `ProductCostBreakdown` — os testes
unitários da Task 3 original (que validavam a fórmula antiga, com
manutenção embutida no preço da impressora) ficam obsoletos e são
reescritos para a fórmula nova.

### 2.4 Validação / divisão por zero

`depreciationHours` e `settings.annualUsageHours` já são `.positive()` no
Zod (não aceitam zero/vazio) — a defesa contra divisão por zero já existe
na validação de entrada, não precisa de tratamento especial em tempo de
cálculo além de nunca deixar um desses campos chegar a zero no banco.

### 2.5 UI

- **Configurações**: dois campos novos (percentual de manutenção anual,
  horas de uso estimadas por ano).
- **Impressoras**: formulário perde o campo "Custo manutenção". A tabela
  mostra Nome, Preço, Vida útil, Depreciação R$/h, Consumo kWh/h, Energia
  R$/h, Manutenção R$/h, Custo total R$/h — todos calculados, nunca
  digitados. O formulário de cadastro recalcula uma prévia ao vivo
  (client-side, mesmas fórmulas) conforme o usuário digita preço/vida
  útil, usando os valores atuais de Settings buscados na carga da página.

## 3. Filamentos — estoque por rolo

### 3.1 Decisão de dados existentes

Os 7 filamentos atualmente cadastrados (sem cor, sem estoque, oriundos da
planilha) são apagados. A tabela é reconstruída do zero com o novo formato
— usuário recadastra pelo novo formulário.

### 3.2 Novos modelos

```prisma
enum FilamentMaterial {
  PLA
  PETG
  TPU
  OUTRO
}

model MaterialDefaults {
  material    FilamentMaterial @id
  diameterMm  Decimal @db.Decimal(4, 2)
  densityGCm3 Decimal @db.Decimal(5, 3)
  nozzleTempC Int
  bedTempC    Int
}

model Filament {
  id                String           @id @default(cuid())
  manufacturer      String
  material          FilamentMaterial
  colorName         String
  colorHex          String           // "#rrggbb", do seletor visual
  rollNumber        Int              // sequencial dentro de (manufacturer, material, colorName)
  spoolWeightKg     Decimal          @db.Decimal(6, 3)
  spoolPrice        Decimal          @db.Decimal(10, 2)
  initialStockGrams Decimal          @db.Decimal(10, 2) // snapshot: spoolWeightKg * 1000 na criação
  currentStockGrams Decimal          @db.Decimal(10, 2) // decrementado pela produção
  createdAt         DateTime         @default(now())
  updatedAt         DateTime         @updatedAt
  products          Product[]
  productionRuns    ProductionRun[]
}
```

Sem soft-delete (`active`) neste modelo — o ciclo de vida é: em estoque →
esgotado (`currentStockGrams` chega a 0, some da lista principal, aparece
em "Filamentos esgotados", histórico preservado). Remoção manual (rolo
cadastrado por engano) é uma exclusão física de verdade, com confirmação,
não um soft-delete.

`diameterMm`/`densityGCm3`/`nozzleTempC`/`bedTempC` saem do cadastro por
rolo — nunca foram usados em nenhum cálculo de custo, só eram metadado
informativo. Passam a ser uma tabela de defaults por material
(`MaterialDefaults`), editável em Configurações, consultada só para
exibição (ex: "temperatura recomendada" ao lado do filamento na tela de
produção), não usada em `lib/costing.ts`.

Seed inicial de `MaterialDefaults`: PLA (1.75mm, 1.24g/cm³, 210°C, 60°C),
PETG (1.75mm, 1.27g/cm³, 240°C, 80°C), TPU (1.75mm, 1.21g/cm³, 220°C,
50°C), OUTRO (1.75mm, 1.24g/cm³, 220°C, 60°C) — valores de referência
típicos de mercado, editáveis.

### 3.3 Fórmulas

```
pricePerKg   = spoolPrice / spoolWeightKg          (já existe, sem mudança)
pricePerGram = pricePerKg / 1000
initialStockGrams (na criação) = spoolWeightKg * 1000
currentStockGrams (a cada baixa) = currentStockGrams - (gramsUsed + gramsWasted)
percentRemaining = currentStockGrams / initialStockGrams * 100
```

Status (exibido com emoji, calculado a partir de `percentRemaining`):
- `percentRemaining > 30` → 🟢 Em estoque
- `10 <= percentRemaining <= 30` → 🟡 Estoque baixo
- `0 < percentRemaining < 10` → 🔴 Estoque crítico
- `percentRemaining == 0` (ou `currentStockGrams <= 0`) → ⚫ Esgotado

`rollNumber`: ao criar um rolo, conta quantos rolos já existem (incluindo
esgotados) com o mesmo `manufacturer` + `material` + `colorName` e usa
`count + 1`. Exibido como "Rolo #001", "#002" etc. no formato
`{manufacturer} {colorName} — Rolo #{rollNumber:03d}`.

### 3.4 Integração com Produção (`ProductionRun`)

Novo campo: `gramsUsed` (Decimal, peso de filamento que efetivamente virou
peça boa — distinto de `gramsWasted`, que já existe e representa
desperdício de falhas). Ao criar um registro de produção:

1. Validar que `gramsUsed + gramsWasted <= filament.currentStockGrams` no
   momento da criação — senão rejeitar com
   `Quantidade excede o estoque disponível (Xg)` (mesmo padrão já usado em
   `createConsignmentSaleReport`).
2. Em uma transação (`prisma.$transaction`): criar o `ProductionRun` E
   decrementar `Filament.currentStockGrams` em `gramsUsed + gramsWasted`.
3. Custo do filamento consumido nesta produção (informativo, exibido na
   listagem, não persistido): `gramsUsed * filament.pricePerGram`.

O select de filamento na tela de produção mostra rótulo com cor e estoque
restante (ex: "PLA Vermelho 3Dmax — Rolo #001 (620g restantes)"), cobrindo
a necessidade de "ver a cor ao escolher" sem precisar de um segundo campo
de cor redundante (o rolo já é uma cor fixa).

`Product.filamentId` continua apontando para um rolo específico (igual
hoje), usado apenas para a estimativa de custo do cadastro do produto —
quando um rolo esgota, o usuário edita manualmente os produtos que o
usavam para apontar para o rolo de reposição. Não há abstração automática
de "tipo de filamento" agrupando rolos — está fora de escopo.

### 3.5 UI da tela de Filamentos

- **Cadastro**: Marca/Fabricante, Material (select PLA/PETG/TPU/Outro),
  Cor (input `type="color"` + input de texto com o nome), Peso do rolo
  (kg), Preço pago. Preço/kg, preço/g e estoque inicial calculados e
  exibidos ao vivo, não digitados.
- **Lista principal** (só rolos com `currentStockGrams > 0`): tabela Cor
  (bolinha colorida) | Marca | Material | Estoque atual | % restante | R$/g
  | Status. Filtros por tabs/query param: Todas / PLA / PETG / TPU /
  Estoque baixo / Esgotados, mais um select de cor (lista de cores
  distintas presentes).
- **Seção "Filamentos esgotados"**: `<details>` colapsável (mesmo padrão
  já usado para "Mostrar inativos" nos outros catálogos), lista os rolos
  com `currentStockGrams <= 0`, histórico preservado, sem ação de reativar
  (esgotado é um estado real de estoque, não um soft-delete — reabastecer
  significa cadastrar um rolo novo, não reverter este).

## 4. Não-objetivos desta mudança

- Não reintroduzir soft-delete/reativação para Filament.
- Não criar uma abstração de "tipo de filamento" separada do rolo.
- Não alterar a fórmula de custo de filamento do Produto (`pricePerKg`
  continua igual); a mudança de Produção é sobre baixa de estoque e custo
  *daquela produção*, não sobre recalcular o custo estimado do Produto.
- Não adicionar manutenção por impressora (ficou global, por decisão do
  usuário) — pode virar um follow-up se um dia for necessário.
