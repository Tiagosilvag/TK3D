import { prisma } from '@/lib/prisma'
import { calculateFilamentPricePerGram } from '@/lib/costing'
import { deleteFilament } from '@/actions/filaments'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'
import { FilamentsExplorer, type FilamentRow } from './FilamentsExplorer'

export const dynamic = 'force-dynamic'

export default async function FilamentsPage({
  searchParams,
}: {
  searchParams: Promise<{ editId?: string }>
}) {
  const { editId } = await searchParams

  const [allInStock, inactiveFilaments, editingFilamentRecord] = await Promise.all([
    prisma.filament.findMany({ where: { currentStockGrams: { gt: 0 } }, orderBy: [{ manufacturer: 'asc' }, { colorName: 'asc' }] }),
    prisma.filament.findMany({ where: { currentStockGrams: { lte: 0 } }, orderBy: [{ manufacturer: 'asc' }, { colorName: 'asc' }] }),
    editId ? prisma.filament.findUnique({ where: { id: editId } }) : null,
  ])

  // Melhoria "Histórico de consumo": filamento já tem consumo totalmente
  // rastreado via ProductionRun (ver lib/reports.ts#getFilamentConsumptionHistory
  // pro raciocínio completo) -- busca todos os lotes relevantes pra
  // qualquer filamento ativo NUMA query só (em vez de 1 por filamento,
  // evitando N+1), depois agrupa em memória. `filamentUsages: true` (sem
  // filtro) porque um lote multi-filamento pode ter componentes de VÁRIOS
  // filamentos ativos diferentes ao mesmo tempo -- filtra por filamento no
  // loop abaixo, não na query.
  const activeFilamentIds = allInStock.map((f) => f.id)
  const relevantRuns = activeFilamentIds.length > 0
    ? await prisma.productionRun.findMany({
        where: {
          status: { not: 'CANCELADA' },
          OR: [
            { filamentId: { in: activeFilamentIds } },
            { filamentUsages: { some: { filamentId: { in: activeFilamentIds } } } },
          ],
        },
        include: {
          product: { select: { name: true } },
          productPart: { select: { name: true } },
          filamentUsages: true,
        },
        orderBy: { date: 'desc' },
      })
    : []

  const historyByFilament = new Map<string, NonNullable<FilamentRow['consumptionHistory']>>()
  function pushHistoryEntry(filamentId: string, entry: NonNullable<FilamentRow['consumptionHistory']>[number]) {
    const list = historyByFilament.get(filamentId) ?? []
    list.push(entry)
    historyByFilament.set(filamentId, list)
  }
  for (const run of relevantRuns) {
    if (run.filamentUsages.length > 0) {
      for (const usage of run.filamentUsages) {
        if (!activeFilamentIds.includes(usage.filamentId)) continue
        pushHistoryEntry(usage.filamentId, {
          id: `${run.id}-${usage.id}`,
          date: run.date.toISOString(),
          productName: run.product.name,
          partName: run.productPart?.name ?? null,
          gramsUsed: usage.gramsUsed.toNumber(),
          gramsWasted: usage.gramsWasted.toNumber(),
        })
      }
    } else if (activeFilamentIds.includes(run.filamentId)) {
      pushHistoryEntry(run.filamentId, {
        id: run.id,
        date: run.date.toISOString(),
        productName: run.product.name,
        partName: run.productPart?.name ?? null,
        gramsUsed: run.gramsUsed.toNumber(),
        gramsWasted: run.gramsWasted.toNumber(),
      })
    }
  }

  const editingFilament = editingFilamentRecord
    ? {
        id: editingFilamentRecord.id,
        manufacturer: editingFilamentRecord.manufacturer,
        material: editingFilamentRecord.material,
        colorName: editingFilamentRecord.colorName,
        colorHex: editingFilamentRecord.colorHex,
        spoolWeightKg: editingFilamentRecord.spoolWeightKg.toNumber(),
        spoolPrice: editingFilamentRecord.spoolPrice.toNumber(),
      }
    : undefined

  // Decimal/Date do Prisma não são serializáveis como prop de Server pra
  // Client Component -- tudo convertido pra number aqui antes de passar
  // pra FilamentsExplorer (que faz busca/filtro/ordenação no navegador).
  const rows: FilamentRow[] = allInStock.map((f) => {
    const initialStockGrams = f.initialStockGrams.toNumber()
    const currentStockGrams = f.currentStockGrams.toNumber()
    const percentRemaining = initialStockGrams > 0 ? (currentStockGrams / initialStockGrams) * 100 : 0
    const spoolPrice = f.spoolPrice.toNumber()
    const spoolWeightKg = f.spoolWeightKg.toNumber()
    return {
      id: f.id,
      manufacturer: f.manufacturer,
      material: f.material,
      colorName: f.colorName,
      colorHex: f.colorHex,
      rollNumber: f.rollNumber,
      currentStockGrams,
      spoolPrice,
      spoolWeightKg,
      percentRemaining,
      pricePerGram: calculateFilamentPricePerGram({ spoolPrice, spoolWeightKg }),
      consumptionHistory: historyByFilament.get(f.id) ?? [],
    }
  })

  return (
    <div className="tk-page">
      <FilamentsExplorer rows={rows} editingFilament={editingFilament} />

      {inactiveFilaments.length > 0 && (
        <details className="mt-8">
          <summary className="tk-summary">Filamentos esgotados ({inactiveFilaments.length})</summary>
          <table className="tk-table-zebra mt-3 w-full text-sm">
            <thead>
              <tr className="tk-table-head-row">
                <th className="py-2"></th>
                <th>Marca</th>
                <th>Material</th>
                <th>Estoque atual (g)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {inactiveFilaments.map((f) => (
                <tr key={f.id} className="tk-row-inactive">
                  <td className="py-2">
                    <span style={{ background: f.colorHex }} className="inline-block h-3 w-3 rounded-full" />
                  </td>
                  <td>{f.manufacturer} {f.colorName} — Rolo #{String(f.rollNumber).padStart(3, '0')}</td>
                  <td>{f.material}</td>
                  <td>{f.currentStockGrams.toNumber()}g</td>
                  <td>
                    <ConfirmDeleteForm action={async () => { 'use server'; return await deleteFilament(f.id) }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  )
}
