'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { AdjustStockButton } from '@/components/AdjustStockButton'
import { ActionsMenu } from '@/components/ActionsMenu'
import { StockAdjustmentHistoryButton, type AdjustmentEntry } from './StockAdjustmentHistoryButton'
import { VariantsModal } from './VariantsModal'
import { DeleteProductionButton } from './DeleteProductionButton'

export interface StockVariantRow {
  key: string
  label: string
  colorHex: string | null
  available: number
  // null = não aplicável/não atribuível a esta variante (bucket "Sem cor
  // registrada") -- nunca 0 inventado quando na verdade é desconhecido.
  readyToAssemble: number | null
  consignado: number
  sold: number
}

export interface StockRow {
  productId: string
  productName: string
  category: string
  isComposite: boolean
  needsAssembly: boolean
  coverPhotoId: string | null
  available: number
  // null = produto não passa por Montagem (item único sem componente) --
  // mostra "-" em vez de 0, que significaria "passa por montagem mas não
  // tem nada pronto".
  readyToAssemble: number | null
  consignado: number
  soldDirect: number
  lowStock: boolean
  // Vazio = produto sem variação de cor conhecida -- linha mostra "Ver
  // detalhes" em vez do botão "Ver variações" (spec Redesign "Estoque
  // moderno" §9).
  variants: StockVariantRow[]
  adjustments: AdjustmentEntry[]
}

type Chip = 'ALL' | 'WITH_STOCK' | 'NO_STOCK' | 'LOW_STOCK' | 'READY_TO_ASSEMBLE' | 'CONSIGNED'
type ProductTypeFilter = 'ALL' | 'SIMPLE' | 'COMPOSITE'
type SortOption = 'NAME' | 'MOST_STOCK' | 'LEAST_STOCK' | 'MOST_SOLD'

const PAGE_SIZE = 10

function chipClass(active: boolean): string {
  return `rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
    active
      ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white dark:from-violet-500 dark:to-fuchsia-500 dark:text-slate-950'
      : 'border border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
  }`
}

