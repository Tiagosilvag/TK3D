# TK3D — Controle de Produção 3D

Next.js 15 (App Router) + Prisma/PostgreSQL. Aplicação interna de uma
operação de impressão 3D: custos, produção, estoque, vendas e
consignação. Login único (senha compartilhada, sem multiusuário).
Deploy em produção: `tk3d.coffetech.com.br` via Coolify.

## Stack e convenções

- **Server Components + Server Actions** (`'use server'`) — quase toda
  escrita passa por `actions/*.ts`, chamadas via `<form action={fn}>`.
  Pouquíssimo client JS; quando precisa (estado de formulário, modal),
  vira Client Component (`'use client'`) o mínimo possível.
- **Zod** em `lib/validation/*.ts`, um schema por domínio.
- **Prisma**: sem banco vivo neste sandbox de desenvolvimento —
  `prisma migrate dev` não funciona aqui. Todo schema change exige (1)
  editar `prisma/schema.prisma` e (2) escrever a migration SQL à mão em
  `prisma/migrations/<timestamp>_nome/migration.sql`, seguindo o estilo
  das migrations existentes (nomes de tabela/enum em PascalCase, sem
  `@@map` exceto `accessory_types`). `npx prisma validate` e `generate`
  funcionam com um `DATABASE_URL` fake (não precisam de conexão real).
- **Sem dependências novas** por padrão: modais usam `<dialog>` nativo
  (`components/AdjustStockButton.tsx`, `DeletePrinterButton.tsx`),
  dropdowns usam `<details>/<summary>` nativo
  (`components/ActionsMenu.tsx`). Zero libs de UI.
- **Custo histórico congelado**: `ProductionRun.costSnapshot` e
  `Sale.costSnapshot` (ambos `Json?`) são calculados uma vez na criação
  e nunca recalculados — mudar Settings/Printer/Filament depois nunca
  altera o custo de um registro já criado. `null` só em linhas antigas
  (pré-coluna); UI mostra "—" ou recalcula ao vivo só nesse caso
  ("estimated"), nunca inventa dado retroativo.
- **Estoque derivado, não contador redundante**: várias telas (Meu
  Estoque, Montagem, ajuste de estoque, Pedidos) calculam quantidade na
  hora a partir das tabelas transacionais em vez de manter um contador
  paralelo, pra não ter duas fontes de verdade divergindo.
- **Padrão `?editId=`**: toda tela de catálogo (impressoras, filamentos,
  acessórios, insumos, embalagens, produtos, vendas, produção) usa esse
  query param pra alternar entre formulário de criação e edição —
  consistente em todo o app.
- **Produção → Montagem → Estoque**: `lib/products.ts#productNeedsAssembly`
  decide se um produto precisa passar por `/assembly` antes de virar
  estoque de produto acabado -- verdadeiro se composto OU se tem qualquer
  insumo/acessório cadastrado; só "peça única, sem nenhum componente" vai
  direto de Produção pro estoque (`Produção → Estoque`). Pra todo o resto,
  `createProductionRun` não decrementa insumo/acessório na hora (fica pra
  `confirmAssembly`), e `getOwnStockSummary` só conta "produzido" depois
  da montagem confirmada (`ProductAssembly`, nunca direto de
  `ProductionRun`).
- **`ActionResult`**: `type ActionResult = { success: boolean; error?: string }`
  redefinido localmente em cada `actions/*.ts` (não é um tipo
  compartilhado) — todo action segue esse contrato.

## Modelo de domínio (prisma/schema.prisma)

- **Settings** (linha única, `id=1`): custos genéricos (energia, mão de
  obra, taxa de falha, markup, taxas de marketplace genéricas — usadas
  como fallback/preview antes de existir plataforma específica), limiares
  de estoque baixo/crítico, flags de composição de custo,
  `roundingMode`.
