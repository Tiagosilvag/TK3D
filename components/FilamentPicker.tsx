'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  FINISHES,
  defaultMaterial,
  groupByFamily,
  matchesFilters,
  stockLevel,
  toPickerItem,
  type Finish,
  type PickerFilament,
  type PickerItem,
} from '@/lib/filamentPicker'

const RECENT_KEY = 'tk3d:filament-recent'
const RECENT_MAX = 6

function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function writeRecent(ids: string[]) {
  try {
    const next = [...ids, ...readRecent().filter((r) => !ids.includes(r))].slice(0, RECENT_MAX)
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // sem localStorage (janela privada etc.): "Recentes" só deixa de aparecer.
  }
}

const grams = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} g`
const titleCase = (s: string) => (s ? s[0] + s.slice(1).toLowerCase() : s)

// Bolinha por acabamento: Silk com brilho, Translúcido com fundo xadrez,
// Matte/Comum plana. A cor (hex) vem do cadastro do filamento.
export function swatchStyle(item: { colorHex: string | null; finish: Finish }): React.CSSProperties {
  const hex = item.colorHex
  if (!hex) return { background: 'transparent', border: '1px dashed #94a3b8' }
  if (item.finish === 'Silk') return { background: `linear-gradient(135deg, ${hex} 0%, color-mix(in srgb, ${hex} 50%, white) 48%, ${hex} 100%)` }
  if (item.finish === 'Translúcido') {
    return {
      background: `linear-gradient(color-mix(in srgb, ${hex} 60%, transparent), color-mix(in srgb, ${hex} 60%, transparent)), repeating-conic-gradient(#cfd5e6 0% 25%, #ffffff 0% 50%) 50% / 10px 10px`,
    }
  }
  return { background: hex }
}

export function Swatch({ item, className = 'h-8 w-8' }: { item: { colorHex: string | null; finish: Finish }; className?: string }) {
  return <span style={swatchStyle(item)} className={`inline-block shrink-0 rounded-full border border-black/15 dark:border-white/20 ${className}`} />
}

