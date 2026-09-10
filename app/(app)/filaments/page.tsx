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
                    <ConfirmDeleteForm action={async () => { 'use server'; await deleteFilament(f.id) }} />
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
