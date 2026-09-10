'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getStockStatus } from '@/lib/costing'
import { getStockStatusBadge } from '@/lib/format'
import { StatusBadge } from '@/components/StatusBadge'
import { AdjustStockButton } from '@/components/AdjustStockButton'
import { ActionsMenu } from '@/components/ActionsMenu'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'
import { deleteFilament } from '@/actions/filaments'
import { FilamentForm, type EditingFilament } from './FilamentForm'
import type { FilamentMaterial } from '@prisma/client'

export interface FilamentRow {
  id: string
  manufacturer: string
  material: FilamentMaterial
  colorName: string
  colorHex: string
  rollNumber: number
  currentStockGrams: number
  spoolPrice: number
  spoolWeightKg: number
  percentRemaining: number
  pricePerGram: number
}

const MATERIAL_OPTIONS: { value: FilamentMaterial | ''; label: string }[] = [
  { value: '', label: 'Todos materiais' },
  { value: 'PLA', label: 'PLA' },
  { value: 'PETG', label: 'PETG' },
  { value: 'TPU', label: 'TPU' },
  { value: 'OUTRO', label: 'Outro' },
]

type SortKey = 'manufacturer' | 'percentRemaining' | 'pricePerGram'

// Melhoria "Filamentos" item 3: cor da barra de estoque usa faixas
// PRÓPRIAS (50%/20%), diferentes das faixas de lib/costing.ts#getStockStatus
// (30%/10%, usadas no badge de Status) -- pedido explícito da spec: a barra
// é "o quão cheio está o rolo" (visão contínua), o badge é "precisa agir"
// (visão de degrau). Os dois nunca precisam concordar pixel a pixel.
function barColorClass(percent: number): string {
  if (percent > 50) return 'bg-emerald-500'
  if (percent >= 20) return 'bg-amber-500'
  return 'bg-red-500'
}

function chipClass(active: boolean): string {
  return `rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
    active
      ? 'bg-amber-600 text-white dark:bg-amber-500 dark:text-slate-950'
      : 'border border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
  }`
}

