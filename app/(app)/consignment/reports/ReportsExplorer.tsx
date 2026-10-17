'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatCurrency } from '@/lib/format'
import { createConsignmentSaleReport, updateConsignmentSaleReport, deleteConsignmentSaleReport } from '@/actions/consignmentSaleReports'
import { TitlePieceDots } from '@/components/VariantChip'
import { UndoToast } from '@/components/UndoToast'
import { SaleReportForm, type DeliveryOption } from './SaleReportForm'
import type { VariantTitlePiece } from '@/lib/reports'

export interface ReportRow {
  id: string
  deliveryId: string
  deliveryBatchId: string
  reportDate: string
  partnerId: string
  partnerName: string
  productId: string
  productName: string
  category: string
  shortTitle: string | null
  titlePieces: VariantTitlePiece[]
  quantitySold: number
  unitPrice: number
  commissionPercent: number
  commissionAmount: number
  repasse: number
  unitCost: number
  profit: number
  notes: string | null
}

type Period = '7d' | '30d' | 'mes' | 'tudo' | 'custom'
type GroupBy = 'dia' | 'parceiro' | 'produto'

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

// Paleta fixa pra bolinha de avatar de cada parceiro -- hash simples do id
// (estável entre re-renders, sem precisar guardar cor nenhuma no banco).
const PARTNER_PALETTE = [
  { bg: 'bg-violet-500', text: 'text-white', hex: '#8b5cf6' },
  { bg: 'bg-emerald-500', text: 'text-white', hex: '#10b981' },
  { bg: 'bg-amber-500', text: 'text-white', hex: '#f59e0b' },
  { bg: 'bg-sky-500', text: 'text-white', hex: '#0ea5e9' },
  { bg: 'bg-rose-500', text: 'text-white', hex: '#f43f5e' },
  { bg: 'bg-teal-500', text: 'text-white', hex: '#14b8a6' },
  { bg: 'bg-indigo-500', text: 'text-white', hex: '#6366f1' },
  { bg: 'bg-orange-500', text: 'text-white', hex: '#f97316' },
]

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

function partnerColor(partnerId: string) {
  return PARTNER_PALETTE[hashString(partnerId) % PARTNER_PALETTE.length]
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).slice(0, 2)
  return words.map((w) => w[0]).join('').toUpperCase()
}

function deliveryShortCode(deliveryId: string): string {
  return deliveryId.slice(-4).toUpperCase()
}

function startOfDay(d: Date): Date {
  const c = new Date(d)
  c.setHours(0, 0, 0, 0)
  return c
}

function periodRange(period: Period, customFrom: string, customTo: string): { gte: Date | null; lte: Date | null } {
  const today = startOfDay(new Date())
  if (period === 'tudo') return { gte: null, lte: null }
  if (period === 'custom') {
    return {
      gte: customFrom ? startOfDay(new Date(`${customFrom}T00:00:00`)) : null,
      lte: customTo ? new Date(`${customTo}T23:59:59`) : null,
    }
  }
  const lte = new Date(today)
  lte.setHours(23, 59, 59, 999)
  if (period === '7d') {
    const gte = new Date(today)
    gte.setDate(gte.getDate() - 6)
    return { gte, lte }
  }
  if (period === '30d') {
    const gte = new Date(today)
    gte.setDate(gte.getDate() - 29)
    return { gte, lte }
  }
  // mes
  const gte = new Date(today.getFullYear(), today.getMonth(), 1)
  return { gte, lte }
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('pt-BR')
}

interface Totals {
  vendido: number
  comissao: number
  repasse: number
  lucro: number
  pecas: number
  vendas: number
}

function sumTotals(rows: ReportRow[]): Totals {
  return rows.reduce(
    (acc, r) => ({
      vendido: acc.vendido + r.quantitySold * r.unitPrice,
      comissao: acc.comissao + r.commissionAmount,
      repasse: acc.repasse + r.repasse,
      lucro: acc.lucro + r.profit,
      pecas: acc.pecas + r.quantitySold,
      vendas: acc.vendas + 1,
    }),
    { vendido: 0, comissao: 0, repasse: 0, lucro: 0, pecas: 0, vendas: 0 },
  )
}