- **Printer, Filament, PackagingItem, Accessory(+Purchase),
  Supply(+Purchase)**: catálogo de insumos, todos com soft delete
  (`active`) exceto Sale/ProductionRun/ConsignmentSaleReport (log
  transacional, delete físico). Accessory/Supply usam custo médio
  ponderado (`calculateWeightedAverageCost`), recalculado a cada compra.
  `AccessoryTypeRecord` é uma tabela própria (não enum) com CRUD em
  `/settings/accessory-types`.
- **Product**: pode ser `isComposite` (produto montado a partir de
  peças) ou simples (1 impressora/filamento/peso/tempo direto). Composto
  tem `ProductPart[]` (cada peça com sua própria
  impressora/tempo/quantidade-por-unidade) e `ProductAssembly[]` (ledger
  de conversão peça produzida → estoque de produto acabado, tela
  `/assembly`).
- **ProductPart / ProductPartFilament**: uma peça pode precisar de MAIS
  DE UM filamento simultaneamente (impressão multi-material -- ex.:
  corpo preto 15g + detalhe verde 8g); cada componente da receita é uma
  linha em `ProductPartFilament` (filamentId + weightGrams). Peça de
  exatamente 1 componente tem "cor variável" (pode mudar de um lote de
  produção pro outro); peça com 2+ componentes é uma receita FIXA (as
  mesmas cores sempre juntas, sem variação).
- **ProductionRun**: registra uma produção (de um Product simples OU de
  um `ProductPart` específico via `productPartId`), com
  planejado/sucesso/falhas, desperdício, `costSnapshot`. Quando a peça
  produzida tem >1 componente de filamento, o consumo real de cada cor
  fica em `ProductionRunFilamentUsage` (opcional) -- os campos escalares
  `filamentId`/`gramsUsed`/`gramsWasted` continuam preenchidos (1º
  componente / soma total) pra compatibilidade com telas/relatórios que
  só leem o campo escalar. Editar desperdício depois de criada só
  funciona pra peça de 1 filamento (updateProductionRun recusa pra
  multi-filamento -- não dá pra saber qual cor mudou).
- **ProductAssembly.colorChoices** (Json?, opcional): pra cada peça
  consumida numa leva de montagem, qual COMBO de filamento foi escolhido
  -- `{ [productPartId]: comboKey }`, onde `comboKey` é 1+ filamentIds
  ordenados e unidos por vírgula (`actions/assembly.ts#AssemblyPartColorOption`).
  Disponível por combo é calculado a partir do que cada lote de produção
  REALMENTE usou (`ProductionRunFilamentUsage` quando a peça é
  multi-filamento, senão só o `ProductionRun.filamentId` escalar) --
  nunca da contagem de componentes na ficha técnica atual, porque ela
  pode ter mudado desde então e a combinação de cores de uma peça
  multi-filamento pode variar de lote pra lote (não é necessariamente
  fixa, ex.: TAMPA marrom+rosa num lote, roxo+lavanda no seguinte) --
  usado por `getAssemblyStatus`/`confirmAssembly` (actions/assembly.ts)
  pra calcular disponível POR COMBO de cada peça, e por
  `getProductVariantBreakdown` (lib/reports.ts) pra mostrar em /stock
  quanto já foi montado de cada combinação de cores. Pra peça de 1
  filamento só, `comboKey` é literalmente o filamentId sozinho -- dado
  gravado antes desse ajuste (ou antes do ajuste anterior de cor
  variável) continua lendo certo sem migração. Nulo em montagens
  anteriores a qualquer um desses ajustes -- nunca inventado
  retroativamente. Sale/ConsignmentDelivery NÃO diferenciam variante
  (fora do escopo atual), então só "produzido por variante" é confiável,
  nunca "disponível por variante". `confirmAssembly` também decrementa
  `Accessory.currentStock`/`Supply.currentStock` a partir de uma lista
  editável enviada pelo formulário (pré-preenchida da ficha técnica do
  produto, mas ajustável só pra aquela leva -- nunca reescreve a ficha
  técnica cadastrada).
- **Sale**: canal (`SaleChannel`: `DIRETA | SHOPEE | MERCADO_LIVRE`,
  mais `MARKETPLACE` só como valor legado — não oferecido em vendas
  novas desde 3.6), `costSnapshot`.
