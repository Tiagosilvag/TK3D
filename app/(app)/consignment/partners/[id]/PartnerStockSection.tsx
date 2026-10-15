'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { formatCurrency } from '@/lib/format'
import type { ConsignmentProductBreakdown, ConsignmentSaleableDelivery, ConsignmentVariantBreakdown, VariantAttr } from '@/lib/reports'
import { deleteConsignmentDelivery, returnConsignmentDeliveryStock, undoConsignmentDeliveryReturn } from '@/actions/consignmentDeliveries'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'
import { RegisterSaleForm } from './RegisterSaleForm'

const VARIANT_TIER_RANK: Record<string, number> = { produto: 0, complemento: 1, acessorio: 2 }

// Melhoria "Modal do produto com o parceiro": título curto da variação
// (ex.: "Bolinha branca · Corpo lavanda") em vez do texto corrido de TODAS
// as peças -- escolhe as 2 peças que mais DIFERENCIAM as variações deste
// produto (maior nº de cores distintas entre elas), não sempre as 2
// primeiras. Produto com só 1-2 peças cadastradas usa todas (nada a
// escolher). Empate de diferenciação desempata por hierarquia (peça do
// produto antes de componente/acessório, mesma ordem de VariantAttr.tier).
function pickTitleAttrNames(allVariants: ConsignmentVariantBreakdown[]): string[] {
  const names = Array.from(new Set(allVariants.flatMap((v) => v.attrs.map((a) => a.name))))
  if (names.length <= 2) return names
  const allAttrs = allVariants.flatMap((v) => v.attrs)
  const scored = names.map((name) => {
    const distinctValues = new Set(allVariants.map((v) => v.attrs.find((a) => a.name === name)?.shortValue).filter(Boolean))
    const tier = allAttrs.find((a) => a.name === name)?.tier ?? 'complemento'
    return { name, distinctCount: distinctValues.size, tierRank: VARIANT_TIER_RANK[tier] ?? 1 }
  })
  scored.sort((a, b) => b.distinctCount - a.distinctCount || a.tierRank - b.tierRank)
  return scored.slice(0, 2).map((s) => s.name)
}

function variantTitle(variant: ConsignmentVariantBreakdown, titleAttrNames: string[]): string {
  if (variant.attrs.length === 0) return variant.label ?? 'Sem cor registrada'
  const parts = titleAttrNames
    .map((name) => variant.attrs.find((a) => a.name === name))
    .filter((a): a is VariantAttr => Boolean(a))
    .map((a) => `${a.name} ${a.shortValue}`)
  return parts.length > 0 ? parts.join(' · ') : (variant.label ?? 'Sem cor registrada')
}

// Pedido "primeiro as que ainda têm peça, depois as todas vendidas, por
// último as devolvidas": 3 estados mutuamente exclusivos, por ESTOQUE
// (remaining), não por ter sido alguma vez devolvida parcialmente -- uma
// variação com parte vendida e parte devolvida mas nada mais parado com o
// parceiro ainda conta como "Tudo vendido" (não sobrou nada a reaver).
function variantStatus(v: ConsignmentVariantBreakdown): { label: string; className: string } {
  if (v.remaining > 0) return { label: 'Ainda tem peça com ela', className: 'text-violet-600 dark:text-violet-400' }
  if (v.sold > 0) return { label: 'Tudo vendido ✓', className: 'text-emerald-600 dark:text-emerald-400' }
  return { label: 'Devolvida', className: 'text-slate-400 dark:text-slate-500' }
}

function sortVariantsByStatus(variants: ConsignmentVariantBreakdown[]): ConsignmentVariantBreakdown[] {
  const withStock = variants.filter((v) => v.remaining > 0)
  const soldOut = variants.filter((v) => v.remaining === 0 && v.sold > 0)
  const returnedOnly = variants.filter((v) => v.remaining === 0 && v.sold === 0)
  return [...withStock, ...soldOut, ...returnedOnly]
}

