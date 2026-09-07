# Plano: estoque de acessórios/insumos, ficha técnica, produção central

Spec: `docs/superpowers/specs/2026-09-07-refatoracao-estoque-ficha-tecnica-producao-design.md`

8 tasks, sequenciais (cada uma depende do schema/interface da anterior).
TDD em cada task. **Sem revisão por task** — só uma revisão final de todo
o branch depois da Task 8 (decisão explícita do usuário, para economizar
token). Cada implementador é responsável por auto-verificar
build/lint/test verdes antes de encerrar sua própria task, já que não
haverá um revisor a meio de caminho pra pegar erros cedo.

---

## Task 1 — Configurações: novos campos globais + costing.ts

**Arquivos:** `prisma/schema.prisma` (Settings + `RoundingMode` enum),
`lib/costing.ts`, `lib/validation/settings.ts`, `actions/settings.ts`,
`app/(app)/settings/{SettingsForm,page}.tsx`.

- Adicionar a `Settings` (migration aditiva, `prisma migrate dev`, não
  destrutiva): `desiredMarginPercent`, `defaultDiscountPercent`,
  `stockLowThresholdPercent` (default 0.30), `stockCriticalThresholdPercent`
  (default 0.10), 9 booleans `include*` (todos default `true`:
  `includeDepreciation`, `includeEnergyCost`, `includeMaintenance`,
  `includeLaborCost`, `includeFailureRate`, `includeFilamentCost`,
  `includeAccessoriesCost`, `includeSuppliesCost`, `includePackagingCost`),
  `roundingMode RoundingMode @default(NONE)` com enum `NONE|R90|R99|R00`.
  Ver spec §3 para o bloco Prisma exato.
- `lib/costing.ts`: nova função pura `applyRounding(value: number, mode:
  'NONE'|'R90'|'R99'|'R00'): number` — R90 arredonda pra baixo até o
  próximo `.90` (ex: 23.45→23.90, mas 23.95→23.90 também, ou seja trunca
  a parte inteira e fixa a fração em .90/.99/.00; decida a regra exata e
  documente com um comentário curto, cubra em teste unitário os 4 modos
  + valores já "redondos" + valores fracionários).
- `calculateProductCost` (mesma função de sempre) ganha os 9 flags
  `include*` no seu input — cada termo do breakdown continua sempre
  calculado, mas cada flag desativa a contribuição daquele termo pro
  `subtotal`/`total` (multiplicar o termo por `flag ? 1 : 0` antes de
  somar, não excluir do objeto retornado — a UI de breakdown precisa
  mostrar a linha mesmo desativada, só marcada visualmente).
- Settings UI: seção nova "Composição do custo" com 9 checkboxes,
  seção "Precificação" ganha margem desejada + desconto padrão, seção
  "Estoque" nova com os 2 limiares, seção "Arredondamento" com 4 radio/
  select. Todos os percentuais no formato amigável já usado no resto do
  app (input mostra "10", salva/lê como 0.10 — mesmo padrão dos campos
  existentes, reaproveitar o helper de conversão já usado).
- Testes: unitário pra `applyRounding` e pra `calculateProductCost` com
  cada flag desligada isoladamente (confirma que desligar só aquele termo
  zera só ele no total, resto intacto).
- Verificar: `npm run build`, `npm test`, `npm run lint` limpos antes de
  commitar.

---

## Task 2 — Acessórios → estoque

**Arquivos:** `prisma/schema.prisma` (`Accessory` reescrito +
`AccessoryPurchase` novo), `lib/validation/accessory.ts`,
`actions/accessories.ts`, `app/(app)/accessories/{page,AccessoryForm}.tsx`,
`tests/integration/accessories.test.ts`.

- Schema conforme spec §1.1. Migration: aditiva (`currentStock=0`,
  `avgUnitCost = unitCost` copiado do valor antigo, `colorName=''` pras
  linhas existentes), NÃO destrutiva — Accessory existente sobrevive.
  Depois de rodar a migration, o campo antigo `unitCost` é removido do
  schema (o valor já foi copiado pra `avgUnitCost`).
- `createAccessory(formData)`: cria o Accessory (nome+tipo+cor+cor hex) E
  a primeira `AccessoryPurchase` (quantidade+valor total) na mesma
  transação — cadastro = primeira compra, `currentStock`/`avgUnitCost`
  nascem dessa compra (`avgUnitCost = totalCost/quantity`,
  `currentStock = quantity`).
