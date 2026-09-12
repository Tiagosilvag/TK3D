'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { formatCurrency } from '@/lib/format'
import { ProductForm } from './ProductForm'

export interface ProductCardData {
  id: string
  name: string
  category: string
  partsCount: number
  colorsCount: number
  coverPhotoId: string | null
  costPrice: number
  mercadoLivrePrice: number | null
  shopeePrice: number | null
}

type PrinterOption = { id: string; name: string; costPerHour: number }
type FilamentOption = { id: string; name: string; pricePerGram: number; colorHex: string | null }

// Melhoria "Produtos" §1/§2: listagem vira grade de cards horizontais (foto
// à esquerda, informação à direita) em vez de tabela -- cadastro vira modal
// "Novo produto" (reaproveita o mesmo ProductForm que a página de detalhe
// usa inline pra editar, só que dentro de um <dialog>). Card mostra só
// ficha técnica/variações (nome, categoria, N peças/cores, 3 preços) --
// estoque é assunto de "Meu Estoque", propositalmente fora daqui (CLAUDE.md).
export function ProductsExplorer({
  products,
  printers,
  filaments,
  laborCostPerHour,
}: {
  products: ProductCardData[]
  printers: PrinterOption[]
  filaments: FilamentOption[]
  laborCostPerHour: number
}) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (modalOpen && !dialog.open) dialog.showModal()
    if (!modalOpen && dialog.open) dialog.close()
  }, [modalOpen])

  const categories = useMemo(() => [...new Set(products.map((p) => p.category))].sort(), [products])

  const visibleProducts = useMemo(() => {
    const term = search.trim().toLowerCase()
    return products.filter((p) => {
      if (categoryFilter && p.category !== categoryFilter) return false
      if (term && !p.name.toLowerCase().includes(term)) return false
      return true
    })
  }, [products, search, categoryFilter])

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="tk-page-title mb-0">Produtos</h1>
        <button type="button" onClick={() => setModalOpen(true)} className="tk-btn-primary px-4">
          + Novo produto
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome"
          className="tk-input min-w-[240px] flex-1"
        />
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="tk-input">
          <option value="">Todas as categorias</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {visibleProducts.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
          Nenhum produto encontrado com esses filtros.
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visibleProducts.map((p) => (
            <Link
              key={p.id}
              href={`/products/${p.id}`}
              className="tk-panel flex gap-3 p-3 hover:border-violet-400 dark:hover:border-violet-500"
            >
              <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
                {p.coverPhotoId ? (
                  // eslint-disable-next-line @next/next/no-img-element -- served from our own DB-backed route, not a static/optimizable asset
                  <img src={`/api/photos/${p.coverPhotoId}`} alt={p.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-slate-400 dark:text-slate-600">Sem foto</div>
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col justify-between">
                <div>
                  <p className="truncate font-medium text-slate-900 dark:text-slate-100">{p.name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {p.category} · {p.partsCount} peça{p.partsCount === 1 ? '' : 's'} · {p.colorsCount} {p.colorsCount === 1 ? 'cor' : 'cores'}
                  </p>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <p className="text-slate-400 dark:text-slate-500">Custo</p>
                    <p className="font-medium text-slate-900 dark:text-slate-100">{formatCurrency(p.costPrice)}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 dark:text-slate-500">Mercado Livre</p>
                    <p className="font-medium text-slate-900 dark:text-slate-100">{p.mercadoLivrePrice != null ? formatCurrency(p.mercadoLivrePrice) : '—'}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 dark:text-slate-500">Shopee</p>
                    <p className="font-medium text-slate-900 dark:text-slate-100">{p.shopeePrice != null ? formatCurrency(p.shopeePrice) : '—'}</p>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <dialog
        ref={dialogRef}
        onClose={() => setModalOpen(false)}
        className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        <div className="grid gap-3 p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-base font-semibold">Novo produto</h3>
            <button type="button" onClick={() => setModalOpen(false)} aria-label="Fechar" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">✕</button>
          </div>
          <ProductForm
            printers={printers}
            filaments={filaments}
            laborCostPerHour={laborCostPerHour}
            showLiveCostPanel={false}
            onSuccess={() => { setModalOpen(false); router.refresh() }}
          />
        </div>
      </dialog>
    </div>
  )
}