// Bolinhas de cor sobrepostas ao lado do título -- 1ª cor de cada uma das
// peças escolhidas pro título (não as cores do combo de 1 peça só, que é o
// que ChipDots normalmente recebe -- aqui são 2 peças DIFERENTES).
function TitleDots({ hexes }: { hexes: string[] }) {
  const [first, second] = hexes
  if (!first) return null
  return (
    <span className="flex shrink-0">
      <span className="inline-block h-3 w-3 rounded-full border border-black/10 dark:border-white/10" style={{ background: first }} />
      {second && (
        <span className="-ml-1 inline-block h-3 w-3 rounded-full border border-black/10 dark:border-white/10" style={{ background: second }} />
      )}
    </span>
  )
}

// Célula da grade de 4 colunas (1 por peça): 1 linha por cor do combo
// (peça multi-filamento, ex. "Cara" com 3 cores) -- nunca um texto corrido
// "Preto + Vermelho + Branco" só. `manufacturer` é por COR individual (não
// 1 só pro attr inteiro, que não faria sentido quando o combo tem marcas
// diferentes por componente).
function PieceColumnCell({ attr }: { attr: VariantAttr | undefined }) {
  if (!attr || attr.colors.length === 0) return <span className="text-xs text-slate-300 dark:text-slate-600">—</span>
  return (
    <div className="space-y-0.5">
      {attr.colors.map((c, i) => (
        <div key={i} className="flex items-center gap-1.5 text-xs">
          <span className="inline-block h-2 w-2 shrink-0 rounded-full border border-black/10 dark:border-white/10" style={{ background: c.hex ?? '#9CA3AF' }} />
          <span className="text-slate-700 dark:text-slate-200">{c.name}</span>
          {c.manufacturer && <span className="text-slate-400 dark:text-slate-500">· {c.manufacturer}</span>}
        </div>
      ))}
    </div>
  )
}

