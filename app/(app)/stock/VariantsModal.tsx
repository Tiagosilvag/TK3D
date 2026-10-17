'use client'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { isOutsideDialogClick } from '@/lib/dialog'
import { ChipDots, TitlePieceDots } from '@/components/VariantChip'
import type { StockRow } from './StockExplorer'
import { EditVariantColorsForm } from './EditVariantColorsForm'
import { fetchProductUnitTrail, type ProductUnitTrailResult } from '@/actions/productTracking'
import { UnitTrailDrawer, type DrawerTarget } from './UnitTrailDrawer'

type LocationType = 'estoque' | 'devolvida' | 'parceiro' | 'vendida'
type VariantRow = ProductUnitTrailResult['variantRows'][number]
type PlaceGroupT = ProductUnitTrailResult['placeGroups'][number]
type PlaceGroupRowT = PlaceGroupT['rows'][number]

function zeroOrDash(n: number): string {
  return n === 0 ? '–' : String(n)
}

function partnerCellText(row: VariantRow): string {
  if (row.withPartners.length === 0) return '–'
  return row.withPartners.map((p) => `${p.quantity} · ${p.partnerName}`).join(', ')
}

const LOCATION_CARDS: { type: LocationType; label: string; accent: string }[] = [
  { type: 'estoque', label: 'Em estoque', accent: 'blue' },
  { type: 'parceiro', label: 'Com parceiro', accent: 'amber' },
  { type: 'vendida', label: 'Vendidas', accent: 'emerald' },
  { type: 'devolvida', label: 'Devolvidas', accent: 'slate' },
]

