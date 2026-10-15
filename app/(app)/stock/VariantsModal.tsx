'use client'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { isOutsideDialogClick } from '@/lib/dialog'
import { ChipDots } from '@/components/VariantChip'
import type { StockRow } from './StockExplorer'
import { EditVariantColorsForm } from './EditVariantColorsForm'
import { fetchProductUnitTrail, type ProductUnitTrailResult } from '@/actions/productTracking'
import { UnitTrailDrawer, type DrawerTarget } from './UnitTrailDrawer'

type LocationType = 'estoque' | 'devolvida' | 'parceiro' | 'vendida'
type VariantRow = ProductUnitTrailResult['variantRows'][number]
type Unit = ProductUnitTrailResult['units'][number]

const VARIANT_TIER_RANK: Record<string, number> = { produto: 0, complemento: 1, acessorio: 2 }

// Mesmo critério de pickTitleAttrNames/variantTitle de
// app/(app)/consignment/partners/[id]/PartnerStockSection.tsx -- título
// curto ("Corpo lavanda · Bolinha branca") a partir das 2 peças que mais
// diferenciam as variações, em vez do rótulo corrido completo
// (getProductVariantBreakdown#label, "PEÇA: Marca Cor (Material), ...").
// Duplicado aqui de propósito (risco baixo, função pura e pequena) em vez
// de mexer de novo no arquivo já publicado -- candidato a unificar numa
// 3ª ocorrência futura.
function pickTitleAttrNames(rows: VariantRow[]): string[] {
  const names = Array.from(new Set(rows.flatMap((v) => v.attrs.map((a) => a.name))))
  if (names.length <= 2) return names
  const allAttrs = rows.flatMap((v) => v.attrs)
  const scored = names.map((name) => {
    const distinctValues = new Set(rows.map((v) => v.attrs.find((a) => a.name === name)?.shortValue).filter(Boolean))
    const tier = allAttrs.find((a) => a.name === name)?.tier ?? 'complemento'
    return { name, distinctCount: distinctValues.size, tierRank: VARIANT_TIER_RANK[tier] ?? 1 }
  })
  scored.sort((a, b) => b.distinctCount - a.distinctCount || a.tierRank - b.tierRank)
  return scored.slice(0, 2).map((s) => s.name)
}

function variantTitle(row: VariantRow, titleAttrNames: string[]): string {
  if (row.attrs.length === 0) return row.label
  const parts = titleAttrNames
    .map((name) => row.attrs.find((a) => a.name === name))
    .filter((a): a is VariantRow['attrs'][number] => Boolean(a))
    .map((a) => `${a.name} ${a.shortValue}`)
  return parts.length > 0 ? parts.join(' · ') : row.label
}

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

const UNIT_DOT_CLASS: Record<LocationType, string> = {
  estoque: 'bg-sky-400',
  parceiro: 'bg-amber-400',
  vendida: 'bg-emerald-400',
  devolvida: 'bg-slate-400',
}

function locationValue(trail: ProductUnitTrailResult, type: LocationType): number {
  if (type === 'estoque') return trail.locationCounts.inStock
  if (type === 'parceiro') return trail.locationCounts.withPartners.reduce((s, p) => s + p.quantity, 0)
  if (type === 'vendida') return trail.locationCounts.sold
  return trail.locationCounts.returned
}

function statusPillForUnit(unit: Unit): { label: string; className: string } {
  switch (unit.location.type) {
    case 'estoque': return { label: 'Em estoque', className: 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300' }
    case 'parceiro': return { label: `Com ${unit.location.partnerName}`, className: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' }
    case 'vendida': return { label: unit.location.partnerName ? `Vendida · ${unit.location.partnerName}` : 'Vendida', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' }
    case 'devolvida': return { label: 'Devolvida', className: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' }
  }
}

const HISTORY_KIND_CLASS: Record<string, string> = {
  Produzido: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
  Montado: 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300',
  Entregue: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  Vendido: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  Devolvido: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
}

function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime()
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)))
}

function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