// Redesign "Estoque moderno" §6-8: número neutro quando 0 (sem vermelho/
// cor forte -- só "disponível" ganha destaque quando > 0), com um ponto de
// atenção discreto quando a linha está com pouco estoque.
function Quantity({ value, emphasis, lowStock }: { value: number; emphasis?: boolean; lowStock?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 tabular-nums ${emphasis && value > 0 ? 'font-semibold text-emerald-600 dark:text-emerald-400' : value > 0 ? 'font-medium text-slate-700 dark:text-slate-200' : 'text-slate-400 dark:text-slate-500'}`}>
      {value}
      {lowStock && (
        <span title="Estoque baixo" className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
      )}
    </span>
  )
}

function ListIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <line x1="7" y1="5" x2="17" y2="5" />
      <line x1="7" y1="10" x2="17" y2="10" />
      <line x1="7" y1="15" x2="17" y2="15" />
      <circle cx="3.5" cy="5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="3.5" cy="10" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="3.5" cy="15" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function StockExplorer({ rows }: { rows: StockRow[] }) {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [productType, setProductType] = useState<ProductTypeFilter>('ALL')
  const [chip, setChip] = useState<Chip>('ALL')
  const [sort, setSort] = useState<SortOption>('NAME')
  const [page, setPage] = useState(1)
  const [viewingProduct, setViewingProduct] = useState<StockRow | null>(null)

  const categories = useMemo(() => [...new Set(rows.map((r) => r.category))].sort(), [rows])

  const totalProducts = rows.length
  const totalAvailable = rows.reduce((sum, r) => sum + r.available, 0)
  const totalReadyToAssemble = rows.reduce((sum, r) => sum + (r.readyToAssemble ?? 0), 0)
  const totalConsigned = rows.reduce((sum, r) => sum + r.consignado, 0)

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase()
    const list = rows.filter((r) => {
      if (category && r.category !== category) return false
      if (productType === 'SIMPLE' && r.isComposite) return false
      if (productType === 'COMPOSITE' && !r.isComposite) return false
      if (term && !r.productName.toLowerCase().includes(term)) return false
      if (chip === 'WITH_STOCK' && r.available <= 0) return false
      if (chip === 'NO_STOCK' && r.available > 0) return false
      if (chip === 'LOW_STOCK' && !r.lowStock) return false
      if (chip === 'READY_TO_ASSEMBLE' && !(r.readyToAssemble && r.readyToAssemble > 0)) return false
      if (chip === 'CONSIGNED' && r.consignado <= 0) return false
      return true
    })
    const sorted = [...list]
    if (sort === 'MOST_STOCK') sorted.sort((a, b) => b.available - a.available)
    else if (sort === 'LEAST_STOCK') sorted.sort((a, b) => a.available - b.available)
    else if (sort === 'MOST_SOLD') sorted.sort((a, b) => b.soldDirect - a.soldDirect)
    else sorted.sort((a, b) => a.productName.localeCompare(b.productName))
    return sorted
  }, [rows, search, category, productType, chip, sort])

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageRows = filteredRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  function changeFilter(fn: () => void) {
    fn()
    setPage(1)
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="tk-panel p-3">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total de produtos</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{totalProducts}</p>
        </div>
        <div className="tk-panel p-3">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Disponíveis</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{totalAvailable}</p>
        </div>
        <div className="tk-panel p-3">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Prontas p/ montar</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{totalReadyToAssemble}</p>
        </div>
        <div className="tk-panel p-3">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Consignados</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{totalConsigned}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => changeFilter(() => setSearch(e.target.value))}
          placeholder="Buscar produto..."
          className="tk-input min-w-[220px] flex-1"
        />
        <select value={category} onChange={(e) => changeFilter(() => setCategory(e.target.value))} className="tk-input">
          <option value="">Todas categorias</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select value={productType} onChange={(e) => changeFilter(() => setProductType(e.target.value as ProductTypeFilter))} className="tk-input">
          <option value="ALL">Todos os tipos</option>
          <option value="SIMPLE">Peça única</option>
          <option value="COMPOSITE">Composto</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortOption)} className="tk-input">
          <option value="NAME">Ordenar: Nome</option>
          <option value="MOST_STOCK">Ordenar: Maior estoque</option>
          <option value="LEAST_STOCK">Ordenar: Menor estoque</option>
          <option value="MOST_SOLD">Ordenar: Mais vendidos</option>
        </select>
      </div>

      <div className="mb-4 mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => changeFilter(() => setChip('ALL'))} className={chipClass(chip === 'ALL')}>Todos</button>
        <button type="button" onClick={() => changeFilter(() => setChip('WITH_STOCK'))} className={chipClass(chip === 'WITH_STOCK')}>Com estoque</button>
        <button type="button" onClick={() => changeFilter(() => setChip('NO_STOCK'))} className={chipClass(chip === 'NO_STOCK')}>Sem estoque</button>
        <button type="button" onClick={() => changeFilter(() => setChip('LOW_STOCK'))} className={chipClass(chip === 'LOW_STOCK')}>Estoque baixo</button>
        <button type="button" onClick={() => changeFilter(() => setChip('READY_TO_ASSEMBLE'))} className={chipClass(chip === 'READY_TO_ASSEMBLE')}>Prontas para montar</button>
        <button type="button" onClick={() => changeFilter(() => setChip('CONSIGNED'))} className={chipClass(chip === 'CONSIGNED')}>Consignados</button>
      </div>

      {pageRows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
          Nenhum produto encontrado com esses filtros.
        </div>
      ) : (
        <div className="tk-panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="tk-table-head-row sticky top-0 z-10 bg-white dark:bg-slate-900">
                <th className="py-2.5 pl-3">Produto</th>
                <th>Disponível</th>
                <th>Prontas p/ montar</th>
                <th>Consignado</th>
                <th>Vendido</th>
                <th className="pr-3">Ações</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={r.productId} className="tk-row">
                  <td className="py-2 pl-3">
                    <div className="flex items-center gap-2.5">
                      <div className="h-8 w-8 shrink-0 overflow-hidden rounded-md bg-slate-100 dark:bg-slate-800">
                        {r.coverPhotoId ? (
                          // eslint-disable-next-line @next/next/no-img-element -- served from our own DB-backed route, não é asset estático/otimizável
                          <img src={`/api/photos/${r.coverPhotoId}`} alt={r.productName} className="h-full w-full object-cover" />
                        ) : null}
                      </div>
                      <div className="min-w-0">
                        <Link href={`/products/${r.productId}`} className="block truncate font-medium text-slate-900 hover:text-violet-700 hover:underline dark:text-slate-100 dark:hover:text-violet-400">
                          {r.productName}
                        </Link>
                        <p className="truncate text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">
                          {r.category} · {r.isComposite ? 'Composto' : 'Peça única'}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td><Quantity value={r.available} emphasis lowStock={r.lowStock} /></td>
                  <td>
                    {r.readyToAssemble == null ? (
                      <span className="text-slate-400 dark:text-slate-500">-</span>
                    ) : r.readyToAssemble > 0 ? (
                      <Link href={`/assembly?productId=${r.productId}`} className="font-medium text-violet-600 hover:underline dark:text-violet-400">
                        {r.readyToAssemble} montar &rarr;
                      </Link>
                    ) : (
                      <Quantity value={r.readyToAssemble} />
                    )}
                  </td>
                  <td><Quantity value={r.consignado} /></td>
                  <td><Quantity value={r.soldDirect} /></td>
                  <td className="pr-3">
                    <div className="flex items-center gap-1">
                      {r.variants.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => setViewingProduct(r)}
                          className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          <ListIcon /> Ver variações
                        </button>
                      ) : (
                        <Link href={`/products/${r.productId}`} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                          Ver detalhes
                        </Link>
                      )}
                      <ActionsMenu>
                        <Link href={`/sales?productId=${r.productId}`} className="text-violet-600 hover:underline dark:text-violet-400">
                          Registrar venda direta
                        </Link>
                        <Link href={`/consignment/deliveries?productId=${r.productId}`} className="text-violet-600 hover:underline dark:text-violet-400">
                          Entregar a parceiro
                        </Link>
                        <hr className="w-full border-slate-200 dark:border-slate-700" />
                        <AdjustStockButton resourceType="PRODUCT" resourceId={r.productId} resourceName={r.productName} currentQuantity={r.available} />
                        <StockAdjustmentHistoryButton productName={r.productName} adjustments={r.adjustments} />
                        <hr className="w-full border-slate-200 dark:border-slate-700" />
                        <DeleteProductionButton productId={r.productId} productName={r.productName} />
                      </ActionsMenu>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {filteredRows.length > 0 && (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-500 dark:text-slate-400">
          <span>Mostrando {(currentPage - 1) * PAGE_SIZE + 1}-{Math.min(currentPage * PAGE_SIZE, filteredRows.length)} de {filteredRows.length}</span>
          <div className="flex gap-2">
            <button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} className="rounded-lg px-3 py-1.5 font-medium text-violet-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-300 disabled:no-underline dark:text-violet-400 dark:disabled:text-slate-600">
              ←
            </button>
            <button type="button" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)} className="rounded-lg px-3 py-1.5 font-medium text-violet-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-300 disabled:no-underline dark:text-violet-400 dark:disabled:text-slate-600">
              →
            </button>
          </div>
        </div>
      )}

      <VariantsModal product={viewingProduct} onClose={() => setViewingProduct(null)} />
    </div>
  )
}