- `registerAccessoryPurchase(accessoryId, quantity, totalCost, date)`:
  cria nova `AccessoryPurchase`, recalcula `avgUnitCost = (currentStock*
  avgUnitCost + quantity*(totalCost/quantity)) / (currentStock+quantity)`
  = `(currentStock*avgUnitCost + totalCost) / (currentStock+quantity)`
  (forma mais simples, evita dividir e multiplicar à toa), incrementa
  `currentStock`. Validar quantity/totalCost positivos.
- `deleteAccessory(id)`: física, só permitida se não referenciado (deixe
  o erro de FK propagar, mesmo padrão já usado em `deleteFilament`).
- Status (função pura `getStockStatus`-like, reaproveitar a de
  `lib/costing.ts` se a assinatura servir, ou duplicar com limiares
  vindos de `Settings.stockLowThresholdPercent`/`stockCriticalThresholdPercent`
  em vez de hardcoded — NÃO reusar a versão fixa 30/10 do Filament sem
  parametrizar, ou os dois sistemas ficam acoplados incorretamente).
- UI: cadastro com preview ao vivo de custo unitário (totalCost/quantity)
  enquanto digita, lista principal (`currentStock > 0`) com círculo de
  cor, filtros (tipo, estoque baixo), seção "Acessórios esgotados"
  colapsável, cards de resumo (valor total em estoque = soma de
  `currentStock*avgUnitCost`, contagem de itens em cada status), tela/
  seção de histórico de compras por acessório.
- Testes: criar acessório = primeira compra; segunda compra recalcula
  média ponderada corretamente (hand-compute o valor esperado); mesma
  cor+nome+tipo não pode duplicar (unique constraint); cores diferentes
  = estoques independentes; não permite estoque negativo (se isso for
  testável nesta task — a baixa de fato acontece na Task 6, aqui só
  valide que não há caminho de escrita que subtraia além do saldo).
- Verificar green antes de commitar.

---

## Task 3 — Insumos → estoque

**Arquivos:** espelha a Task 2 para `Supply`/`SupplyPurchase`.

- Schema conforme spec §1.2 — adicionar `M`/`OUTRO` ao enum `SupplyUnit`
  existente (não remover `UN`/`ML`/`G`).
- Mesma lógica de `createSupply`=primeira compra,
  `registerSupplyPurchase`, custo médio ponderado, esgotados, status com
  os limiares globais de Settings.
- UI espelha Acessórios (sem cor, claro — Insumo não tem seletor de cor).
- Testes espelham Task 2.
- Verificar green antes de commitar.

---

## Task 4 — Ficha técnica: schema + costing.ts

**Arquivos:** `prisma/schema.prisma` (`ProductAccessoryUsage` novo,
remove `Product.accessoryId`, adiciona `suggestedPrice`/
`marketplacePrice`), `lib/costing.ts` (novos termos de custo), migration
de dados.

- Schema conforme spec §2. Migration em duas partes na mesma migration
  SQL: (1) criar `ProductAccessoryUsage`, (2) `INSERT INTO
  "ProductAccessoryUsage" (id, "productId", "accessoryId", quantity)
  SELECT gen_random_uuid()::text, id, "accessoryId", 1 FROM "Product"
  WHERE "accessoryId" IS NOT NULL` (ajuste a geração de id pro padrão
  cuid usado no resto do projeto se `gen_random_uuid()` não bater — cheque
  como outras migrations deste projeto geram ids em SQL puro, ou gere os
  ids em um script de migração de dados via Prisma Client em vez de SQL
  puro, o que for mais simples aqui), (3) `ALTER TABLE "Product" DROP
  COLUMN "accessoryId"`. Teste a migration contra o dev DB com produtos
  reais existentes antes de aplicar — confirme que nenhum produto perdeu
  seu acessório na conversão (`SELECT count(*) FROM
  "ProductAccessoryUsage"` deve bater com `SELECT count(*) FROM "Product"
  WHERE "accessoryId" IS NOT NULL` medido ANTES da migration).
