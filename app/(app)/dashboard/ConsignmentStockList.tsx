'use client'
import { useState } from 'react'
import { VariacaoPecas } from '@/components/VariacaoPecas'
import type { PartnerStock } from '@/lib/dashboard'

const integer = new Intl.NumberFormat('pt-BR')

// Estoque em consignação: 1 linha por produto (saldo somado), expansível
// pra mostrar cada variação com a mesma exibição de VariacaoPecas usada em
// Pedidos. Produto com 1 variação só não tem seta nem expansão.
export function ConsignmentStockList({ partners }: { partners: PartnerStock[] }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())

  const needle = query.trim().toLowerCase()
  const visible = partners
    .map((p) => ({ ...p, products: p.products.filter((pr) => !needle || pr.productName.toLowerCase().includes(needle)) }))
    .filter((p) => p.products.length > 0)

  const expandableKeys = visible.flatMap((p) => p.products.filter((pr) => pr.variants.length > 1).map((pr) => `${p.partnerId}:${pr.productId}`))

  function toggle(key: string) {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar produto…"
          className="tk-input-full w-full sm:w-64"
        />
        <button type="button" onClick={() => setOpen(new Set(expandableKeys))} className="text-xs font-medium text-violet-600 hover:underline dark:text-violet-400">
          Expandir tudo
        </button>
        <button type="button" onClick={() => setOpen(new Set())} className="text-xs font-medium text-violet-600 hover:underline dark:text-violet-400">
          Recolher tudo
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
          Nenhum produto encontrado.
        </div>
      ) : (
        visible.map((partner) => (
          <div key={partner.partnerId} className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-5 py-3 dark:border-slate-800 dark:bg-slate-800/60">
              <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Estoque em consignação · {partner.partnerName}</h3>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {integer.format(partner.products.length)} {partner.products.length === 1 ? 'produto' : 'produtos'} · {integer.format(partner.products.reduce((s, p) => s + p.remaining, 0))} peças
              </span>
            </div>
            <ul>
              {partner.products.map((product) => {
                const key = `${partner.partnerId}:${product.productId}`
                const expandable = product.variants.length > 1
                const isOpen = open.has(key)
                return (
                  <li key={key} className="border-b border-slate-100 last:border-b-0 dark:border-slate-800">
                    <div className="flex items-center justify-between gap-3 px-5 py-3">
                      {expandable ? (
                        <button type="button" onClick={() => toggle(key)} aria-expanded={isOpen} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                          <span className={`text-xs text-slate-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}>▸</span>
                          <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">{product.productName}</span>
                        </button>
                      ) : (
                        <span className="min-w-0 flex-1 truncate pl-5 text-sm font-medium text-slate-800 dark:text-slate-200">{product.productName}</span>
                      )}
                      {expandable && <span className="shrink-0 text-xs text-slate-400 dark:text-slate-500">{product.variants.length} variações</span>}
                      <span className="w-10 shrink-0 text-right text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">{integer.format(product.remaining)}</span>
                    </div>
                    {expandable && isOpen && (
                      <ul className="divide-y divide-slate-100 bg-slate-50/60 dark:divide-slate-800 dark:bg-slate-800/30">
                        {product.variants.map((variant, i) => (
                          <li key={`${variant.key ?? 'sem-cor'}-${i}`} className="flex items-start justify-between gap-3 py-3 pl-10 pr-5">
                            <div className="min-w-0 flex-1">
                              {variant.attrs.length > 0 ? (
                                <VariacaoPecas attrs={variant.attrs} />
                              ) : (
                                <span className="text-xs text-slate-500 dark:text-slate-400">{variant.label ?? 'Sem cor registrada'}</span>
                              )}
                            </div>
                            <span className="w-10 shrink-0 text-right text-sm tabular-nums text-slate-700 dark:text-slate-300">{integer.format(variant.remaining)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        ))
      )}
    </div>
  )
}