const MATERIAL_TAG: Record<string, string> = {
  PLA: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  PETG: 'bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300',
}
export function MaterialTag({ material }: { material: string }) {
  return (
    <span className={`rounded px-1.5 py-px text-[10px] font-bold tracking-wide ${MATERIAL_TAG[material] ?? 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>
      {material}
    </span>
  )
}

const chip = (on: boolean) =>
  `rounded-full border px-3 py-1 text-xs transition-colors ${
    on
      ? 'border-violet-600 bg-violet-600 text-white dark:border-violet-500 dark:bg-violet-500 dark:text-slate-950'
      : 'border-slate-300 bg-slate-50 text-slate-600 hover:border-violet-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
  }`

export interface FilamentPickerProps {
  filaments: PickerFilament[]
  mode: 'single' | 'multi'
  selectedId?: string | null
  // Gramas necessárias nesta escolha (gramas por unidade × planejada) --
  // 0/ausente = o contexto não sabe, nada é esmaecido.
  need?: number
  // Outras cores da mesma peça: definem o tipo (PLA/PETG) padrão.
  contextIds?: string[]
  contextLabel?: string
  onPick: (ids: string[]) => void
  onClose: () => void
}

export function FilamentPicker({ filaments, mode, selectedId = null, need = 0, contextIds = [], contextLabel, onPick, onClose }: FilamentPickerProps) {
  const items = useMemo(() => filaments.map(toPickerItem), [filaments])
  const ctxMaterial = useMemo(() => {
    const m = defaultMaterial(items, selectedId, contextIds)
    return m === 'all' ? null : m
  }, [items, selectedId, contextIds])

  const [material, setMaterial] = useState<string>(ctxMaterial ?? 'all')
  const [brands, setBrands] = useState<Set<string>>(new Set())
  const [finishes, setFinishes] = useState<Set<Finish>>(new Set())
  const [query, setQuery] = useState('')
  const [onlyCovering, setOnlyCovering] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [recent, setRecent] = useState<string[]>([])
  const bodyRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => setRecent(readRecent()), [])
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const filters = { material, brands, finishes, query, onlyCovering, need }
  const visible = items.filter((i) => matchesFilters(i, filters))
  const groups = groupByFamily(visible)
  const hasFilter = query.trim() !== '' || brands.size > 0 || finishes.size > 0

  const materials = useMemo(() => [...new Set(items.map((i) => i.material))].sort(), [items])
  const brandCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of items) m.set(i.manufacturer, (m.get(i.manufacturer) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name)
  }, [items])
  const recentItems = recent
    .map((id) => items.find((i) => i.id === id))
    .filter((i): i is PickerItem => !!i && (material === 'all' || i.material === material))

  function choose(id: string) {
    if (mode === 'multi') {
      setPicked((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
      return
    }
    writeRecent([id])
    onPick([id])
  }

  function confirmMulti() {
    if (picked.size === 0) return
    const ids = [...picked]
    writeRecent(ids)
    onPick(ids)
  }

  function toggle<T>(set: Set<T>, value: T, apply: (s: Set<T>) => void) {
    const next = new Set(set)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    apply(next)
  }

  // Setas: navega pelos cartões pela posição na tela (grade com colunas
  // variáveis), Enter no campo de busca escolhe o primeiro resultado.
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && e.target === searchRef.current) {
      e.preventDefault()
      const first = groups[0]?.items[0]
      if (first) choose(first.id)
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return
    const cards = [...(bodyRef.current?.querySelectorAll<HTMLElement>('[data-card]') ?? [])]
    if (cards.length === 0) return
    const current = cards.find((c) => c === document.activeElement) ?? null
    e.preventDefault()
    if (!current) {
      if (e.key === 'ArrowDown') cards[0].focus()
      return
    }
    const r = current.getBoundingClientRect()
    const cx = r.left + r.width / 2
    let best: HTMLElement | null = null
    let bestD = Infinity
    for (const c of cards) {
      if (c === current) continue
      const q = c.getBoundingClientRect()
      const dy = q.top - r.top
      const dx = q.left + q.width / 2 - cx
      let ok = false
      let d = 0
      if (e.key === 'ArrowDown') { ok = dy > 8; d = dy * 4 + Math.abs(dx) }
      if (e.key === 'ArrowUp') { ok = dy < -8; d = -dy * 4 + Math.abs(dx) }
      if (e.key === 'ArrowRight') { ok = Math.abs(dy) < 8 && dx > 8; d = dx }
      if (e.key === 'ArrowLeft') { ok = Math.abs(dy) < 8 && dx < -8; d = -dx }
      if (ok && d < bestD) { bestD = d; best = c }
    }
    if (best) {
      best.focus()
      best.scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'ArrowUp') searchRef.current?.focus()
  }

  const showCtxNote = ctxMaterial !== null && material === ctxMaterial
  const otherCount = items.filter((i) => matchesFilters(i, filters, true)).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-3 sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Escolher filamento"
        onKeyDown={onKeyDown}
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      >
        <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-4">
          <div>
            <h2 className="font-display text-base font-semibold">{mode === 'multi' ? 'Adicionar cores' : 'Escolher filamento'}</h2>
            {(contextLabel || need > 0) && (
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {contextLabel}
                {contextLabel && need > 0 ? ' · ' : ''}
                {need > 0 && `precisa de ${grams(need)}`}
              </p>
            )}
            {mode === 'multi' && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Marque todas as cores que esta peça usa e confirme uma vez.</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">✕</button>
        </div>

        <div className="space-y-2.5 border-b border-slate-100 px-5 pb-3 dark:border-slate-800">
          <div className="relative">
            <input
              ref={searchRef}
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por cor, marca ou tipo (ex.: preto, silk, masterprint)"
              autoComplete="off"
              className="tk-input-full w-full pr-9"
            />
            {query && (
              <button type="button" onClick={() => { setQuery(''); searchRef.current?.focus() }} aria-label="Limpar busca" className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-700">✕</button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
              {['all', ...materials].map((m) => {
                const count = m === 'all' ? items.length : items.filter((i) => i.material === m).length
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMaterial(m)}
                    className={`rounded-md px-3 py-1 text-sm ${material === m ? 'bg-white font-semibold shadow-sm dark:bg-slate-900' : 'text-slate-500 dark:text-slate-400'}`}
                  >
                    {m === 'all' ? 'Todos' : m}
                    <span className="ml-1 text-xs font-normal text-slate-400">{count}</span>
                  </button>
                )
              })}
            </div>
            {need > 0 && (
              <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                <input type="checkbox" checked={onlyCovering} onChange={(e) => setOnlyCovering(e.target.checked)} />
                Só os que cobrem esta produção
              </label>
            )}
          </div>

          {brandCounts.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-20 text-[11px] uppercase tracking-wider text-slate-400">Marca</span>
              {brandCounts.map((b) => (
                <button key={b} type="button" onClick={() => toggle(brands, b, setBrands)} className={chip(brands.has(b))}>{titleCase(b)}</button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-20 text-[11px] uppercase tracking-wider text-slate-400">Acabamento</span>
            {FINISHES.map((f) => (
              <button key={f} type="button" onClick={() => toggle(finishes, f, setFinishes)} className={chip(finishes.has(f))}>{f}</button>
            ))}
          </div>

          {showCtxNote && (
            <p className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
              Mostrando só {ctxMaterial}, igual às outras cores desta peça.{' '}
              <button type="button" onClick={() => setMaterial('all')} className="font-semibold underline">Ver {materials.join(' e ')}</button>
            </p>
          )}
        </div>

        <div ref={bodyRef} className="min-h-[200px] flex-1 overflow-y-auto px-5 py-3">
          {!hasFilter && recentItems.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider text-slate-400">Recentes</span>
              {recentItems.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => choose(i.id)}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-slate-50 py-1 pl-1 pr-3 text-xs hover:border-violet-400 dark:border-slate-700 dark:bg-slate-800"
                >
                  <Swatch item={i} className="h-5 w-5" />
                  {i.color}{i.finish !== 'Comum' ? ` ${i.finish}` : ''} · {i.material}
                </button>
              ))}
            </div>
          )}

          {groups.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
              Nenhum filamento com esses filtros.
              {material !== 'all' && otherCount > 0 && (
                <>
                  <br />
                  <button type="button" onClick={() => setMaterial('all')} className="mt-1 font-medium text-violet-600 hover:underline dark:text-violet-400">
                    Buscar também em {materials.filter((m) => m !== material).join(' e ')} ({otherCount})
                  </button>
                </>
              )}
            </div>
          ) : (
            groups.map((g) => (
              <section key={g.family} className="mb-4">
                <h3 className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  {g.family}
                  <span className="font-medium">{g.items.length}</span>
                </h3>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2">
                  {g.items.map((i) => {
                    const sel = mode === 'multi' ? picked.has(i.id) : selectedId === i.id
                    const level = stockLevel(i.stockGrams, need)
                    const pct = Math.min(100, Math.round((i.stockGrams / 1000) * 100))
                    return (
                      <button
                        key={i.id}
                        type="button"
                        data-card
                        aria-pressed={sel}
                        onClick={() => choose(i.id)}
                        className={`relative flex items-start gap-3 rounded-xl border-2 px-3 py-2.5 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500 ${
                          sel ? 'border-violet-600 bg-violet-50 dark:border-violet-500 dark:bg-violet-500/15' : 'border-transparent bg-slate-50 hover:border-slate-300 dark:bg-slate-800 dark:hover:border-slate-600'
                        } ${level === 'bad' ? 'opacity-70' : ''}`}
                      >
                        <Swatch item={i} className="h-8 w-8" />
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="text-sm font-semibold leading-tight">
                            {i.color}
                            {i.finish !== 'Comum' && <span className="ml-1 font-normal text-slate-500 dark:text-slate-400">{i.finish}</span>}
                          </span>
                          <span className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                            <MaterialTag material={i.material} />
                            {titleCase(i.manufacturer)}
                          </span>
                          <span className="flex items-center gap-2">
                            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                              <i className={`block h-full rounded-full ${level === 'bad' ? 'bg-red-500' : level === 'low' ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
                            </span>
                            <span className={`whitespace-nowrap text-[11px] ${level === 'bad' ? 'font-semibold text-red-600 dark:text-red-400' : level === 'low' ? 'font-semibold text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'}`}>
                              {grams(i.stockGrams)}
                            </span>
                          </span>
                          {level === 'bad' && <span className="text-[11px] font-semibold text-red-600 dark:text-red-400">Não cobre: precisa de {grams(need)}</span>}
                        </span>
                        {sel && <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-violet-600 text-[10px] text-white">✓</span>}
                      </button>
                    )
                  })}
                </div>
              </section>
            ))
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-3 dark:border-slate-800">
          <span className="text-xs text-slate-400">
            {mode === 'multi' ? 'Clique para marcar várias · Enter marca a primeira' : 'Clique para escolher · Enter escolhe a primeira · setas navegam'}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">{visible.length} {visible.length === 1 ? 'filamento' : 'filamentos'}</span>
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700">Cancelar</button>
            {mode === 'multi' && (
              <button
                type="button"
                onClick={confirmMulti}
                disabled={picked.size === 0}
                className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-violet-500 dark:text-slate-950"
              >
                Adicionar ({picked.size})
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