interface Filters {
  terms: string[]
  range: { gte: Date | null; lte: Date | null }
  partnerIds: Set<string>
  categories: Set<string>
  colors: Set<string>
}

function rowSearchText(r: ReportRow): string {
  return normalize([
    r.productName,
    r.category,
    r.partnerName,
    r.shortTitle ?? '',
    r.titlePieces.map((p) => `${p.name} ${p.shortValue}`).join(' '),
    `#${deliveryShortCode(r.deliveryId)}`,
    r.notes ?? '',
  ].join(' '))
}

function rowColors(r: ReportRow): string[] {
  return r.titlePieces.map((p) => p.shortValue.toLowerCase()).filter(Boolean)
}

function matches(r: ReportRow, f: Filters, skip?: 'partner' | 'category' | 'color'): boolean {
  if (f.terms.length > 0) {
    const text = rowSearchText(r)
    if (!f.terms.every((t) => text.includes(t))) return false
  }
  const d = new Date(r.reportDate)
  if (f.range.gte && d < f.range.gte) return false
  if (f.range.lte && d > f.range.lte) return false
  if (skip !== 'partner' && f.partnerIds.size > 0 && !f.partnerIds.has(r.partnerId)) return false
  if (skip !== 'category' && f.categories.size > 0 && !f.categories.has(r.category)) return false
  if (skip !== 'color' && f.colors.size > 0 && !rowColors(r).some((c) => f.colors.has(c))) return false
  return true
}

