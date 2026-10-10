'use client'
import { useMemo, useState } from 'react'
import { VariacaoPecas } from '@/components/VariacaoPecas'
import { CustomVariantPicker, type CustomVariantChoice } from './CustomVariantPicker'
import { chipClass } from '@/components/Chip'
import type { OrderProductVariantOption } from './OrderForm'

// Redesign "Variação de peças em Pedidos" §2: função pura de filtro
// (peça + cor combinados, ex. "BASE + Preto" só mostra variação com Preto
// na Base) -- extraída pra ser testável isoladamente (tests/unit).
// Sem peça selecionada, procura a cor em QUALQUER peça da variante; com
// peça selecionada, só na(s) peça(s) daquele nome (normalmente 1, já que
// toda variante do mesmo produto compartilha a mesma ficha técnica).
export function matchesFilter(attrs: OrderProductVariantOption['attrs'], part: string, color: string): boolean {
  if (!part && !color) return true
  const relevantAttrs = part ? attrs.filter((a) => a.name === part) : attrs
  if (part && relevantAttrs.length === 0) return false
  if (!color) return true
  return relevantAttrs.some((a) => a.colors.some((c) => c.name === color))
}

// Redesign "Variação de peças em Pedidos" §2: substitui o antigo bloco de
// chips + "✦ Personalizar cores" (texto corrido) por uma lista de cards,
// cada um mostrando a variação no formato padrão (VariacaoPecas) + selo de
// estoque. Filtros por peça/cor no topo, disponível primeiro. "+ Criar
// nova variação" continua sendo o CustomVariantPicker existente (agora com
// prévia ao vivo, ver CustomVariantPicker.tsx).
export function VariantCardPicker({
  productId,
  variants,
  selectedKey,
  onSelect,
  onConfirmCustom,
}: {
  productId: string
  variants: OrderProductVariantOption[]
  selectedKey: string | null
  onSelect: (v: OrderProductVariantOption) => void
  onConfirmCustom: (choice: CustomVariantChoice) => void
}) {
  const [partFilter, setPartFilter] = useState('')
  const [colorFilter, setColorFilter] = useState('')

  const partNames = useMemo(() => {
    const names = new Set<string>()
    for (const v of variants) for (const a of v.attrs) if (a.name) names.add(a.name)
    return [...names]
  }, [variants])

  const colorNames = useMemo(() => {
    const names = new Set<string>()
    for (const v of variants) for (const a of v.attrs) for (const c of a.colors) names.add(c.name)
    return [...names]
  }, [variants])

  const visibleVariants = useMemo(() => {
    return variants
      .filter((v) => matchesFilter(v.attrs, partFilter, colorFilter))
      .sort((a, b) => b.available - a.available || a.label.localeCompare(b.label))
  }, [variants, partFilter, colorFilter])

  return (
    <div className="mt-1">
      {(partNames.length > 0 || colorNames.length > 0) && variants.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-2">
          <select value={partFilter} onChange={(e) => setPartFilter(e.target.value)} className="tk-input text-xs">
            <option value="">Filtrar por peça</option>
            {partNames.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <select value={colorFilter} onChange={(e) => setColorFilter(e.target.value)} className="tk-input text-xs">
            <option value="">Filtrar por cor</option>
            {colorNames.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <CustomVariantPicker
          key={productId}
          productId={productId}
          onConfirm={onConfirmCustom}
          trigger={<button type="button" className={chipClass(false)}>+ Criar nova variação</button>}
        />
      </div>

      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {visibleVariants.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => onSelect(v)}
            className={`rounded-lg border p-2.5 text-left transition-colors ${
              selectedKey === v.key
                ? 'border-violet-400 bg-violet-50 dark:border-violet-500 dark:bg-violet-500/10'
                : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600'
            }`}
          >
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="truncate text-xs font-medium text-slate-900 dark:text-slate-100">{v.label}</span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                v.available > 0
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                  : 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
              }`}>
                {v.available > 0 ? `${v.available} disponíveis` : 'Sob encomenda'}
              </span>
            </div>
            <VariacaoPecas attrs={v.attrs} />
          </button>
        ))}
      </div>

      {visibleVariants.length === 0 && variants.length > 0 && (
        <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">Nenhuma variação bate com esse filtro.</p>
      )}
    </div>
  )
}