- `lib/costing.ts`: `calculateProductCost` ganha termos `accessoriesCost`
  (soma de `quantity * accessory.avgUnitCost` por linha de
  `ProductAccessoryUsage`) e já existe `suppliesCost` (confirme que já
  soma certo, ou ajuste pra usar `avgUnitCost` em vez do antigo
  `unitCost` do Supply, já que esse campo mudou de nome/natureza na Task
  3). Aplique os flags `include*` da Task 1 aqui.
- Nova função pura `buildProductionCostSnapshot(product, printer,
  filament, settings, quantitySuccess, quantityFailed, gramsUsed,
  gramsWasted, ...)`: monta o objeto completo que vai virar
  `ProductionRun.costSnapshot` na Task 6 — inclui TODOS os componentes de
  custo (mesma forma do breakdown de `calculateProductCost`) mais a lista
  de recursos efetivamente consumidos (filamento em gramas, cada
  acessório/insumo/embalagem com id+quantidade+custo unitário no
  momento) — essa lista de consumo é o que a Task 6 vai usar tanto pra
  decrementar estoque quanto pra reverter no cancelamento, então inclua
  tudo que for necessário pra reverter sem precisar reconsultar a ficha
  técnica atual do produto (que pode ter mudado depois).
- Testes unitários pras novas fórmulas e pro snapshot builder.
- Verificar green antes de commitar.

---

## Task 5 — Produtos: UI da ficha técnica + simulação de preço

**Arquivos:** `app/(app)/products/{page,[id]/page,ProductForm,
CostBreakdown}.tsx`, `actions/products.ts`.

- `ProductForm.tsx`: seção de acessórios vira uma lista editável
  (adicionar/remover linhas acessório+quantidade), mesma UX já usada pra
  insumos (`ProductSupplyUsage` — reaproveitar o componente/padrão se
  já existir um "add row" reutilizável, senão espelhar a estrutura).
  Filamento e embalagem continuam como estão (sem mudança de UX).
- `CostBreakdown.tsx`: adicionar linha "Acessórios" (nova), marcar
  visualmente qualquer linha cujo `include*` correspondente esteja
  desligado em Settings (ex: texto acinzentado + "(desativado)").
- Nova seção "Simulação de preço": inputs temporários (client-side,
  `useState`, não persistem) pra markup/margem/desconto, recalcula
  `suggestedPrice`/`marketplacePrice` ao vivo usando esses valores em vez
  dos de Settings; botão "Aplicar preço calculado" chama uma nova action
  `applyProductPrice(productId, suggestedPrice, marketplacePrice)` que
  grava os 2 campos — só esse botão escreve no banco, a simulação em si é
  puramente visual.
- Sem simulação ativa, a tela mostra o preço sugerido calculado com os
  valores atuais de Settings (comportamento default, sem exigir simular).
- Testes: `applyProductPrice` grava certo; cálculo de accessoriesCost no
  breakdown bate com a soma esperada pra um produto com 2+ acessórios.
- Verificar green antes de commitar.

---

## Task 6 — Produção: schema + consumo transacional multi-recurso

**Arquivos:** `prisma/schema.prisma` (`ProductionRun` ganha `costSnapshot
Json`, `status`, `wasteReason`, `cancelReason`, `cancelDate` + enums
`ProductionStatus`/`WasteReason`), `actions/productionRuns.ts`,
`lib/validation/productionRun.ts`, `tests/integration/productionRuns.test.ts`.

Esta é a task de maior risco do plano (dinheiro real, transação
multi-tabela) — capriche na cobertura de teste.

- Schema conforme spec §5.4. Migration aditiva, `costSnapshot` sem
  default (novo campo obrigatório só pra runs novas — se `migrate dev`
  reclamar de linhas existentes, siga o mesmo padrão de migration
  backfill-safe já usado na Task 4 do plano anterior: default temporário
  tipo `'{}'::jsonb` só pra satisfazer NOT NULL em linhas antigas, ou
  torne o campo opcional pra histórico pré-existente — decida e
  documente, já que registros antigos genuinamente não têm esse dado).