function TotalCard({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border px-3 py-2 text-center ${highlight ? 'border-violet-300 bg-violet-50 dark:border-violet-700 dark:bg-violet-500/10' : 'border-slate-200 dark:border-slate-700'}`}>
      <p className={`text-[10px] font-semibold uppercase tracking-wide ${highlight ? 'text-violet-600 dark:text-violet-400' : 'text-slate-400 dark:text-slate-500'}`}>{label}</p>
      <p className={`text-lg font-bold tabular-nums ${highlight ? 'text-violet-700 dark:text-violet-300' : 'text-slate-900 dark:text-slate-100'}`}>{value}</p>
    </div>
  )
}

const STOCK_FILTERS = [
  { key: 'todos', label: 'Todos' },
  { key: 'vendeu', label: 'Já vendeu' },
  { key: 'semvenda', label: 'Sem venda' },
  { key: 'acabou', label: 'Acabou com ela' },
] as const
type StockFilterKey = (typeof STOCK_FILTERS)[number]['key']

const TOP_PRODUCTS_LIMIT = 8

// Melhoria "Parceiros de consignação" §5: uma linha por PRODUTO (totais
// somados de todas as cores) -- clicar abre um modal com um bloco por cor,
// cada um com Entregue/Vendido/Com ela daquela cor específica e os chips de
// acessório que ela usa (link externo pra abrir o acessório na tela de
// Acessórios). Produto sem nenhuma cor conhecida (variants = [{key: null}])
// não ganha "(N cores)" nem chips -- só os totais, sem detalhe extra.
export function PartnerStockSection({
  products,
  saleableDeliveries,
  defaultCommissionPercent,
  partnerName,
}: {
  products: ConsignmentProductBreakdown[]
  saleableDeliveries: ConsignmentSaleableDelivery[]
  defaultCommissionPercent: number
  partnerName: string
}) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [selected, setSelected] = useState<ConsignmentProductBreakdown | null>(null)
  // Pedido "opção de devolver apenas 1 ou tudo": o campo de quantidade é
  // não-controlado (defaultValue), então o botão "(tudo)" precisa de uma
  // referência direta ao <input> daquela entrega pra escrever nele -- um Map
  // por deliveryId em vez de 1 ref por linha, já que a lista é dinâmica.
  const quantityInputRefs = useRef<Map<string, HTMLInputElement>>(new Map())
  const [filter, setFilter] = useState<StockFilterKey>('todos')
  const [showAll, setShowAll] = useState(false)

  // Melhoria "Tabela mais enxuta": ordenada por lucro já realizado (quem
  // mais rendeu até agora, não projeção do que está parado) -- mostra só os
  // 8 primeiros por padrão, com "Ver todos os N produtos" pra expandir.
  // Filtro em chips reaplica a cada mudança (nunca junto com "Ver todos" --
  // trocar de filtro volta a mostrar só o top 8 daquele filtro).
  const sortedProducts = useMemo(() => [...products].sort((a, b) => b.soldProfit - a.soldProfit), [products])
  const filteredProducts = useMemo(() => {
    switch (filter) {
      case 'vendeu': return sortedProducts.filter((p) => p.sold > 0)
      case 'semvenda': return sortedProducts.filter((p) => p.sold === 0)
      case 'acabou': return sortedProducts.filter((p) => p.remaining === 0 && p.delivered > 0)
      default: return sortedProducts
    }
  }, [sortedProducts, filter])
  const visibleProducts = showAll ? filteredProducts : filteredProducts.slice(0, TOP_PRODUCTS_LIMIT)

  function handleFilterChange(key: StockFilterKey) {
    setFilter(key)
    setShowAll(false)
  }

  const totals = useMemo(() => filteredProducts.reduce(
    (acc, p) => ({
      sold: acc.sold + p.sold,
      delivered: acc.delivered + p.delivered,
      remaining: acc.remaining + p.remaining,
      soldValue: acc.soldValue + p.soldValue,
      soldProfit: acc.soldProfit + p.soldProfit,
      remainingValue: acc.remainingValue + p.remainingValue,
    }),
    { sold: 0, delivered: 0, remaining: 0, soldValue: 0, soldProfit: 0, remainingValue: 0 },
  ), [filteredProducts])

  // Melhoria "Modal do produto com o parceiro §4": "Ver movimentos" por
  // variação é um disclosure independente por cartão (não um só aberto por
  // vez, ao contrário de editingKey/historyKey de VariantsModal) -- faz
  // sentido comparar o histórico de 2 variações lado a lado.
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())

  function openDetail(product: ConsignmentProductBreakdown) {
    setSelected(product)
    setExpandedKeys(new Set())
    dialogRef.current?.showModal()
  }

  function toggleExpanded(key: string) {
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Título curto ("Bolinha branca · Corpo lavanda") calculado 1x por
  // produto aberto -- compara TODAS as variações pra achar quais 2 peças
  // mais diferenciam (ver pickTitleAttrNames acima), nunca por variação
  // isolada (não dá pra saber o que "diferencia" olhando só 1 linha).
  const titleAttrNames = useMemo(() => (selected ? pickTitleAttrNames(selected.variants) : []), [selected])
  const sortedVariants = useMemo(() => (selected ? sortVariantsByStatus(selected.variants.filter((v) => v.delivered > 0)) : []), [selected])
  // União dos nomes de peça entre TODAS as variações (mesma técnica de
  // VariantsModal#pieceColumns) -- colunas fixas da grade, mesmo quando uma
  // variação específica não tem valor pra alguma delas (PieceColumnCell
  // mostra "—").
  const pieceColumns = useMemo(() => (selected ? Array.from(new Set(selected.variants.flatMap((v) => v.attrs.map((a) => a.name)))) : []), [selected])

  // Melhoria "editar tudo no consignado": devolver peças ao próprio estoque
  // e remover entrega agem na entrega específica (id), não no agregado por
  // produto/cor -- depois de um sucesso, refresh() traz o `selected` já
  // recalculado (mesma re-sincronização que DeliveriesExplorer já faz).
  async function handleReturnStock(deliveryId: string, formData: FormData) {
    const result = await returnConsignmentDeliveryStock(deliveryId, formData)
    if (!result.success) {
      alert(result.error)
      return
    }
    router.refresh()
  }

  async function handleRemoveDelivery(deliveryId: string) {
    const result = await deleteConsignmentDelivery(deliveryId)
    if (result.success) router.refresh()
    return result
  }

  // Pedido "quero a opção de desfazer também uma devolução, se marcou
  // errado -- mas somente qnd ele fica devolvido": zera returnedQuantity,
  // trazendo a entrega de volta ao estado normal (com o parceiro de novo).
  // Sem confirmação (ação reversível, ao contrário de Remover) -- mesma
  // ausência de confirm() que "Devolver" já tinha.
  async function handleUndoReturn(deliveryId: string) {
    const result = await undoConsignmentDeliveryReturn(deliveryId)
    if (!result.success) {
      alert(result.error)
      return
    }
    router.refresh()
  }

  // Bug fix (mesmo de DeliveriesExplorer): `selected` é um snapshot tirado
  // em openDetail(). router.refresh() atualiza a prop `products`, mas
  // `selected` nunca era re-sincronizado sozinho -- devolução/remoção
  // pareciam não ter feito nada até fechar e reabrir a modal.
  useEffect(() => {
    setSelected((prev) => (prev ? (products.find((p) => p.productId === prev.productId) ?? null) : prev))
  }, [products])

  useEffect(() => {
    if (selected === null && dialogRef.current?.open) dialogRef.current.close()
  }, [selected])

  if (products.length === 0) {
    return (
      <div className="tk-panel p-4">
        <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Estoque com o parceiro</h2>
        <p className="mt-2 text-sm text-slate-400 dark:text-slate-500">Nenhuma entrega registrada ainda.</p>
      </div>
    )
  }

  return (
    <div className="tk-panel p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Estoque com o parceiro</h2>
          <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">Ordenado por quem mais rendeu. Clique em um produto pra ver como o lucro é calculado e o detalhe por cor.</p>
        </div>
        <RegisterSaleForm deliveries={saleableDeliveries} defaultCommissionPercent={defaultCommissionPercent} />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {STOCK_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => handleFilterChange(f.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              filter === f.key
                ? 'bg-violet-600 text-white'
                : 'border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            {f.label}{f.key === 'todos' ? ` ${products.length}` : ` ${sortedProducts.filter((p) => (f.key === 'vendeu' ? p.sold > 0 : f.key === 'semvenda' ? p.sold === 0 : p.remaining === 0 && p.delivered > 0)).length}`}
          </button>
        ))}
      </div>

      {filteredProducts.length === 0 ? (
        <p className="mt-4 py-4 text-center text-sm text-slate-400 dark:text-slate-500">Nenhum produto nesse filtro.</p>
      ) : (
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="tk-table-head-row">
              <th className="py-2">Produto</th>
              <th>Vendidas</th>
              <th className="text-center">Com ela</th>
              <th className="text-right">Preço un.</th>
              <th className="text-right">Vendido</th>
              <th className="text-right">Meu lucro</th>
              <th className="text-right">Parado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visibleProducts.map((p) => {
              const colorCount = p.variants.filter((v) => v.key).length
              const soldShare = p.delivered > 0 ? Math.min(100, (p.sold / p.delivered) * 100) : 0
              return (
                <tr key={p.productId} onClick={() => openDetail(p)} className="tk-row cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60">
                  <td className="py-2 font-medium text-slate-900 dark:text-slate-100">
                    {p.productName}
                    {colorCount > 1 && <span className="ml-1.5 text-xs font-normal text-slate-400 dark:text-slate-500">({colorCount} cores)</span>}
                  </td>
                  <td className="min-w-[7rem]">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                      <div className="h-full bg-emerald-500" style={{ width: `${soldShare}%` }} />
                    </div>
                    <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{p.sold} de {p.delivered} entregues</p>
                  </td>
                  <td className={`text-center tabular-nums ${p.remaining === 0 && p.delivered > 0 ? 'font-semibold text-amber-600 dark:text-amber-400' : ''}`}>{p.remaining}</td>
                  <td className="text-right tabular-nums">{formatCurrency(p.unitPrice)}</td>
                  <td className="text-right tabular-nums">{formatCurrency(p.soldValue)}</td>
                  <td className="text-right tabular-nums font-medium text-emerald-600 dark:text-emerald-400">{formatCurrency(p.soldProfit)}</td>
                  <td className="text-right tabular-nums">{formatCurrency(p.remainingValue)}</td>
                  <td className="pl-1 text-right text-slate-400" aria-hidden>›</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 text-xs font-medium text-slate-500 dark:border-slate-700 dark:text-slate-400">
              <td className="py-2">Total · {filteredProducts.length} produtos</td>
              <td>{totals.sold} de {totals.delivered}</td>
              <td className="text-center tabular-nums">{totals.remaining}</td>
              <td></td>
              <td className="text-right tabular-nums">{formatCurrency(totals.soldValue)}</td>
              <td className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">{formatCurrency(totals.soldProfit)}</td>
              <td className="text-right tabular-nums">{formatCurrency(totals.remainingValue)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      )}

      {!showAll && filteredProducts.length > TOP_PRODUCTS_LIMIT && (
        <button type="button" onClick={() => setShowAll(true)} className="mt-2 w-full text-center text-xs font-medium text-violet-600 hover:underline dark:text-violet-400">
          Ver todos os {filteredProducts.length} produtos ▾
        </button>
      )}

      <dialog
        ref={dialogRef}
        onClose={() => setSelected(null)}
        className="w-full [--tk-dialog-cap:32rem] rounded-xl border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        {selected && (
          <div className="grid grid-cols-1 gap-3 p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-semibold">{selected.productName}</h3>
              <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Fechar" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                ✕
              </button>
            </div>

            {/* Melhoria "Modal do produto com o parceiro §1": 4 totais do
                produto inteiro (todas as variações somadas) -- "Devolvido"
                é um estado PRÓPRIO, não só "o que falta pra fechar a conta
                de Entregue/Vendido" (por isso `returned` precisou virar
                campo explícito em ConsignmentProductBreakdown, não só um
                acumulador interno descartado depois de calcular `remaining`). */}
            <div className="grid grid-cols-4 gap-2">
              <TotalCard label="Entregue" value={selected.delivered} />
              <TotalCard label="Vendido" value={selected.sold} />
              <TotalCard label="Com ela agora" value={selected.remaining} highlight />
              <TotalCard label="Devolvido" value={selected.returned} />
            </div>

            {/* Melhoria "Como o lucro é calculado — por peça": usa o preço da
                entrega mais RECENTE deste produto (selected.unitPrice) e a
                comissão padrão do parceiro -- é uma explicação "ao preço de
                hoje", não a soma exata do que cada venda passada rendeu de
                fato (selected.soldProfit, mostrado na tabela/rodapé, usa o
                preço/comissão REAIS de cada venda already registrada --
                pode divergir um pouco daqui se o preço mudou entre entregas,
                mesma lógica da frase-resumo abaixo). */}
            <div className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Como o lucro é calculado — por peça</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-md bg-slate-100 px-2 py-1 tabular-nums dark:bg-slate-800">Preço de venda {formatCurrency(selected.unitPrice)}</span>
                <span className="text-slate-400 dark:text-slate-500">−</span>
                <span className="rounded-md bg-slate-100 px-2 py-1 tabular-nums dark:bg-slate-800">Comissão da {partnerName} ({(defaultCommissionPercent * 100).toFixed(0)}%) {formatCurrency(selected.commissionPerUnit)}</span>
                <span className="text-slate-400 dark:text-slate-500">−</span>
                <span className="rounded-md bg-slate-100 px-2 py-1 tabular-nums dark:bg-slate-800">Custo de produção {formatCurrency(selected.unitCost)}</span>
                <span className="text-slate-400 dark:text-slate-500">=</span>
                <span className="rounded-md bg-emerald-50 px-2 py-1 font-medium tabular-nums text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
                  Lucro por peça {formatCurrency(selected.profitPerUnit)} ({selected.unitPrice > 0 ? ((selected.profitPerUnit / selected.unitPrice) * 100).toFixed(1) : '0'}%)
                </span>
              </div>
              {/* Bug "1 paradas" / pedido "corrigir a pluralização": nunca
                  concatena "N " + palavra fixa -- cada frase escolhe
                  singular/plural pelo valor de N, igual ao resto do app
                  (ver ex. "variaç{ão/ões}" em VariantsModal.tsx). */}
              {selected.sold > 0 && (
                <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
                  Já ganhei: <span className="font-medium">{formatCurrency(selected.sold * selected.profitPerUnit)}</span> ({selected.sold} {selected.sold === 1 ? 'vendida' : 'vendidas'} × {formatCurrency(selected.profitPerUnit)})
                </p>
              )}
              {selected.remaining > 0 && (
                <p className="mt-1 text-xs text-violet-700 dark:text-violet-400">
                  Ainda pode render: <span className="font-medium">{formatCurrency(selected.remainingProfitPotential)}</span> ({selected.remaining} {selected.remaining === 1 ? 'peça' : 'peças'} com ela)
                </p>
              )}
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Variações ({sortedVariants.length}) · com peça primeiro, esgotadas e devolvidas no fim
              </p>
              <div className="space-y-3">
                {sortedVariants.map((v) => {
                  const key = v.key ?? '__none__'
                  const status = variantStatus(v)
                  const titleDotHexes = titleAttrNames
                    .map((name) => v.attrs.find((a) => a.name === name)?.colorHexes[0])
                    .filter((h): h is string => Boolean(h))
                  const soldShare = v.delivered > 0 ? Math.min(100, (v.sold / v.delivered) * 100) : 0
                  const expanded = expandedKeys.has(key)
                  return (
                    <div key={key} className={`rounded-lg border p-3 ${status.label === 'Devolvida' ? 'border-slate-200 opacity-70 dark:border-slate-800' : 'border-slate-200 dark:border-slate-700'}`}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <span className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                            <TitleDots hexes={titleDotHexes} />
                            {variantTitle(v, titleAttrNames)}
                          </span>
                          <p className={`mt-0.5 text-xs font-medium ${status.className}`}>{status.label}</p>
                        </div>
                        <div className="flex shrink-0 gap-1.5">
                          <div className="rounded-md border border-slate-200 px-2 py-1 text-center dark:border-slate-700">
                            <p className="text-[9px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Entregue</p>
                            <p className="text-sm font-semibold tabular-nums">{v.delivered}</p>
                          </div>
                          <div className="rounded-md border border-slate-200 px-2 py-1 text-center dark:border-slate-700">
                            <p className="text-[9px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Vendido</p>
                            <p className="text-sm font-semibold tabular-nums">{v.sold}</p>
                          </div>
                          <div className={`rounded-md px-2 py-1 text-center ${v.remaining > 0 ? 'bg-violet-100 dark:bg-violet-500/20' : 'border border-slate-200 dark:border-slate-700'}`}>
                            <p className={`text-[9px] uppercase tracking-wide ${v.remaining > 0 ? 'text-violet-600 dark:text-violet-400' : 'text-slate-400 dark:text-slate-500'}`}>Com ela</p>
                            <p className={`text-sm font-semibold tabular-nums ${v.remaining > 0 ? 'text-violet-700 dark:text-violet-300' : ''}`}>{v.remaining}</p>
                          </div>
                        </div>
                      </div>

                      {v.attrs.length > 0 && (
                        <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-slate-100 pt-2.5 dark:border-slate-800 sm:grid-cols-4">
                          {pieceColumns.map((name) => (
                            <div key={name}>
                              <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{name}</p>
                              <div className="mt-0.5"><PieceColumnCell attr={v.attrs.find((a) => a.name === name)} /></div>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="mt-2.5">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                          <div className="h-full bg-emerald-500" style={{ width: `${soldShare}%` }} />
                        </div>
                        <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{v.sold} de {v.delivered} vendidas</p>
                      </div>

                      <button
                        type="button"
                        onClick={() => toggleExpanded(key)}
                        className="mt-2 text-xs font-medium text-violet-600 hover:underline dark:text-violet-400"
                      >
                        Ver movimentos ({v.deliveries.length}) {expanded ? '▲' : '▼'}
                      </button>

                      {expanded && (
                        <>
                          {/* Melhoria "editar tudo no consignado" (revisão "a mesma lógica de
                              produção"): ação por ENTREGA específica (não dá pra devolver/
                              remover o agregado por cor -- ele pode vir de vários lotes com
                              datas diferentes). Uma entrega cujo saldo chegou a 0 POR DEVOLUÇÃO
                              (não por ter sido tudo vendido) vira "Devolvida" -- mesmo
                              tratamento de uma ProductionRun CANCELADA: continua visível com
                              os números originais (nunca reescritos), badge marca o estado,
                              "Desfazer" volta a ficar com o parceiro (zera returnedQuantity),
                              "Remover" apaga em definitivo (só aí some da tela). */}
                          <div className="mt-2 space-y-1.5 border-t border-slate-100 pt-2 dark:border-slate-800">
                            {v.deliveries.map((d) => {
                              const isReturned = d.remaining === 0 && d.returnedQuantity > 0
                              return (
                                <div key={d.deliveryId} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                  <span className="flex flex-wrap items-center gap-1.5 text-slate-400 dark:text-slate-500">
                                    {new Date(d.deliveryDate).toLocaleDateString('pt-BR')} · entregue {d.delivered}
                                    {d.sold > 0 && ` · vendido ${d.sold}`}
                                    {isReturned && (
                                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                        Devolvida
                                      </span>
                                    )}
                                  </span>
                                  <div className="flex items-center gap-2">
                                    {isReturned && (
                                      <button
                                        type="button"
                                        onClick={() => handleUndoReturn(d.deliveryId)}
                                        className="font-medium text-violet-600 hover:underline dark:text-violet-400"
                                      >
                                        Desfazer
                                      </button>
                                    )}
                                    {!isReturned && d.remaining > 0 && (
                                      <form action={(fd) => handleReturnStock(d.deliveryId, fd)} className="flex items-center gap-1">
                                        <input
                                          ref={(el) => {
                                            if (el) quantityInputRefs.current.set(d.deliveryId, el)
                                            else quantityInputRefs.current.delete(d.deliveryId)
                                          }}
                                          type="number"
                                          name="quantityReturned"
                                          step="1"
                                          min={1}
                                          max={d.remaining}
                                          // Pedido "se tem 2, quero a opção de devolver apenas 1 ou
                                          // tudo": default 1 (maioria das devoluções é unitária,
                                          // mesmo raciocínio do default de quantidade em Registrar
                                          // venda) -- "(tudo)" abaixo preenche o saldo inteiro com 1
                                          // clique quando for o caso.
                                          defaultValue={Math.min(1, d.remaining)}
                                          className="tk-input w-14 text-right"
                                        />
                                        <button type="submit" className="font-medium text-violet-600 hover:underline dark:text-violet-400">
                                          Devolver
                                        </button>
                                        {d.remaining > 1 && (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              const input = quantityInputRefs.current.get(d.deliveryId)
                                              if (input) input.value = String(d.remaining)
                                            }}
                                            className="text-slate-400 hover:text-violet-600 dark:text-slate-500 dark:hover:text-violet-400"
                                          >
                                            (tudo)
                                          </button>
                                        )}
                                      </form>
                                    )}
                                    <ConfirmDeleteForm
                                      action={() => handleRemoveDelivery(d.deliveryId)}
                                      label="Remover"
                                      className="font-medium text-red-600 hover:underline dark:text-red-400"
                                      confirmMessage={
                                        d.saleReportsCount > 0
                                          ? `Remover esta entrega? Isso também apaga ${d.saleReportsCount} relatório(s) de venda já registrado(s) contra ela.`
                                          : 'Remover esta entrega?'
                                      }
                                    />
                                  </div>
                                </div>
                              )
                            })}
                          </div>

                          {v.accessories.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {v.accessories.map((a) => (
                                <Link
                                  key={a.id}
                                  href={`/accessories?editId=${a.id}`}
                                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:border-violet-400 hover:text-violet-700 dark:border-slate-700 dark:text-slate-300 dark:hover:border-violet-500 dark:hover:text-violet-400"
                                >
                                  {a.colorHex && <span style={{ background: a.colorHex }} className="inline-block h-2 w-2 shrink-0 rounded-full" />}
                                  {a.name}{a.colorName && ` - ${a.colorName}`}
                                  <span aria-hidden>↗</span>
                                </Link>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="mt-1 flex justify-end">
              <button type="button" onClick={() => dialogRef.current?.close()} className="text-sm text-slate-500 hover:underline dark:text-slate-400">
                Fechar
              </button>
            </div>
          </div>
        )}
      </dialog>
    </div>
  )
}