function SortHeader({ label, active, dir, onClick }: { label: string; active: boolean; dir: 'asc' | 'desc'; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 ${active ? 'text-slate-900 dark:text-slate-100' : ''}`}
    >
      {label}
      {active && <span aria-hidden>{dir === 'asc' ? '▲' : '▼'}</span>}
    </button>
  )
}

// Melhoria "Filamentos" (itens 1-7, ver conversa): busca/filtros/ordenação
// em tempo real -- por isso viraram estado de cliente em vez do padrão
// usual do app (Link + query string, re-fetch no servidor a cada clique,
// usado no resto das telas de catálogo). O dataset já vem inteiro do
// servidor (`rows`, poucas dezenas de itens hoje -- ver nota de paginação
// no relatório da tarefa), então filtrar/ordenar no navegador é instantâneo
// e não pede nenhuma lib nova. `editingFilament` é a ÚNICA parte que
// continua vindo do servidor via ?editId= (padrão `?editId=` do app,
// CLAUDE.md) -- abre o modal sozinho quando a página chega com esse param.
export function FilamentsExplorer({ rows, editingFilament }: { rows: FilamentRow[]; editingFilament?: EditingFilament }) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [material, setMaterial] = useState<FilamentMaterial | ''>('')
  const [color, setColor] = useState('')
  const [lowOnly, setLowOnly] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('manufacturer')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [modalOpen, setModalOpen] = useState(false)
  const [modalTarget, setModalTarget] = useState<EditingFilament | undefined>(undefined)

  useEffect(() => {
    if (editingFilament) {
      setModalTarget(editingFilament)
      setModalOpen(true)
    }
  }, [editingFilament])

  function closeModal() {
    setModalOpen(false)
    // Veio de um ?editId= (Editar) -- limpa a URL ao fechar, senão reabrir
    // a página com back/forward do navegador reabriria o modal sozinho.
    if (editingFilament) router.push('/filaments')
  }

  function openNew() {
    setModalTarget(undefined)
    setModalOpen(true)
  }

  const distinctColors = useMemo(
    () => [...new Set(rows.map((r) => r.colorName))].sort((a, b) => a.localeCompare(b)),
    [rows],
  )

  // Contagem estável (não afetada pelos filtros ativos) pro chip/badge --
  // mesma definição de "Estoque baixo" já usada no badge de Status de cada
  // linha (getStockStatus), então chip, badge do menu lateral e status da
  // linha nunca divergem entre si.
  const lowStockCount = useMemo(
    () => rows.filter((r) => getStockStatus(r.percentRemaining).label === 'Estoque baixo').length,
    [rows],
  )

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase()
    const filtered = rows.filter((r) => {
      if (material && r.material !== material) return false
      if (color && r.colorName !== color) return false
      if (lowOnly && getStockStatus(r.percentRemaining).label !== 'Estoque baixo') return false
      if (term) {
        const haystack = `${r.manufacturer} ${r.material} ${r.colorName}`.toLowerCase()
        if (!haystack.includes(term)) return false
      }
      return true
    })
    const dir = sortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) =>
      sortKey === 'manufacturer' ? dir * a.manufacturer.localeCompare(b.manufacturer) : dir * (a[sortKey] - b[sortKey]),
    )
  }, [rows, search, material, color, lowOnly, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="tk-page-title mb-0">Filamentos</h1>
        <button type="button" onClick={openNew} className="tk-btn-primary px-4">
          + Novo filamento
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar marca, material ou cor"
          className="tk-input min-w-[240px] flex-1"
        />
        <select value={material} onChange={(e) => setMaterial(e.target.value as FilamentMaterial | '')} className="tk-input">
          {MATERIAL_OPTIONS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
        <select value={color} onChange={(e) => setColor(e.target.value)} className="tk-input">
          <option value="">Todas as cores</option>
          {distinctColors.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <div className="mb-4 mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => setLowOnly(false)} className={chipClass(!lowOnly)}>
          Todos
        </button>
        <button type="button" onClick={() => setLowOnly(true)} className={chipClass(lowOnly)}>
          ⚠️ Estoque baixo · {lowStockCount}
        </button>
      </div>

      <table className="tk-table-zebra w-full text-sm">
        <thead>
          <tr className="tk-table-head-row">
            <th className="py-3"></th>
            <th><SortHeader label="Marca" active={sortKey === 'manufacturer'} dir={sortDir} onClick={() => toggleSort('manufacturer')} /></th>
            <th>Material</th>
            <th><SortHeader label="Estoque" active={sortKey === 'percentRemaining'} dir={sortDir} onClick={() => toggleSort('percentRemaining')} /></th>
            <th><SortHeader label="R$/g" active={sortKey === 'pricePerGram'} dir={sortDir} onClick={() => toggleSort('pricePerGram')} /></th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((r) => {
            const status = getStockStatus(r.percentRemaining)
            const priceMissing = r.pricePerGram <= 0
            return (
              <tr key={r.id} className="tk-row">
                <td className="py-3">
                  <span
                    style={{ background: r.colorHex }}
                    className="inline-block h-3.5 w-3.5 rounded-full ring-1 ring-slate-300 dark:ring-slate-600"
                  />
                </td>
                <td className="py-3 font-medium text-slate-900 dark:text-slate-100">
                  {r.manufacturer} {r.colorName} — Rolo #{String(r.rollNumber).padStart(3, '0')}
                </td>
                <td className="text-slate-500 dark:text-slate-400">{r.material}</td>
                <td title={`${r.currentStockGrams}g restantes`}>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                      <div
                        className={`h-full rounded-full ${barColorClass(r.percentRemaining)}`}
                        style={{ width: `${Math.min(100, Math.max(0, r.percentRemaining))}%` }}
                      />
                    </div>
                    <span className="tabular-nums text-slate-900 dark:text-slate-100">{r.percentRemaining.toFixed(0)}%</span>
                  </div>
                </td>
                <td className="text-slate-500 dark:text-slate-400">
                  {priceMissing ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                      ⚠️ Preço não informado
                    </span>
                  ) : (
                    `R$ ${r.pricePerGram.toFixed(4)}`
                  )}
                </td>
                <td><StatusBadge badge={getStockStatusBadge(status)} /></td>
                <td>
                  <ActionsMenu>
                    <Link href={`/filaments?editId=${r.id}`} className="text-amber-600 hover:underline dark:text-amber-400">
                      Editar
                    </Link>
                    <AdjustStockButton
                      resourceType="FILAMENT"
                      resourceId={r.id}
                      resourceName={`${r.manufacturer} ${r.colorName}`}
                      currentQuantity={r.currentStockGrams}
                      unitLabel="g"
                    />
                    <ConfirmDeleteForm action={async () => { await deleteFilament(r.id) }} />
                  </ActionsMenu>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {visibleRows.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
          Nenhum filamento encontrado com esses filtros.
        </div>
      )}

      <FilamentForm
        key={modalTarget?.id ?? 'new'}
        open={modalOpen}
        onOpenChange={(open) => (open ? setModalOpen(true) : closeModal())}
        editingFilament={modalTarget}
      />
    </div>
  )
}