const ACCENT_CLASSES: Record<string, { border: string; text: string; bg: string }> = {
  blue: { border: 'border-sky-300 dark:border-sky-700', text: 'text-sky-600 dark:text-sky-400', bg: 'bg-sky-50 dark:bg-sky-500/10' },
  amber: { border: 'border-amber-300 dark:border-amber-700', text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-500/10' },
  emerald: { border: 'border-emerald-300 dark:border-emerald-700', text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-500/10' },
  slate: { border: 'border-slate-300 dark:border-slate-600', text: 'text-slate-500 dark:text-slate-400', bg: 'bg-slate-50 dark:bg-slate-800/40' },
}

// Pedido "barra empilhada proporcional no lugar das N bolinhas": 1 bloco
// por lugar, largura % do total montado -- substitui a faixa de 1
// quadradinho por UNIDADE física (ilegível com 20+ montadas).
const BAR_SEGMENT_CLASS: Record<LocationType, string> = {
  estoque: 'bg-sky-400',
  parceiro: 'bg-amber-400',
  vendida: 'bg-emerald-400',
  devolvida: 'bg-slate-400',
}

const LINK_BADGE_CLASS: Record<LocationType, string> = {
  estoque: '',
  parceiro: 'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-500/20 dark:text-amber-300 dark:hover:bg-amber-500/30',
  vendida: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-300 dark:hover:bg-emerald-500/30',
  devolvida: '',
}

const HISTORY_KIND_CLASS: Record<string, string> = {
  Produzido: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
  Montado: 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300',
  Entregue: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  Vendido: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  Devolvido: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
}

function locationValue(trail: ProductUnitTrailResult, type: LocationType): number {
  if (type === 'estoque') return trail.locationCounts.inStock
  if (type === 'parceiro') return trail.locationCounts.withPartners.reduce((s, p) => s + p.quantity, 0)
  if (type === 'vendida') return trail.locationCounts.sold
  return trail.locationCounts.returned
}

function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

// Pedido "1 linha por grupo = mesma variação + mesmo destino + mesma
// entrega/venda, nunca 1 cartão por unidade": com 18 em estoque isso é a
// diferença entre 18 cartões idênticos e 1 linha com "×18". "Ver N ▾"
// (ou "Detalhes ▾" pra grupo de 1 unidade só) expande os chips #1 #2…
// (rastreável até a unidade física) + a composição completa (todas as
// peças, não só as 2 do título).
function PlaceGroupRowCard({ place, row, onOpenDrawer }: { place: LocationType; row: PlaceGroupRowT; onOpenDrawer: (target: DrawerTarget) => void }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className={`rounded-lg border p-2.5 ${row.reserved ? 'border-amber-300 bg-amber-50/40 dark:border-amber-700 dark:bg-amber-500/5' : 'border-slate-200 dark:border-slate-700'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-400 dark:text-slate-500">×{row.quantity}</span>
          <TitlePieceDots pieces={row.titlePieces} />
          <span className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{row.shortTitle}</span>
          {row.reserved && (
            <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
              Reservada
            </span>
          )}
        </div>
        {row.link && row.linkLabel && (
          <button
            type="button"
            onClick={() => onOpenDrawer(row.link!)}
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${LINK_BADGE_CLASS[place]}`}
          >
            {row.linkLabel} ↗
          </button>
        )}
      </div>
      <p className="mt-1 truncate text-xs text-slate-400 dark:text-slate-500">{row.statusLine}</p>
      <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-1 text-xs font-medium text-violet-600 hover:underline dark:text-violet-400">
        {row.quantity === 1 ? (expanded ? 'Ocultar ▴' : 'Detalhes ▾') : (expanded ? 'Ocultar ▴' : `Ver ${row.quantity} ▾`)}
      </button>
      {expanded && (
        <div className="mt-1.5 rounded-lg bg-slate-50 p-2 dark:bg-slate-800/40">
          <div className="flex flex-wrap gap-1">
            {row.unitNs.map((n) => (
              <span key={n} className="rounded-full border border-slate-300 px-1.5 py-0.5 text-[11px] text-slate-500 dark:border-slate-600 dark:text-slate-400">#{n}</span>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{row.fullComposition}</p>
        </div>
      )}
    </div>
  )
}

export function VariantsModal({ product, onClose }: { product: StockRow | null; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [trail, setTrail] = useState<ProductUnitTrailResult | null | undefined>(undefined)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [locationFilter, setLocationFilter] = useState<LocationType | null>(null)
  const [variantFilter, setVariantFilter] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'units' | 'history'>('units')
  const [partsOpen, setPartsOpen] = useState(false)
  const [drawerStack, setDrawerStack] = useState<DrawerTarget[]>([])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (product) {
      if (!dialog.open) dialog.showModal()
    } else if (dialog.open) {
      dialog.close()
    }
  }, [product])

  useEffect(() => {
    setEditingKey(null)
    setLocationFilter(null)
    setVariantFilter(null)
    setActiveTab('units')
    setPartsOpen(false)
    setDrawerStack([])
    setTrail(undefined)
    if (!product) return
    let cancelled = false
    fetchProductUnitTrail(product.productId).then((r) => { if (!cancelled) setTrail(r) })
    return () => { cancelled = true }
  }, [product])

  // Bug "cada card vira 1 linha por UNIDADE (21 pra 21 montadas)": os
  // grupos já vêm prontos do servidor (placeGroups, ver lib/
  // productUnitTrail.ts) -- 1 linha por (variação + destino + entrega/
  // venda), não por unidade física. O filtro de local/variante só decide
  // quais SEÇÕES/linhas aparecem, nunca recria o agrupamento no client.
  const visiblePlaceGroups = useMemo(() => {
    if (!trail) return []
    return trail.placeGroups
      .filter((g) => !locationFilter || g.place === locationFilter)
      .map((g) => ({ ...g, rows: g.rows.filter((r) => !variantFilter || r.comboKey === variantFilter) }))
      .filter((g) => g.rows.length > 0)
  }, [trail, locationFilter, variantFilter])

  function toggleLocationFilter(type: LocationType) {
    setLocationFilter((prev) => (prev === type ? null : type))
  }
  function toggleVariantFilter(comboKey: string) {
    setVariantFilter((prev) => (prev === comboKey ? null : comboKey))
  }

  const drawerTarget = drawerStack[drawerStack.length - 1] ?? null
  const partsWithLeftover = trail?.parts.filter((p) => p.available > 0) ?? []

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(e) => { if (isOutsideDialogClick(e)) onClose() }}
      className="w-full [--tk-dialog-cap:1000px] rounded-xl border border-slate-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-950/60 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
    >
      {product && (
        // Bug "a tela inteira rola junto com o cabeçalho": cabeçalho fixo
        // (shrink-0, fora do scroll), só o corpo rola -- min-h-0 no filho
        // flex é obrigatório aqui, senão o flex item ignora max-height do
        // pai e cresce livre em vez de ganhar scroll interno (gotcha
        // clássico de flexbox).
        <div className="flex max-h-[90vh] flex-col">
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Estoque · Variações</p>
              <h3 className="font-display text-base font-semibold">{product.productName}</h3>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {product.category} · {product.isComposite ? 'Composto' : 'Peça única'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            >
              ✕
            </button>
          </div>

          {trail === undefined && <p className="px-5 py-10 text-center text-sm text-slate-400 dark:text-slate-500">Carregando rastreio…</p>}
          {trail === null && <p className="px-5 py-10 text-center text-sm text-slate-400 dark:text-slate-500">Não foi possível carregar o rastreio deste produto.</p>}

          {trail && (
            <div className="relative min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Onde estão as {trail.totalCreated} {trail.needsAssembly ? 'montadas' : 'produzidas'}
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {LOCATION_CARDS.map((card) => {
                  const value = locationValue(trail, card.type)
                  const accent = ACCENT_CLASSES[card.accent]
                  const active = locationFilter === card.type
                  const partners = card.type === 'parceiro' ? trail.locationCounts.withPartners : []
                  return (
                    <button
                      key={card.type}
                      type="button"
                      onClick={() => toggleLocationFilter(card.type)}
                      className={`rounded-lg border px-3 py-2 text-left transition-colors ${active ? `${accent.border} ${accent.bg}` : 'border-slate-200 dark:border-slate-700'}`}
                    >
                      <p className={`text-[10px] font-semibold uppercase tracking-wide ${accent.text}`}>{card.label}</p>
                      <p className="text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100">{value}</p>
                      {partners.length > 0 && (
                        <p className="truncate text-xs text-slate-500 dark:text-slate-400">{partners.map((p) => p.partnerName).join(', ')}</p>
                      )}
                    </button>
                  )
                })}
              </div>

              {trail.totalCreated > 0 && (
                <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  {LOCATION_CARDS.map((card) => {
                    const value = locationValue(trail, card.type)
                    if (value === 0) return null
                    return <span key={card.type} className={BAR_SEGMENT_CLASS[card.type]} style={{ width: `${(value / trail.totalCreated) * 100}%` }} />
                  })}
                </div>
              )}

              {/* Bug "Faltam 0 unidade(s)": reconciliationOk/reconciliationNote
                  já vêm resolvidos do servidor (lib/productUnitTrail.ts) --
                  só ✓ quando a igualdade bate de verdade, nunca "Faltam 0". */}
              <p className={`mt-2 text-xs ${trail.reconciliationOk ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                {trail.reconciliationOk
                  ? `✓ ${locationValue(trail, 'estoque')} + ${locationValue(trail, 'parceiro')} + ${locationValue(trail, 'vendida')} + ${locationValue(trail, 'devolvida')} = ${trail.totalCreated} · bate com o ${trail.needsAssembly ? 'montado' : 'produzido'}`
                  : `⚠ ${trail.reconciliationNote}`}
              </p>

              {trail.parts.length > 0 && (
                <div className="mt-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                      {partsWithLeftover.length > 0
                        ? `Sobraram ${partsWithLeftover.map((p) => `${p.available} ${p.available === 1 ? p.name.toLowerCase() : `${p.name.toLowerCase()}s`}`).join(', ')} prontas p/ montar`
                        : 'Nenhuma peça sobrando pronta p/ montar'}
                    </p>
                    <button type="button" onClick={() => setPartsOpen((v) => !v)} className="shrink-0 text-xs font-medium text-violet-600 hover:underline dark:text-violet-400">
                      Peças do lote {partsOpen ? '▴' : '▾'}
                    </button>
                  </div>
                  {partsOpen && (
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {trail.parts.map((p) => (
                        <div key={p.name} className="rounded-lg bg-slate-50 p-2 text-center dark:bg-slate-800/40">
                          <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{p.name}</p>
                          <p className="text-xs tabular-nums text-slate-700 dark:text-slate-300">{p.produced} → {p.consumed} → {p.available}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Variações ({trail.variantRows.length})</p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="tk-table-head-row">
                      <th className="py-2">Variação</th>
                      <th className="text-center">Estoque</th>
                      <th className="text-center">Com parceiro</th>
                      <th className="text-center">Vendidas</th>
                      <th className="text-center">Total</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {trail.variantRows.map((row) => (
                      <Fragment key={row.comboKey}>
                        <tr
                          onClick={() => toggleVariantFilter(row.comboKey)}
                          className={`tk-row cursor-pointer ${variantFilter === row.comboKey ? 'bg-violet-50 dark:bg-violet-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'}`}
                        >
                          <td className="max-w-0 py-2">
                            <span className="flex items-center gap-2">
                              <TitlePieceDots pieces={row.titlePieces} size="h-3 w-3" />
                              {row.titlePieces.length === 0 && <ChipDots hexes={row.colorHexes} size="h-3 w-3" />}
                              <span className="truncate">{row.shortTitle}</span>
                            </span>
                          </td>
                          <td className="text-center tabular-nums">{zeroOrDash(row.inStock)}</td>
                          <td className="text-center tabular-nums text-amber-700 dark:text-amber-400">{partnerCellText(row)}</td>
                          <td className="text-center tabular-nums text-emerald-700 dark:text-emerald-400">{zeroOrDash(row.sold)}</td>
                          <td className="text-center font-medium tabular-nums">{row.total}</td>
                          <td className="text-right">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setEditingKey(editingKey === row.comboKey ? null : row.comboKey) }}
                              className="text-xs font-medium text-violet-600 hover:underline dark:text-violet-400"
                            >
                              Editar
                            </button>
                          </td>
                        </tr>
                        {editingKey === row.comboKey && (
                          <tr className="bg-slate-50 dark:bg-slate-800/40">
                            <td colSpan={6} className="px-2">
                              <EditVariantColorsForm
                                productId={product.productId}
                                comboKey={row.comboKey}
                                maxUnits={row.inStock + row.withPartners.reduce((s, p) => s + p.quantity, 0) + row.sold}
                                onCancel={() => setEditingKey(null)}
                                onSaved={onClose}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex flex-nowrap items-center gap-4 border-b border-slate-200 text-sm dark:border-slate-800">
                <button type="button" onClick={() => setActiveTab('units')} className={`shrink-0 whitespace-nowrap border-b-2 px-1 pb-2 font-medium ${activeTab === 'units' ? 'border-violet-600 text-violet-600 dark:border-violet-400 dark:text-violet-400' : 'border-transparent text-slate-500 dark:text-slate-400'}`}>
                  Onde está cada um
                </button>
                <button type="button" onClick={() => setActiveTab('history')} className={`shrink-0 whitespace-nowrap border-b-2 px-1 pb-2 font-medium ${activeTab === 'history' ? 'border-violet-600 text-violet-600 dark:border-violet-400 dark:text-violet-400' : 'border-transparent text-slate-500 dark:text-slate-400'}`}>
                  Histórico
                </button>
                {(locationFilter || variantFilter) && activeTab === 'units' && (
                  <button type="button" onClick={() => { setLocationFilter(null); setVariantFilter(null) }} className="ml-auto min-w-0 truncate pb-2 text-xs text-slate-400 hover:text-violet-600 dark:text-slate-500 dark:hover:text-violet-400">
                    {[locationFilter && LOCATION_CARDS.find((c) => c.type === locationFilter)?.label, variantFilter && trail.variantRows.find((v) => v.comboKey === variantFilter)?.shortTitle].filter(Boolean).join(' · ')} · limpar ✕
                  </button>
                )}
              </div>

              {activeTab === 'units' ? (
                <div className="mt-3 space-y-4">
                  {visiblePlaceGroups.length === 0 ? (
                    <p className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">Nenhuma unidade nesse filtro.</p>
                  ) : (
                    visiblePlaceGroups.map((g) => {
                      const accent = ACCENT_CLASSES[LOCATION_CARDS.find((c) => c.type === g.place)!.accent]
                      return (
                        <div key={g.place}>
                          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
                            <span className={accent.text}>{g.label}</span>
                            <span className="font-normal normal-case text-slate-400 dark:text-slate-500">{g.count} {g.subtitle}</span>
                          </p>
                          <div className="space-y-1.5">
                            {g.rows.map((row) => (
                              <PlaceGroupRowCard key={row.key} place={g.place} row={row} onOpenDrawer={(target) => setDrawerStack([target])} />
                            ))}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              ) : (
                <div className="mt-3 space-y-3">
                  {Object.entries(
                    trail.history.reduce<Record<string, typeof trail.history>>((acc, entry) => {
                      const key = dayKey(entry.date)
                      acc[key] = acc[key] ?? []
                      acc[key].push(entry)
                      return acc
                    }, {}),
                  ).map(([day, entries]) => (
                    <div key={day}>
                      <p className="mb-1 text-xs font-semibold text-slate-400 dark:text-slate-500">{day}</p>
                      <div className="space-y-1">
                        {entries.map((entry, i) => {
                          const content = (
                            <span className="flex flex-wrap items-center gap-2 text-sm">
                              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${HISTORY_KIND_CLASS[entry.kind]}`}>{entry.kind}</span>
                              <span className="text-slate-700 dark:text-slate-300">{entry.detail}</span>
                              {entry.link && <span className="text-xs font-medium text-violet-600 dark:text-violet-400">↗</span>}
                            </span>
                          )
                          return entry.link ? (
                            <button key={i} type="button" onClick={() => setDrawerStack([entry.link!])} className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60">
                              {content}
                            </button>
                          ) : (
                            <div key={i} className="px-2 py-1.5">{content}</div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <UnitTrailDrawer
                target={drawerTarget}
                onClose={() => setDrawerStack([])}
                onNavigate={(target) => setDrawerStack((prev) => [...prev, target])}
              />
            </div>
          )}
        </div>
      )}
    </dialog>
  )
}
