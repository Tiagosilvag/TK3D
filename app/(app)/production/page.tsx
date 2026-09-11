import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { EditProductionRunForm } from './EditProductionRunForm'
import { ProductionRunsExplorer, type ProductionRunRow } from './ProductionRunsExplorer'
import { getProductionByProduct, getPlates } from '@/actions/productionRuns'
import type { ProductionCostSnapshot } from '@/lib/costing'
import { calculateFilamentPricePerGram } from '@/lib/costing'
import { formatCurrency, getProductionStatusBadge } from '@/lib/format'
import { resolveDateRange } from '@/lib/dateRange'
import type { ProductionStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25
const STATUS_OPTIONS: ProductionStatus[] = ['CONCLUIDA', 'PARCIAL', 'COM_FALHAS', 'CANCELADA']

export default async function ProductionPage({
  searchParams,
}: {
  searchParams: Promise<{
    editId?: string
    from?: string
    to?: string
    page?: string
    productId?: string
    printerId?: string
    plateId?: string
    status?: string
  }>
}) {
  const { editId, from, to, page, productId, printerId, plateId, status } = await searchParams
  const range = resolveDateRange({ from, to })
  const currentPage = Math.max(1, parseInt(page ?? '1', 10) || 1)

  const runsWhere = {
    date: { gte: range.gte, lte: range.lte },
    ...(productId ? { productId } : {}),
    ...(printerId ? { printerId } : {}),
    ...(plateId ? { plateId } : {}),
    ...(status ? { status: status as ProductionStatus } : {}),
  }

  const [runRecords, totalRuns, summaryRuns, products, printers, filamentRecords, editingRunRecord, byProduct, plates] = await Promise.all([
    prisma.productionRun.findMany({
      where: runsWhere,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      include: { product: true, productPart: true },
      skip: (currentPage - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.productionRun.count({ where: runsWhere }),
    // Melhoria "Produção" §1: cards de resumo ("Produções no período",
    // "Custo total", "Falhas no período") refletem TODO o período filtrado,
    // não só a página atual -- select leve, sem includes pesados.
    prisma.productionRun.findMany({ where: runsWhere, select: { quantityFailed: true, costSnapshot: true } }),
    prisma.product.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.printer.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.filament.findMany({ where: { currentStockGrams: { gt: 0 } }, orderBy: { manufacturer: 'asc' } }),
    editId
      ? prisma.productionRun.findUnique({ where: { id: editId }, include: { product: true, printer: true, filament: true, productPart: true, filamentUsages: true } })
      : null,
    // Melhoria "Produção" (reformulação Plate) §5: visões "Por produto" e
    // "Plates" -- independentes do filtro de período/produto/impressora
    // acima (são visões agregadas de TODO o histórico, não uma lista
    // paginada), mesmo padrão de getAssemblyOverview em Meu Estoque.
    getProductionByProduct(),
    getPlates(),
  ])

  const totalPages = Math.max(1, Math.ceil(totalRuns / PAGE_SIZE))

  const summary = {
    count: totalRuns,
    totalCost: summaryRuns.reduce((sum, r) => sum + ((r.costSnapshot as unknown as ProductionCostSnapshot | null)?.total ?? 0), 0),
    totalFailed: summaryRuns.reduce((sum, r) => sum + r.quantityFailed, 0),
  }

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams()
    qs.set('from', range.from)
    qs.set('to', range.to)
    if (productId) qs.set('productId', productId)
    if (printerId) qs.set('printerId', printerId)
    if (plateId) qs.set('plateId', plateId)
    if (status) qs.set('status', status)
    qs.set('page', String(targetPage))
    return `/production?${qs.toString()}`
  }

  function filterHref(params: { productId?: string; printerId?: string; plateId?: string; status?: string }): string {
    const qs = new URLSearchParams()
    qs.set('from', range.from)
    qs.set('to', range.to)
    const nextProductId = 'productId' in params ? params.productId : productId
    const nextPrinterId = 'printerId' in params ? params.printerId : printerId
    const nextPlateId = 'plateId' in params ? params.plateId : plateId
    const nextStatus = 'status' in params ? params.status : status
    if (nextProductId) qs.set('productId', nextProductId)
    if (nextPrinterId) qs.set('printerId', nextPrinterId)
    if (nextPlateId) qs.set('plateId', nextPlateId)
    if (nextStatus) qs.set('status', nextStatus)
    return `/production?${qs.toString()}`
  }

  const editingRun = editingRunRecord
    ? {
        id: editingRunRecord.id,
        productName: editingRunRecord.product.name,
        productPartName: editingRunRecord.productPart?.name ?? null,
        printerName: editingRunRecord.printer.name,
        filamentName: `${editingRunRecord.filament.manufacturer} ${editingRunRecord.filament.colorName} — Rolo #${String(editingRunRecord.filament.rollNumber).padStart(3, '0')}`,
        isMultiFilament: editingRunRecord.filamentUsages.length > 0,
        date: editingRunRecord.date.toISOString().slice(0, 10),
        quantityPlanned: editingRunRecord.quantityPlanned,
        quantitySuccess: editingRunRecord.quantitySuccess,
        quantityFailed: editingRunRecord.quantityFailed,
        gramsUsed: editingRunRecord.gramsUsed.toNumber(),
        gramsWasted: editingRunRecord.gramsWasted.toNumber(),
        timeWastedHours: editingRunRecord.timeWastedHours.toNumber(),
        wasteReason: editingRunRecord.wasteReason,
        notes: editingRunRecord.notes,
      }
    : undefined

  // Melhoria "Produção" (reformulação Plate) §5: volta a ser uma linha por
  // PEÇA/run -- não mais agrupada por batchId, que deixou de representar
  // "1 evento" desde que cada peça tem sua própria data (ver
  // ProductionRunBatchForm). plateId (quando presente) aponta pra uma Plate
  // real, exibida como link "Ver Plate" na explorer.
  const runs: ProductionRunRow[] = runRecords.map((run) => {
    const snapshot = run.costSnapshot as unknown as ProductionCostSnapshot | null
    return {
      id: run.id,
      date: run.date.toISOString(),
      productName: run.product.name,
      partName: run.productPart?.name ?? null,
      plateId: run.plateId,
      quantitySuccess: run.quantitySuccess,
      quantityFailed: run.quantityFailed,
      status: run.status,
      cost: snapshot ? snapshot.total : null,
      cancelReason: run.cancelReason,
    }
  })

  const filaments = filamentRecords.map((f) => ({
    id: f.id,
    name: `${f.manufacturer} ${f.colorName} (${f.material}) — Rolo #${String(f.rollNumber).padStart(3, '0')} (${f.currentStockGrams.toNumber()}g restantes)`,
    pricePerGram: calculateFilamentPricePerGram({ spoolPrice: f.spoolPrice.toNumber(), spoolWeightKg: f.spoolWeightKg.toNumber() }),
  }))

  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Produção e desperdício</h1>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="tk-panel p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Produções no período</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{summary.count}</p>
        </div>
        <div className="tk-panel p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Custo total</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(summary.totalCost)}</p>
        </div>
        <div className="tk-panel p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Falhas no período</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{summary.totalFailed}</p>
        </div>
      </div>

      {/* Melhoria "Produção" §1: um filtro único (Produto + Impressora +
          Período), em vez de dois blocos separados disputando espaço com o
          cadastro (que virou modal). */}
      <form method="get" action="/production" className="mt-4 flex flex-wrap items-end gap-3 tk-panel p-3">
        <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Produto
          <select name="productId" defaultValue={productId ?? ''} className="tk-input-full mt-1">
            <option value="">Todos</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Impressora
          <select name="printerId" defaultValue={printerId ?? ''} className="tk-input-full mt-1">
            <option value="">Todas</option>
            {printers.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
          De
          <input type="date" name="from" defaultValue={range.from} className="tk-input-full mt-1" />
        </label>
        <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Até
          <input type="date" name="to" defaultValue={range.to} className="tk-input-full mt-1" />
        </label>
        <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Plate
          <select name="plateId" defaultValue={plateId ?? ''} className="tk-input-full mt-1">
            <option value="">Todas</option>
            {plates.map((p) => (
              <option key={p.id} value={p.id}>{new Date(p.date).toLocaleDateString('pt-BR')} — {p.printerName}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Status
          <select name="status" defaultValue={status ?? ''} className="tk-input-full mt-1">
            <option value="">Todos</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{getProductionStatusBadge(s).label}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white dark:bg-amber-500 dark:text-slate-950">
          Filtrar
        </button>
        {(productId || printerId || plateId || status) && (
          <Link href={filterHref({ productId: undefined, printerId: undefined, plateId: undefined, status: undefined })} className="text-sm font-medium text-slate-500 underline-offset-2 hover:underline dark:text-slate-400">
            Limpar
          </Link>
        )}
      </form>

      {editingRun && <div className="mt-6"><EditProductionRunForm editingRun={editingRun} /></div>}

      <ProductionRunsExplorer
        runs={runs}
        byProduct={byProduct}
        plates={plates}
        products={products.map((p) => ({ id: p.id, name: p.name }))}
        printers={printers.map((p) => ({ id: p.id, name: p.name }))}
        filaments={filaments}
      />

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-500 dark:text-slate-400">
          <span>Página {currentPage} de {totalPages} ({totalRuns} registros)</span>
          <div className="flex gap-2">
            {currentPage > 1 && (
              <Link href={pageHref(currentPage - 1)} className="rounded-lg px-3 py-1.5 font-medium text-amber-600 hover:underline dark:text-amber-400">
                Anterior
              </Link>
            )}
            {currentPage < totalPages && (
              <Link href={pageHref(currentPage + 1)} className="rounded-lg px-3 py-1.5 font-medium text-amber-600 hover:underline dark:text-amber-400">
                Próxima
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