function UnitCard({ unit, onOpenDrawer }: { unit: Unit; onOpenDrawer: (target: DrawerTarget) => void }) {
  const pill = statusPillForUnit(unit)
  const lastStep = unit.steps[unit.steps.length - 1]
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100">
          <span className="text-xs text-slate-400 dark:text-slate-500">#{unit.n}</span>
          <ChipDots hexes={unit.colorHexes} size="h-2.5 w-2.5" />
          {unit.variantLabel}
        </span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${pill.className}`}>{pill.label}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        {unit.steps.map((step, i) => (
          <span key={i} className="flex items-center gap-2">
            {i > 0 && <span className="text-slate-300 dark:text-slate-600">→</span>}
            {step.link ? (
              <button type="button" onClick={() => onOpenDrawer(step.link!)} className="font-medium text-violet-600 hover:underline dark:text-violet-400">
                {step.label} {step.detail} ↗
              </button>
            ) : (
              <span>{step.label} {step.detail}</span>
            )}
          </span>
        ))}
        {(unit.location.type === 'estoque' || unit.location.type === 'parceiro') && lastStep && (
          <span className="flex items-center gap-2 border-l border-dashed border-slate-300 pl-2 text-slate-400 dark:border-slate-600 dark:text-slate-500">
            {unit.location.type === 'parceiro'
              ? `Ainda com ${unit.location.partnerName} há ${daysSince(unit.location.since)} dia(s)`
              : `Parada no estoque há ${daysSince(lastStep.date)} dia(s)`}
          </span>
        )}
      </div>
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
    setDrawerStack([])
    setTrail(undefined)
    if (!product) return
    let cancelled = false
    fetchProductUnitTrail(product.productId).then((r) => { if (!cancelled) setTrail(r) })
    return () => { cancelled = true }
  }, [product])

  const titleAttrNames = useMemo(() => (trail ? pickTitleAttrNames(trail.variantRows) : []), [trail])
  const filteredUnits = useMemo(() => {
    if (!trail) return []
    return trail.units.filter((u) => (!locationFilter || u.location.type === locationFilter) && (!variantFilter || u.comboKey === variantFilter))
  }, [trail, locationFilter, variantFilter])

  function toggleLocationFilter(type: LocationType) {
    setLocationFilter((prev) => (prev === type ? null : type))
  }
  function toggleVariantFilter(comboKey: string) {
    setVariantFilter((prev) => (prev === comboKey ? null : comboKey))
  }

  const drawerTarget = drawerStack[drawerStack.length - 1] ?? null

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(e) => { if (isOutsideDialogClick(e)) onClose() }}
      className="w-full [--tk-dialog-cap:1000px] rounded-xl border border-slate-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-950/60 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
    >
      {product && (
        <div className="relative flex max-h-[85vh] flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
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
            <div className="overflow-y-auto px-5 py-4">
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

              <p className={`mt-2 text-xs ${trail.reconciliationOk ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                {trail.reconciliationOk
                  ? `✓ ${locationValue(trail, 'estoque')} + ${locationValue(trail, 'parceiro')} + ${locationValue(trail, 'vendida')} + ${locationValue(trail, 'devolvida')} = ${trail.totalCreated} · bate com o que foi ${trail.needsAssembly ? 'montado' : 'produzido'}`
                  : `⚠ ${trail.reconciliationNote}`}
              </p>

              {trail.parts.length > 0 && (
                <div className="mt-3 rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800/40">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Peças do lote (produzido → usado na montagem → sobrou)</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
                    {trail.parts.map((p) => (
                      <span key={p.name}><span className="font-medium">{p.name}</span> {p.produced} → {p.consumed} → {p.available}</span>
                    ))}
                  </div>
                </div>
              )}

              {trail.units.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {trail.units.map((u) => (
                    <span key={u.n} title={`#${u.n} · ${statusPillForUnit(u).label}`} className={`inline-block h-3 w-3 rounded-sm ${UNIT_DOT_CLASS[u.location.type]}`} />
                  ))}
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
                          <td className="py-2">
                            <span className="flex items-center gap-2">
                              <ChipDots hexes={row.colorHexes} size="h-3 w-3" />
                              {variantTitle(row, titleAttrNames)}
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

              <div className="mt-4 flex items-center gap-4 border-b border-slate-200 text-sm dark:border-slate-800">
                <button type="button" onClick={() => setActiveTab('units')} className={`border-b-2 px-1 pb-2 font-medium ${activeTab === 'units' ? 'border-violet-600 text-violet-600 dark:border-violet-400 dark:text-violet-400' : 'border-transparent text-slate-500 dark:text-slate-400'}`}>
                  Rastrear unidades
                </button>
                <button type="button" onClick={() => setActiveTab('history')} className={`border-b-2 px-1 pb-2 font-medium ${activeTab === 'history' ? 'border-violet-600 text-violet-600 dark:border-violet-400 dark:text-violet-400' : 'border-transparent text-slate-500 dark:text-slate-400'}`}>
                  Histórico completo
                </button>
                {(locationFilter || variantFilter) && activeTab === 'units' && (
                  <button type="button" onClick={() => { setLocationFilter(null); setVariantFilter(null) }} className="ml-auto pb-2 text-xs text-slate-400 hover:text-violet-600 dark:text-slate-500 dark:hover:text-violet-400">
                    Filtro: {[locationFilter && LOCATION_CARDS.find((c) => c.type === locationFilter)?.label, variantFilter && trail.variantRows.find((v) => v.comboKey === variantFilter)?.label].filter(Boolean).join(' · ')} · limpar ✕
                  </button>
                )}
              </div>

              {activeTab === 'units' ? (
                <div className="mt-3 space-y-2">
                  {filteredUnits.length === 0 ? (
                    <p className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">Nenhuma unidade nesse filtro.</p>
                  ) : (
                    filteredUnits.map((u) => <UnitCard key={u.n} unit={u} onOpenDrawer={(target) => setDrawerStack([target])} />)
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
            </div>
          )}

          <UnitTrailDrawer
            target={drawerTarget}
            onClose={() => setDrawerStack([])}
            onNavigate={(target) => setDrawerStack((prev) => [...prev, target])}
          />
        </div>
      )}
    </dialog>
  )
}