function FilterChip({ label, count, active, color, onClick }: { label: string; count: number; active: boolean; color?: string; onClick: () => void }) {
  const disabled = count === 0 && !active
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
        active
          ? 'border-violet-500 bg-violet-500 text-white dark:border-violet-400 dark:bg-violet-500'
          : disabled
            ? 'border-slate-100 text-slate-300 dark:border-slate-800 dark:text-slate-600'
            : 'border-slate-200 text-slate-600 hover:border-violet-300 hover:text-violet-600 dark:border-slate-700 dark:text-slate-300 dark:hover:border-violet-600 dark:hover:text-violet-400'
      }`}
    >
      {color && <span className="inline-block h-2 w-2 shrink-0 rounded-full border border-black/10" style={{ background: color }} />}
      {label}
      <span className={active ? 'text-violet-100' : 'text-slate-400 dark:text-slate-500'}>{count}</span>
    </button>
  )
}

function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

// Redesign "Relatórios de venda" (consignação): tela inteira vira busca +
// filtros facetados + agrupamento, tudo em memória sobre o conjunto já
// carregado (mesmo padrão de DeliveryBatchForm.tsx em Entregas -- catálogo
// pequeno, sem endpoint de busca novo nem paginação server-side). Contagem
// de cada chip é FACETADA (calculada ignorando só a PRÓPRIA dimensão, mas
// respeitando as outras já ativas -- `matches(r, f, skip)` acima) pra
// nenhum clique levar a uma lista vazia sem aviso.
export function ReportsExplorer({ rows, deliveries }: { rows: ReportRow[]; deliveries: DeliveryOption[] }) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [period, setPeriod] = useState<Period>('30d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [partnerIds, setPartnerIds] = useState<Set<string>>(new Set())
  const [categories, setCategories] = useState<Set<string>>(new Set())
  const [colors, setColors] = useState<Set<string>>(new Set())
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false)
  const [groupBy, setGroupBy] = useState<GroupBy>('dia')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<{ quantitySold: string; unitPrice: string; commissionPercent: string; reportDate: string } | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<{ message: string; undo: () => void } | null>(null)
  const [registerOpen, setRegisterOpen] = useState(false)

  const visibleRows = useMemo(() => rows.filter((r) => !removedIds.has(r.id)), [rows, removedIds])

  const filters: Filters = useMemo(
    () => ({
      terms: search.trim().length > 0 ? normalize(search).split(/\s+/).filter(Boolean) : [],
      range: periodRange(period, customFrom, customTo),
      partnerIds,
      categories,
      colors,
    }),
    [search, period, customFrom, customTo, partnerIds, categories, colors],
  )

  const filteredRows = useMemo(() => visibleRows.filter((r) => matches(r, filters)), [visibleRows, filters])

  // Facetas: nome/cor + contagem, ignorando a própria dimensão nos outros
  // filtros ativos (pra clicar num parceiro nunca escondê-lo de si mesmo).
  const partnerFacets = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; count: number }>()
    for (const r of visibleRows) {
      if (!matches(r, filters, 'partner')) continue
      const entry = byId.get(r.partnerId) ?? { id: r.partnerId, name: r.partnerName, count: 0 }
      entry.count += 1
      byId.set(r.partnerId, entry)
    }
    return [...byId.values()].sort((a, b) => b.count - a.count)
  }, [visibleRows, filters])

  const categoryFacets = useMemo(() => {
    const byName = new Map<string, number>()
    for (const r of visibleRows) {
      if (!matches(r, filters, 'category')) continue
      byName.set(r.category, (byName.get(r.category) ?? 0) + 1)
    }
    return [...byName.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
  }, [visibleRows, filters])

  const colorFacets = useMemo(() => {
    const byColor = new Map<string, { count: number; hex: string | null }>()
    for (const r of visibleRows) {
      if (!matches(r, filters, 'color')) continue
      for (const piece of r.titlePieces) {
        const key = piece.shortValue.toLowerCase()
        if (!key) continue
        const entry = byColor.get(key) ?? { count: 0, hex: piece.colorHexes[0] ?? null }
        entry.count += 1
        if (!entry.hex && piece.colorHexes[0]) entry.hex = piece.colorHexes[0]
        byColor.set(key, entry)
      }
    }
    return [...byColor.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.count - a.count)
  }, [visibleRows, filters])

  const totalInPeriod = useMemo(() => visibleRows.filter((r) => matches(r, { ...filters, partnerIds: new Set(), categories: new Set(), colors: new Set(), terms: [] })).length, [visibleRows, filters])
  const totals = useMemo(() => sumTotals(filteredRows), [filteredRows])

  const activeFilterCount = (partnerIds.size > 0 ? 1 : 0) + (categories.size > 0 ? 1 : 0) + (colors.size > 0 ? 1 : 0)
  const hasAnyFilter = search.trim().length > 0 || period !== '30d' || activeFilterCount > 0

  function clearFilters() {
    setSearch('')
    setPeriod('30d')
    setCustomFrom('')
    setCustomTo('')
    setPartnerIds(new Set())
    setCategories(new Set())
    setColors(new Set())
  }

  // Data real mostrada em "Mostrando X de Y vendas · DD/MM – DD/MM": pro
  // período "Tudo" (sem limite fixo) usa o intervalo real das linhas
  // visíveis; pros outros, o intervalo do próprio período escolhido.
  const rangeLabel = useMemo(() => {
    if (period === 'tudo') {
      if (filteredRows.length === 0) return null
      const dates = filteredRows.map((r) => new Date(r.reportDate).getTime())
      return `${fmtDate(new Date(Math.min(...dates)))} – ${fmtDate(new Date(Math.max(...dates)))}`
    }
    const { gte, lte } = filters.range
    if (!gte || !lte) return null
    return `${fmtDate(gte)} – ${fmtDate(lte)}`
  }, [period, filteredRows, filters.range])

  const groups = useMemo(() => {
    if (groupBy === 'dia') {
      const byDay = new Map<string, { key: string; date: Date; rows: ReportRow[] }>()
      for (const r of filteredRows) {
        const d = new Date(r.reportDate)
        const key = startOfDay(d).toISOString()
        const entry = byDay.get(key) ?? { key, date: d, rows: [] }
        entry.rows.push(r)
        byDay.set(key, entry)
      }
      return [...byDay.values()]
        .sort((a, b) => b.date.getTime() - a.date.getTime())
        .map((g) => ({
          key: g.key,
          label: `${g.date.toLocaleDateString('pt-BR', { weekday: 'short' }).replace(/^\w/, (c) => c.toUpperCase())} ${fmtDate(g.date)}`,
          avatar: null as { name: string; id: string } | null,
          rows: g.rows,
          totals: sumTotals(g.rows),
        }))
    }
    if (groupBy === 'parceiro') {
      const byPartner = new Map<string, { id: string; name: string; rows: ReportRow[] }>()
      for (const r of filteredRows) {
        const entry = byPartner.get(r.partnerId) ?? { id: r.partnerId, name: r.partnerName, rows: [] }
        entry.rows.push(r)
        byPartner.set(r.partnerId, entry)
      }
      return [...byPartner.values()]
        .sort((a, b) => sumTotals(b.rows).vendido - sumTotals(a.rows).vendido)
        .map((g) => ({ key: g.id, label: g.name, avatar: { name: g.name, id: g.id }, rows: g.rows, totals: sumTotals(g.rows) }))
    }
    // produto
    const byProduct = new Map<string, { id: string; name: string; rows: ReportRow[] }>()
    for (const r of filteredRows) {
      const entry = byProduct.get(r.productId) ?? { id: r.productId, name: r.productName, rows: [] }
      entry.rows.push(r)
      byProduct.set(r.productId, entry)
    }
    return [...byProduct.values()]
      .sort((a, b) => sumTotals(b.rows).vendido - sumTotals(a.rows).vendido)
      .map((g) => ({ key: g.id, label: g.name, avatar: null as { name: string; id: string } | null, rows: g.rows, totals: sumTotals(g.rows) }))
  }, [filteredRows, groupBy])

  function startEdit(r: ReportRow) {
    setEditingId(r.id)
    setEditError(null)
    setEditDraft({
      quantitySold: String(r.quantitySold),
      unitPrice: String(r.unitPrice),
      commissionPercent: String(Math.round(r.commissionPercent * 100)),
      reportDate: r.reportDate.slice(0, 10),
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setEditDraft(null)
    setEditError(null)
  }

  async function saveEdit(r: ReportRow) {
    if (!editDraft) return
    const fd = new FormData()
    fd.set('deliveryId', r.deliveryId)
    fd.set('quantitySold', editDraft.quantitySold)
    fd.set('unitPrice', editDraft.unitPrice)
    fd.set('commissionPercent', String((parseFloat(editDraft.commissionPercent) || 0) / 100))
    fd.set('reportDate', editDraft.reportDate)
    const result = await updateConsignmentSaleReport(r.id, fd)
    if (!result.success) {
      setEditError(result.error ?? 'Erro ao salvar')
      return
    }
    cancelEdit()
    router.refresh()
  }

  async function handleRemove(r: ReportRow) {
    setExpandedId(null)
    const result = await deleteConsignmentSaleReport(r.id)
    if (!result.success) {
      alert(result.error ?? 'Erro ao remover venda')
      return
    }
    setRemovedIds((prev) => new Set(prev).add(r.id))
    setToast({
      message: `Venda removida: ${r.productName}${r.shortTitle ? ` · ${r.shortTitle}` : ''}`,
      undo: async () => {
        const fd = new FormData()
        fd.set('deliveryId', r.deliveryId)
        fd.set('quantitySold', String(r.quantitySold))
        fd.set('unitPrice', String(r.unitPrice))
        fd.set('commissionPercent', String(r.commissionPercent))
        fd.set('reportDate', r.reportDate.slice(0, 10))
        fd.set('notes', r.notes ?? '')
        const undoResult = await createConsignmentSaleReport(fd)
        if (!undoResult.success) {
          alert(undoResult.error ?? 'Não foi possível desfazer (o saldo pode ter mudado nesse meio-tempo)')
          return
        }
        setRemovedIds((prev) => { const next = new Set(prev); next.delete(r.id); return next })
        setToast(null)
        router.refresh()
      },
    })
    router.refresh()
  }

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="tk-page-title mb-0">Relatórios de venda</h1>
        <button type="button" onClick={() => setRegisterOpen(true)} className="tk-btn-primary px-4">
          + Registrar venda
        </button>
      </div>

      {/* Barra de filtros fixa no topo ao rolar -- só a lista abaixo rola. */}
      <div className="sticky top-0 z-10 mt-4 space-y-2.5 bg-white py-2.5 dark:bg-slate-950">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar produto, cor/variação, parceiro, nº da entrega…"
          className="tk-input-full"
        />

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex shrink-0 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
            {([['7d', '7 dias'], ['30d', '30 dias'], ['mes', 'Este mês'], ['tudo', 'Tudo']] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setPeriod(value)}
                className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                  period === value
                    ? 'bg-violet-600 text-white dark:bg-violet-500'
                    : 'bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {partnerFacets.map((p) => (
              <FilterChip
                key={p.id}
                label={p.name}
                count={p.count}
                active={partnerIds.has(p.id)}
                color={partnerColor(p.id).hex}
                onClick={() => setPartnerIds((prev) => toggleInSet(prev, p.id))}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() => setMoreFiltersOpen((v) => !v)}
            className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-violet-300 hover:text-violet-600 dark:border-slate-700 dark:text-slate-300 dark:hover:border-violet-600 dark:hover:text-violet-400"
          >
            Mais filtros{categories.size + colors.size > 0 ? ` · ${categories.size + colors.size}` : ''} {moreFiltersOpen ? '▴' : '▾'}
          </button>
        </div>

        {moreFiltersOpen && (
          <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Categoria</p>
              <div className="flex flex-wrap gap-1.5">
                {categoryFacets.map((c) => (
                  <FilterChip key={c.name} label={c.name} count={c.count} active={categories.has(c.name)} onClick={() => setCategories((prev) => toggleInSet(prev, c.name))} />
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Cor</p>
              <div className="flex flex-wrap gap-1.5">
                {colorFacets.map((c) => (
                  <FilterChip key={c.name} label={c.name} count={c.count} active={colors.has(c.name)} color={c.hex ?? '#9CA3AF'} onClick={() => setColors((prev) => toggleInSet(prev, c.name))} />
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-2 dark:border-slate-800">
              <label className="text-xs text-slate-500 dark:text-slate-400">
                <span className="mb-1 block">Personalizado de</span>
                <input type="date" value={customFrom} onChange={(e) => { setCustomFrom(e.target.value); setPeriod('custom') }} className="tk-input" />
              </label>
              <label className="text-xs text-slate-500 dark:text-slate-400">
                <span className="mb-1 block">até</span>
                <input type="date" value={customTo} onChange={(e) => { setCustomTo(e.target.value); setPeriod('custom') }} className="tk-input" />
              </label>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-2">
            <span>
              Mostrando {filteredRows.length} de {totalInPeriod} {totalInPeriod === 1 ? 'venda' : 'vendas'}
              {rangeLabel && ` · ${rangeLabel}`}
            </span>
            {hasAnyFilter && (
              <button type="button" onClick={clearFilters} className="font-medium text-violet-600 hover:underline dark:text-violet-400">
                Limpar filtros ✕
              </button>
            )}
          </div>
          <div className="inline-flex shrink-0 items-center gap-1.5">
            <span>Agrupar</span>
            <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
              {([['dia', 'Dia'], ['parceiro', 'Parceiro'], ['produto', 'Produto']] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setGroupBy(value)}
                  className={`px-2 py-1 text-xs font-medium transition-colors ${
                    groupBy === value
                      ? 'bg-violet-600 text-white dark:bg-violet-500'
                      : 'bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Resumo do que está na tela (muda com os filtros). */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="tk-panel p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Vendido</p>
          <p className="mt-1 text-base font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(totals.vendido)}</p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500">{totals.pecas} peças · {totals.vendas} vendas</p>
        </div>
        <div className="tk-panel p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Comissão dos parceiros</p>
          <p className="mt-1 text-base font-semibold tabular-nums text-amber-600 dark:text-amber-400">{formatCurrency(totals.comissao)}</p>
        </div>
        <div className="tk-panel p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Repasse pra mim</p>
          <p className="mt-1 text-base font-semibold tabular-nums text-violet-600 dark:text-violet-400">{formatCurrency(totals.repasse)}</p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500">vendido − comissão</p>
        </div>
        <div className="tk-panel p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Meu lucro</p>
          <p className="mt-1 text-base font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{formatCurrency(totals.lucro)}</p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500">repasse − custo de produção</p>
        </div>
      </div>

      {filteredRows.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-slate-200 px-4 py-10 text-center dark:border-slate-700">
          <p className="text-sm text-slate-500 dark:text-slate-400">Nenhuma venda com esses filtros.</p>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Tente ampliar o período ou remover algum filtro.</p>
          {hasAnyFilter && (
            <button type="button" onClick={clearFilters} className="mt-3 text-xs font-medium text-violet-600 hover:underline dark:text-violet-400">
              Limpar filtros
            </button>
          )}
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {groups.map((g) => (
            <div key={g.key}>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 px-1">
                <div className="flex items-center gap-2">
                  {g.avatar && (
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${partnerColor(g.avatar.id).bg} ${partnerColor(g.avatar.id).text}`}>
                      {initials(g.avatar.name)}
                    </span>
                  )}
                  <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{g.label}</span>
                  <span className="text-xs text-slate-400 dark:text-slate-500">
                    {g.totals.pecas} {g.totals.pecas === 1 ? 'peça' : 'peças'} · {g.totals.vendas} {g.totals.vendas === 1 ? 'venda' : 'vendas'}
                  </span>
                </div>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Vendido <span className="font-semibold text-slate-700 dark:text-slate-200">{formatCurrency(g.totals.vendido)}</span> · Repasse <span className="font-semibold text-violet-600 dark:text-violet-400">{formatCurrency(g.totals.repasse)}</span>
                </span>
              </div>

              <div className="space-y-1.5">
                {g.rows.map((r) => {
                  const expanded = expandedId === r.id
                  const editing = editingId === r.id
                  const color = partnerColor(r.partnerId)
                  return (
                    <div key={r.id} className="tk-panel overflow-hidden p-0">
                      <button
                        type="button"
                        onClick={() => setExpandedId(expanded ? null : r.id)}
                        className="flex w-full flex-wrap items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60"
                      >
                        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${color.bg} ${color.text}`}>
                          {initials(r.partnerName)}
                        </span>
                        <div className="min-w-[7rem]">
                          <p className="truncate text-xs font-medium text-slate-700 dark:text-slate-300">{r.partnerName}</p>
                          {groupBy !== 'dia' && <p className="text-[11px] text-slate-400 dark:text-slate-500">{fmtDate(new Date(r.reportDate))}</p>}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{r.productName}</p>
                          <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                            {r.titlePieces.length > 0 && <TitlePieceDots pieces={r.titlePieces} size="h-2.5 w-2.5" />}
                            <span className="truncate">{r.shortTitle ?? 'sem variação'}</span>
                            <span className="shrink-0 text-slate-300 dark:text-slate-600">· {r.category}</span>
                          </div>
                        </div>
                        <div className="shrink-0 text-right text-xs tabular-nums text-slate-500 dark:text-slate-400">
                          <p className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Qtd</p>
                          <p className="font-medium text-slate-700 dark:text-slate-200">{r.quantitySold}</p>
                        </div>
                        <div className="hidden shrink-0 text-right text-xs tabular-nums text-slate-500 dark:text-slate-400 sm:block">
                          <p className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Preço un.</p>
                          <p className="font-medium text-slate-700 dark:text-slate-200">{formatCurrency(r.unitPrice)}</p>
                        </div>
                        <div className="hidden shrink-0 text-right text-xs tabular-nums text-amber-600 dark:text-amber-400 sm:block">
                          <p className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Comissão</p>
                          <p className="font-medium">{(r.commissionPercent * 100).toFixed(0)}%</p>
                        </div>
                        <div className="shrink-0 text-right text-xs tabular-nums text-violet-600 dark:text-violet-400">
                          <p className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Repasse</p>
                          <p className="font-medium">{formatCurrency(r.repasse)}</p>
                        </div>
                        <span aria-hidden className="shrink-0 text-slate-400">{expanded ? '▴' : '▾'}</span>
                      </button>

                      {expanded && (
                        <div className="border-t border-slate-100 bg-slate-50/60 px-3 py-3 dark:border-slate-800 dark:bg-slate-800/30">
                          {editing && editDraft ? (
                            <div className="space-y-2">
                              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                <label className="text-xs text-slate-500 dark:text-slate-400">
                                  <span className="mb-1 block">Qtd.</span>
                                  <input type="number" min={1} step={1} value={editDraft.quantitySold} onChange={(e) => setEditDraft({ ...editDraft, quantitySold: e.target.value })} className="tk-input w-full" />
                                </label>
                                <label className="text-xs text-slate-500 dark:text-slate-400">
                                  <span className="mb-1 block">Preço un.</span>
                                  <input type="number" min={0.01} step={0.01} value={editDraft.unitPrice} onChange={(e) => setEditDraft({ ...editDraft, unitPrice: e.target.value })} className="tk-input w-full" />
                                </label>
                                <label className="text-xs text-slate-500 dark:text-slate-400">
                                  <span className="mb-1 block">Comissão %</span>
                                  <input type="number" min={0} max={100} step={1} value={editDraft.commissionPercent} onChange={(e) => setEditDraft({ ...editDraft, commissionPercent: e.target.value })} className="tk-input w-full" />
                                </label>
                                <label className="text-xs text-slate-500 dark:text-slate-400">
                                  <span className="mb-1 block">Data</span>
                                  <input type="date" value={editDraft.reportDate} onChange={(e) => setEditDraft({ ...editDraft, reportDate: e.target.value })} className="tk-input w-full" />
                                </label>
                              </div>
                              {editError && <p className="text-xs text-red-600 dark:text-red-400">{editError}</p>}
                              <div className="flex justify-end gap-3">
                                <button type="button" onClick={cancelEdit} className="text-xs text-slate-500 hover:underline dark:text-slate-400">Cancelar</button>
                                <button type="button" onClick={() => saveEdit(r)} className="text-xs font-medium text-violet-600 hover:underline dark:text-violet-400">Salvar</button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <p className="text-xs text-slate-600 dark:text-slate-300">
                                Vendido {formatCurrency(r.quantitySold * r.unitPrice)} − Comissão {formatCurrency(r.commissionAmount)} − Custo {formatCurrency(r.unitCost * r.quantitySold)} = <span className="font-semibold text-emerald-600 dark:text-emerald-400">Meu lucro {formatCurrency(r.profit)}</span>
                              </p>
                              {r.notes && <p className="mt-1 text-xs italic text-slate-400 dark:text-slate-500">{r.notes}</p>}
                              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                                <a href={`/consignment/deliveries?batchId=${encodeURIComponent(r.deliveryBatchId)}`} className="text-xs font-medium text-violet-600 hover:underline dark:text-violet-400">
                                  Entrega #{deliveryShortCode(r.deliveryId)} ↗
                                </a>
                                <div className="flex gap-3">
                                  <button type="button" onClick={() => startEdit(r)} className="text-xs font-medium text-violet-600 hover:underline dark:text-violet-400">Editar</button>
                                  <button type="button" onClick={() => handleRemove(r)} className="text-xs font-medium text-red-600 hover:underline dark:text-red-400">Remover</button>
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <SaleReportForm open={registerOpen} onOpenChange={setRegisterOpen} deliveries={deliveries} />

      {toast && <UndoToast message={toast.message} onUndo={toast.undo} onDismiss={() => setToast(null)} />}
    </div>
  )
}