- `createProductionRun`: antes da transação, monta a ficha técnica
  completa do produto (filamento + `ProductAccessoryUsage[]` +
  `ProductSupplyUsage[]` + embalagem), calcula a necessidade de cada
  recurso × `quantitySuccess` (acessórios/insumos/embalagem) — filamento
  continua usando `gramsUsed`/`gramsWasted` como já é hoje — e valida
  TODOS de uma vez contra o saldo atual. Se qualquer um faltar, retorna
  erro listando todos os itens insuficientes com quantidade faltante
  (formato: `"Nome (necessário X, disponível Y)"`, itens separados por
  `"; "`), sem escrever nada.
  Se tudo ok: monta `costSnapshot` via `buildProductionCostSnapshot`
  (Task 4) e roda uma `$transaction` com: criar `ProductionRun`
  (incluindo `costSnapshot`, `status` computado conforme spec §5.4),
  decrementar `Filament.currentStockGrams` (já existe), decrementar
  `currentStock` de cada Accessory/Supply/PackagingItem envolvido.
- `cancelProductionRun(id, reason)`: lê o `ProductionRun` (incluindo
  `costSnapshot`, que já tem a lista de recursos consumidos), roda uma
  `$transaction` com: `update` setando `status=CANCELADA`,
  `cancelReason`, `cancelDate`; reverter (incrementar de volta) o
  filamento e cada acessório/insumo/embalagem usando as quantidades
  gravadas no `costSnapshot` (não recalcular da ficha técnica atual do
  produto, que pode ter mudado). NÃO deleta a linha.
- Testes (espelhando o rigor da task de estoque de filamento anterior):
  produção com sucesso deduz filamento E acessórios E insumos
  corretamente; produção que excede QUALQUER recurso é rejeitada e NADA
  é alterado (nem `ProductionRun` criado, nem nenhum estoque tocado —
  teste isso pra pelo menos 2 recursos diferentes faltando ao mesmo
  tempo, confirma que a mensagem lista os dois); cancelamento restaura
  todos os recursos ao valor pré-produção e preserva a linha com
  `status=CANCELADA`; `status` computado corretamente nos 3 casos
  (sucesso total, com falhas, parcial).
- Verificar green antes de commitar.

---

## Task 7 — Produção: UI

**Arquivos:** `app/(app)/production/{page,ProductionRunForm}.tsx`.

- Formulário: campo de motivo de desperdício (`wasteReason`, select com
  os 8 valores do enum, opcional), sem mudança nos campos já existentes
  de quantidade/tempo/gramas (schema não mudou esses).
- Histórico: nova coluna "Status" (badge colorido por
  `ProductionStatus`), coluna "Custo" agora lê `costSnapshot.total` em
  vez de recalcular ao vivo (histórico fica congelado, conforme spec
  §4), botão "Cancelar" (com confirmação + campo de motivo) pra runs não
  canceladas, que chama `cancelProductionRun`.
- Verificar green antes de commitar.

---

## Task 8 — Dashboard e relatórios

**Arquivos:** `app/(app)/dashboard/page.tsx`, `lib/reports.ts` (novas
funções de agregação).

- Filtros (via `searchParams`, mesmo padrão de Link/tabs já usado em
  outras telas): período (data inicial/final), produto, impressora,
  status, motivo de desperdício.
- Cards: total de produções, unidades produzidas, taxa de sucesso, tempo
  total, custo total (soma de `costSnapshot.total` no período filtrado —
  não recalcular), desperdício total.
- Tabelas de detalhamento: produção por produto, falhas por motivo,
  impressoras mais usadas (contagem/horas).
- Reaproveitar o layout de cards do dashboard atual — não criar um
  sistema visual novo.
- Testes: funções de agregação em `lib/reports.ts` com dados
  conhecidos, cobrindo os filtros.
- Verificar green. Commit final desta task.

---

## Execution Handoff

Use `superpowers:subagent-driven-development`. Tasks 1→8 estritamente
sequenciais (cada uma consome schema/função da anterior). **Não dispare
revisão de task individual** — cada implementador só precisa deixar
build/test/lint verdes e commitar antes de passar pra próxima. Só depois
da Task 8 completa, gere um pacote de diff do branch inteiro (base = commit
antes desta Task 1, head = commit final da Task 8) e dispare UMA revisão
final cobrindo todo o escopo (consistência entre telas, segurança de
migration em produção não-vazia, fluxo ponta-a-ponta, spec completo) —
mesmo padrão da revisão final já feita no plano anterior. Se a revisão
final achar Critical/Important, resolva num único fix round consolidado
(não um round por achado) antes de considerar o plano pronto pra deploy.