- **MarketplacePlatform**: 1 linha fixa por plataforma
  (`SHOPEE`/`MERCADO_LIVRE`, `MarketplacePlatformKind`) com
  `feePercent`/`feeFixed`/`avgFreight` configuráveis em
  `/settings/marketplace-platforms` — alimenta o prefill de preço
  sugerido ao registrar venda por essa plataforma
  (`getPlatformSalePrice`).
- **Order**: pedido recebido antes de produzir/despachar
  (`OrderChannel`: `DIRETA | SHOPEE | MERCADO_LIVRE`), com `OrderStatus`
  progressivo. Ao marcar `CONCLUIDO` cria automaticamente 1 `Sale`
  vinculada (nunca duas).
- **ConsignmentPartner, ConsignmentDelivery, ConsignmentSaleReport**:
  consignação — entrega a um parceiro, depois relatórios de venda
  parcial ao longo do tempo (saldo = entregue − Σ vendido).
- **StockAdjustment**: log polimórfico (`resourceType` + `resourceId`
  string, sem FK física) de ajustes manuais de estoque com motivo
  obrigatório, usado por Filament/Accessory/Supply/Product via
  `components/AdjustStockButton.tsx`.

## Módulos da aplicação (app/(app)/)

Dashboard · Impressoras · Filamentos · Acessórios · Insumos · Embalagens
· Produtos (+ ficha técnica/custo em `/products/[id]`) · Produção ·
Meu Estoque (`/stock`) · Montagem (`/assembly`) · Vendas · Pedidos
(`/orders`) · Consignação (parceiros/entregas/relatórios) ·
Configurações (+ tipos de acessório, + plataformas de marketplace).

## Custeio (lib/costing.ts)

`calculateProductCost` (produto simples) e `calculateCompositeProductCost`
(produto composto, soma `ProductPart[]` via `sumProductPartsCost`) convergem
em `combineProductCost`, que aplica os flags de composição de custo e
calcula `suggestedPrice`/`marketplacePrice`. `calculatePlatformPrice`
(extraída pra ser reutilizável) gera preço a partir de fee%/fee fixo —
usada tanto pelo cálculo genérico (Settings) quanto pelo específico por
plataforma (`MarketplacePlatform`). `applyRounding` aplica o
`RoundingMode` só no preço final, nunca nos termos do breakdown.

## Deploy

Ver `README.md` para detalhes completos. Resumo:
- Coolify aponta pra branch `main` do repo `Tiagosilvag/TK3D`, build
  pack Docker Compose.
- Ao subir o container: `prisma migrate deploy` → seed idempotente
  (upsert) → `node server.js`. Migration falhou = container não sobe.
- **Nunca commitar/dar deploy direto na branch de trabalho** — o fluxo é
  desenvolver em `claude/caveman-rtk-only-1zkisn` (ou a branch de sessão
  ativa), e só mesclar em `main` + acionar deploy (`mcp__Coolify__deploy`,
  uuid da app `0gm6qi07yczzysnrxsnq5aik`) quando o usuário pedir
  explicitamente ("disparar o deploy"). Verificar sempre com
  `mcp__Coolify__list_database_backups` se há backup antes de aplicar
  uma migration arriscada; migrations aditivas (novo enum value, nova
  tabela) são baixo risco mesmo sem backup visível.

## Verificação antes de cada commit

1. `DATABASE_URL="x" npx tsc --noEmit` (ignorar os 2 erros pré-existentes
   em `tests/integration/accessories.test.ts`, não relacionados a
   nenhuma mudança feita nesta sessão).
2. `npm run lint`
3. `npx vitest run tests/unit` (testes unitários puros — os de
   `tests/integration/` precisam de banco vivo, não rodam aqui).
4. `DATABASE_URL="postgresql://user:pass@localhost:5432/db" npm run build`
   (o valor de `DATABASE_URL` é só pra passar a checagem do Prisma
   client no build; não conecta de verdade).
