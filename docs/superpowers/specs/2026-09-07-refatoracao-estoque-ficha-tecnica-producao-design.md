# Refatoração: estoque de acessórios/insumos, ficha técnica, produção central — Spec

**Data:** 2026-09-07
**Origem:** `Prompt_resumido_para_ajuste_da_aplicação_TK3D.md`
**Status:** rascunho único (sem rodada de perguntas — decisões de projeto documentadas abaixo, ajuste-as se algo não bater com a intenção)

## 0. Estado atual (o que já existe e será reaproveitado)

- `Settings` já tem: `energyCostPerKwh`, `laborCostPerHour`, `failureRatePercent`,
  `marketplaceFeePercent`, `marketplaceFixedFee`, `taxPercent`, `defaultMarkup`,
  `annualMaintenancePercent`, `annualUsageHours`. Faltam: margem desejada,
  desconto padrão, limiares de estoque, toggles de composição de custo,
  arredondamento.
- `Filament` já é um sistema de estoque por rolo completo (Task anterior) —
  serve de **padrão de referência** para Acessórios/Insumos, mas não será
  copiado 1:1 (ver §1, modelo mais simples de "estoque + histórico de
  compras" em vez de "lotes individuais selecionáveis").
- `Accessory`/`Supply` hoje são catálogos simples (nome/tipo/custo unitário
  digitado à mão, sem estoque). `Supply` já tem `ProductSupplyUsage` (join
  table produto↔insumo com quantidade) — esse padrão será estendido para
  Accessory também.
- `Product` já tem: impressora, filamento+peso, packaging opcional (FK
  única — já é "nenhuma ou uma", bate com o pedido), 1 acessório (FK única,
  vira lista), insumos via `ProductSupplyUsage` (já é lista, reaproveitar).
- `ProductionRun` já tem: quantidades planejada/sucesso/falha, gramas
  usadas/desperdiçadas do filamento (com baixa transacional de estoque —
  Task anterior), tempo desperdiçado. Falta: baixa de acessórios/insumos,
  status, motivo de desperdício, cancelamento com estorno, snapshot de
  custo histórico.
- Custo hoje é **sempre recalculado ao vivo** a partir de Settings/Printer/
  Filament atuais — não há snapshot. Isso viola a regra nova "alterar
  configuração não pode mudar custo histórico" e é o único ponto
  realmente arquitetural desta mudança (ver §4).

## 1. Acessórios e Insumos — modelo de estoque

Diferente do Filament (onde o usuário escolhe explicitamente qual rolo
consumir), aqui a intenção do prompt é mais simples: **estoque corrente +
custo médio ponderado + histórico de compras**, sem o usuário escolher lote
na produção — o sistema decrementa do saldo atual e usa o custo médio
vigente automaticamente.

### 1.1 Accessory (schema)

```prisma
model Accessory {
  id            String        @id @default(cuid())
  name          String
  type          AccessoryType
  colorName     String        @default("") // "" = sem cor / genérico
  colorHex      String?
  currentStock  Decimal       @db.Decimal(10, 2) // sempre em unidades
  avgUnitCost   Decimal       @db.Decimal(10, 4) // custo médio ponderado, recalculado a cada compra
  active        Boolean       @default(true)
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt
  purchases     AccessoryPurchase[]
  usages        ProductAccessoryUsage[]

  @@unique([name, type, colorName])
}

model AccessoryPurchase {
  id          String    @id @default(cuid())
  accessoryId String
  accessory   Accessory @relation(fields: [accessoryId], references: [id])
  quantity    Decimal   @db.Decimal(10, 2)
  totalCost   Decimal   @db.Decimal(10, 2)
  purchaseDate DateTime
  notes       String?
  createdAt   DateTime  @default(now())
}
```

- Cadastro de um Accessory NOVO = a primeira compra (nome+tipo+cor+
  quantidade+valor total) — não existe "criar sem estoque".
- "Repor estoque" = criar uma nova `AccessoryPurchase` para um Accessory
  já existente: `newAvgCost = (currentStock*avgUnitCost + qty*unitCost) /
  (currentStock+qty)`, `currentStock += qty`.
- Mesmo nome+tipo em cores diferentes = linhas de `Accessory` distintas,
  estoques independentes (`@@unique([name, type, colorName])`).
- Nunca estoque negativo — decremento sempre validado antes (mesma
  garantia que Filament já tem).
- Esgotado (`currentStock <= 0`) não é excluído — some da lista principal,
  aparece em "Acessórios esgotados", histórico de compras preservado.
- Status usa os NOVOS limiares globais de Settings (§3), não o threshold
  fixo 30%/10% do Filament — são sistemas de estoque diferentes,
  configuráveis independentemente. O Filament **não muda** (evitar
  regressão em algo já testado e em produção).

### 1.2 Supply (schema)

```prisma
enum SupplyUnit {
  UN
  ML
  G
  M      // novo: metro
  OUTRO  // novo
}

model Supply {
  id           String     @id @default(cuid())
  name         String     @unique
  unit         SupplyUnit
  currentStock Decimal    @db.Decimal(10, 3)
  avgUnitCost  Decimal    @db.Decimal(10, 4) // custo médio por unidade de medida cadastrada
  active       Boolean    @default(true)
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt
  purchases    SupplyPurchase[]
  usages       ProductSupplyUsage[]
}

model SupplyPurchase {
  id          String   @id @default(cuid())
  supplyId    String
  supply      Supply   @relation(fields: [supplyId], references: [id])
  quantity    Decimal  @db.Decimal(10, 3)
  totalCost   Decimal  @db.Decimal(10, 2)
  purchaseDate DateTime
  notes       String?
  createdAt   DateTime @default(now())
}
```

Mesma lógica de custo médio ponderado, mesmo padrão esgotado/histórico.
`unitCost` (campo antigo, digitado à mão) desaparece — substituído por
`avgUnitCost`, sempre calculado.

### 1.3 Migração de dados existentes

Não é um reset destrutivo (diferente do Filament). `Accessory`/`Supply`
existentes ganham colunas novas via migration aditiva:
- `currentStock = 0`, `avgUnitCost = unitCost` (preserva o valor atual
  como custo médio inicial), `colorName = ''` para Accessory.
- Uma migration de dados cria, para cada linha existente com `unitCost`
  preenchido, opcionalmente **não** cria uma `AccessoryPurchase`/
  `SupplyPurchase` retroativa (não há dado de quantidade/data de compra
  real para inventar) — o histórico de compras começa vazio a partir de
  agora; o estoque atual começa em 0 e o usuário registra a primeira
  reposição real para popular o saldo. Isso é consistente com "não há
  dado de estoque hoje" (mesma decisão já tomada para Filament).

## 2. Produto → ficha técnica (schema)

- Filamento: **sem mudança** (`filamentId`+`weightGrams` já é exatamente
  "1 filamento + cor (inerente ao rolo) + gramas").
- Embalagem: **sem mudança** (`packagingItemId?` já é "nenhuma ou uma").
- Insumos: **sem mudança de schema** (`ProductSupplyUsage` já é a lista
  produto↔insumo com quantidade respeitando a unidade).
- Acessórios: generalizar a FK única `accessoryId?` em uma lista, mesmo
  padrão de `ProductSupplyUsage`:

```prisma
model ProductAccessoryUsage {
  id          String    @id @default(cuid())
  productId   String
  product     Product   @relation(fields: [productId], references: [id], onDelete: Cascade)
  accessoryId String
  accessory   Accessory @relation(fields: [accessoryId], references: [id])
  quantity    Decimal   @db.Decimal(10, 2)

  @@unique([productId, accessoryId])
}
```

Migração de dados: para cada `Product` com `accessoryId` não-nulo, criar
uma `ProductAccessoryUsage(quantity: 1)` correspondente, depois remover a
coluna `accessoryId` de `Product`.

- Preço: `Product` ganha dois campos calculados-mas-persistidos, só
  gravados por ação explícita do usuário (nunca calculados
  automaticamente em background):

```prisma
  suggestedPrice   Decimal? @db.Decimal(10, 2)
  marketplacePrice Decimal? @db.Decimal(10, 2)
```

  A tela sempre mostra uma prévia calculada ao vivo (markup/margem
  vigentes de Settings); o botão "Aplicar preço calculado" grava esses
  dois campos. Uma **simulação** (inputs temporários de markup/margem/
  desconto só nessa tela, client-side) mostra o preço resultante sem
  gravar nada até confirmação — mesmo botão "Aplicar".

## 3. Configurações — novos campos globais

```prisma
model Settings {
  // ...existentes sem mudança...
  desiredMarginPercent        Decimal @default(0.30) @db.Decimal(5, 4)
  defaultDiscountPercent      Decimal @default(0)     @db.Decimal(5, 4)
  stockLowThresholdPercent    Decimal @default(0.30)  @db.Decimal(5, 4) // acessórios/insumos
  stockCriticalThresholdPercent Decimal @default(0.10) @db.Decimal(5, 4)
  includeDepreciation  Boolean @default(true)
  includeEnergyCost    Boolean @default(true)
  includeMaintenance   Boolean @default(true)
  includeLaborCost     Boolean @default(true)
  includeFailureRate   Boolean @default(true)
  includeFilamentCost  Boolean @default(true)
  includeAccessoriesCost Boolean @default(true)
  includeSuppliesCost  Boolean @default(true)
  includePackagingCost Boolean @default(true)
  roundingMode RoundingMode @default(NONE)
}

enum RoundingMode {
  NONE
  R90 // termina em ,90
  R99 // termina em ,99
  R00 // termina em ,00
}
```

`calculateProductCost` passa a aceitar os 9 flags `include*` (todas
vindas de Settings) — cada linha do breakdown continua sempre calculada e
exibida (transparência), mas uma linha desativada não entra no
`subtotal`/`total` (UI marca visualmente como "desativado"). `applyRounding
(value, mode)` (função pura nova em `lib/costing.ts`) só é aplicada ao
preço sugerido/marketplace final, nunca aos componentes de custo.

Todos os percentuais são armazenados como fração (0-1) e exibidos como
"5%", "10%" etc — já é o padrão existente no app, sem mudança de
convenção.

## 4. Custo histórico (a mudança arquitetural real desta spec)

Hoje todo custo é recalculado ao vivo a partir de Settings/Printer/
Filament **atuais**. Isso quebra a regra explícita: "alterar uma
configuração global não pode modificar custos históricos de produções ou
vendas já registradas."

Decisão: `ProductionRun` ganha um campo `costSnapshot Json`, calculado e
gravado **uma única vez**, no momento da criação da produção, usando os
valores de Printer/Filament/Settings/Product vigentes naquele instante.
Toda exibição de custo de uma produção já registrada (histórico, tabela
de produção, relatórios, dashboard) lê `costSnapshot` — nunca recalcula.
Uma produção nova sempre recalcula e grava um snapshot novo. Alterar
Settings depois não toca em nenhum `costSnapshot` já gravado — a garantia
vem de nunca reescrever esse campo, não de lógica condicional.

`Sale` não ganha snapshot nesta spec — `unitPrice` já é o preço real de
venda digitado pelo usuário, não um custo calculado; análise de
lucro-por-venda cruzando `costSnapshot` da produção mais próxima é um
possível follow-up, fora de escopo aqui (ver §7).

## 5. Produção — consumo multi-recurso e ciclo de vida

### 5.1 O que é consumido e quando

- Filamento: **sem mudança** — já usa `gramsUsed`/`gramsWasted` cobrindo
  sucesso+falha (Task anterior).
- Acessórios/Insumos/Embalagem: consumidos apenas pelas unidades **com
  sucesso** (`quantitySuccess`) — não faz sentido gastar embalagem/
  acessório em uma peça que falhou antes de chegar no pós-processamento.
  Consumo = `ficha técnica da unidade × quantitySuccess`.

### 5.2 Verificação de estoque (pré-transação)

Antes de qualquer escrita: para cada recurso da ficha técnica (acessórios,
insumos, embalagem — 1 unidade se houver), calcular a quantidade
necessária e comparar com o saldo atual. Se qualquer um for insuficiente,
**bloquear tudo** (nenhuma escrita parcial) e retornar uma mensagem
listando cada item faltante e a quantidade que falta, ex: `"Estoque
insuficiente: Argola Dourada (necessário 10, disponível 6); Cola Quente
(necessário 20ml, disponível 15ml)"`.

### 5.3 Transação

Uma única `prisma.$transaction([...])`: criar `ProductionRun` (com
`costSnapshot` já calculado) + decrementar `Filament.currentStockGrams`
(já existe) + decrementar `currentStock` de cada `Accessory`/`Supply`/
`PackagingItem` envolvido. Tudo ou nada — mesma garantia que já existe
para filamento, estendida aos outros recursos.

### 5.4 Falhas e desperdício

`ProductionRun` ganha:
```prisma
  wasteReason WasteReason?
  status      ProductionStatus @default(CONCLUIDA)
  cancelReason String?
  cancelDate   DateTime?

enum WasteReason {
  FALHA_IMPRESSAO
  ERRO_CONFIGURACAO
  SUPORTE_EXCESSIVO
  QUEBRA
  TESTE
  PURGA
  TROCA_FILAMENTO
  OUTRO
}

enum ProductionStatus {
  CONCLUIDA
  PARCIAL
  COM_FALHAS
  CANCELADA
}
```

`wasteReason` classifica o desperdício da produção como um todo (1 motivo
principal por registro — um ledger de múltiplos eventos de desperdício
por produção é possível follow-up, fora de escopo, ver §7).

`status` computado na criação: `CANCELADA` só via ação de cancelamento;
senão `COM_FALHAS` se `quantityFailed > 0`; senão `PARCIAL` se
`quantitySuccess < quantityPlanned`; senão `CONCLUIDA`.

### 5.5 Cancelamento

Nova ação `cancelProductionRun(id, reason)`: transação que estorna
filamento (mesma lógica já existente de restaurar estoque, reaproveitar),
estorna acessórios/insumos/embalagem consumidos, seta `status=CANCELADA`,
`cancelReason`, `cancelDate`. **Não** apaga a linha (histórico
preservado, `quantityFailed`/`gramsWasted` etc continuam visíveis como
registro do que aconteceu).

## 6. Dashboard e relatórios

Uma tela com: filtros (período, produto, impressora, status,
wasteReason) + cards de indicadores (produções, unidades produzidas,
taxa de sucesso, tempo total, custo total — somando `costSnapshot`s no
período filtrado, desperdício total) + 2-3 tabelas de detalhamento
(produção por produto, falhas por motivo, impressoras mais usadas).
Reaproveita o layout de cards/filtros já usado no dashboard atual
(`app/(app)/dashboard/page.tsx`) — não inventar um padrão visual novo.

## 7. Não-objetivos desta mudança

- Não criar ledger de múltiplos eventos de desperdício por produção (1
  `wasteReason` por registro é suficiente para o pedido).
- Não mudar os limiares de estoque do Filament (continuam fixos 30%/10%,
  já testados) — os novos limiares configuráveis valem só para
  Acessórios/Insumos.
- Não criar `costSnapshot` para `Sale` nem análise de lucro-por-venda
  cruzando produção↔venda.
- Não criar lotes/rolos selecionáveis para Acessório/Insumo (modelo é
  saldo corrente + custo médio, não lotes individuais como Filament).
- Não retroalimentar `AccessoryPurchase`/`SupplyPurchase` para dados já
  existentes (histórico de compras começa vazio, estoque atual começa
  em 0 até a primeira reposição real).
