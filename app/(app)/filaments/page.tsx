import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { calculateFilamentPricePerGram, getStockStatus } from '@/lib/costing'
import { formatCurrency } from '@/lib/format'
import { FilamentForm } from './FilamentForm'
import { deleteFilament } from '@/actions/filaments'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'
import type { FilamentMaterial } from '@prisma/client'

export const dynamic = 'force-dynamic'

const MATERIAL_FILTERS: { value: FilamentMaterial | undefined; label: string }[] = [
  { value: undefined, label: 'Todos' },
  { value: 'PLA', label: 'PLA' },
  { value: 'PETG', label: 'PETG' },
  { value: 'TPU', label: 'TPU' },
  { value: 'OUTRO', label: 'Outro' },
]

function buildHref(params: { material?: string; stock?: string; color?: string }): string {
  const qs = new URLSearchParams()
  if (params.material) qs.set('material', params.material)
  if (params.stock) qs.set('stock', params.stock)
  if (params.color) qs.set('color', params.color)
  const s = qs.toString()
  return s ? `/filaments?${s}` : '/filaments'
}

function tabClass(isActive: boolean): string {
  return `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
    isActive
      ? 'bg-amber-600 text-white dark:bg-amber-500 dark:text-slate-950'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
  }`
}

export default async function FilamentsPage({
  searchParams,
}: {
  searchParams: Promise<{ material?: string; stock?: string; color?: string; editId?: string }>
}) {
  const { material, stock, color, editId } = await searchParams
  const activeMaterial = (['PLA', 'PETG', 'TPU', 'OUTRO'] as const).includes(material as FilamentMaterial)
    ? (material as FilamentMaterial)
    : undefined
  const activeStock = stock === 'baixo' ? 'baixo' : undefined
  const activeColor = color || undefined

  const [allInStock, inactiveFilaments, distinctColors, editingFilamentRecord] = await Promise.all([
    prisma.filament.findMany({
      where: {
        currentStockGrams: { gt: 0 },
        ...(activeMaterial ? { material: activeMaterial } : {}),
        ...(activeColor ? { colorName: activeColor } : {}),
      },
      orderBy: [{ manufacturer: 'asc' }, { colorName: 'asc' }],
    }),
    prisma.filament.findMany({ where: { currentStockGrams: { lte: 0 } }, orderBy: [{ manufacturer: 'asc' }, { colorName: 'asc' }] }),
    prisma.filament.findMany({
      where: { currentStockGrams: { gt: 0 } },
      distinct: ['colorName'],
      select: { colorName: true },
      orderBy: { colorName: 'asc' },
    }),
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

  const rows = allInStock
    .map((f) => {
      const initialStockGrams = f.initialStockGrams.toNumber()
      const currentStockGrams = f.currentStockGrams.toNumber()
      const percentRemaining = initialStockGrams > 0 ? (currentStockGrams / initialStockGrams) * 100 : 0
      const pricePerGram = calculateFilamentPricePerGram({
        spoolPrice: f.spoolPrice.toNumber(),
        spoolWeightKg: f.spoolWeightKg.toNumber(),
      })
      return { filament: f, currentStockGrams, percentRemaining, pricePerGram, status: getStockStatus(percentRemaining) }
    })
    .filter((row) => (activeStock === 'baixo' ? row.percentRemaining >= 10 && row.percentRemaining <= 30 : true))

  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Filamentos</h1>
      <FilamentForm key={editingFilament?.id ?? 'new'} editingFilament={editingFilament} />

      <div className="mb-2 mt-6 flex flex-wrap gap-1">
        {MATERIAL_FILTERS.map((f) => (
          <Link
            key={f.label}
            href={buildHref({ material: f.value, stock: activeStock, color: activeColor })}
            className={tabClass(activeMaterial === f.value)}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <div className="mb-2 flex flex-wrap gap-1">
        <Link href={buildHref({ material: activeMaterial, color: activeColor })} className={tabClass(!activeStock)}>
          Todas
        </Link>
        <Link href={buildHref({ material: activeMaterial, stock: 'baixo', color: activeColor })} className={tabClass(activeStock === 'baixo')}>
          Estoque baixo
        </Link>
      </div>

      {distinctColors.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1">
          <Link href={buildHref({ material: activeMaterial, stock: activeStock })} className={tabClass(!activeColor)}>
            Todas as cores
          </Link>
          {distinctColors.map((c) => (
            <Link
              key={c.colorName}
              href={buildHref({ material: activeMaterial, stock: activeStock, color: c.colorName })}
              className={tabClass(activeColor === c.colorName)}
            >
              {c.colorName}
            </Link>
          ))}
        </div>
      )}

      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className="tk-table-head-row">
            <th className="py-2"></th>
            <th>Marca</th>
            <th>Material</th>
            <th>Estoque atual (g)</th>
            <th>% restante</th>
            <th>Preço do rolo</th>
            <th>R$/g</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ filament: f, currentStockGrams, percentRemaining, pricePerGram, status }) => {
            const priceMissing = pricePerGram <= 0
            return (
              <tr key={f.id} className="tk-row">
                <td className="py-2">
                  <span style={{ background: f.colorHex }} className="inline-block h-3 w-3 rounded-full" />
                </td>
                <td>{f.manufacturer} {f.colorName} — Rolo #{String(f.rollNumber).padStart(3, '0')}</td>
                <td>{f.material}</td>
                <td>{currentStockGrams}g</td>
                <td>{percentRemaining.toFixed(1)}%</td>
                <td>{formatCurrency(f.spoolPrice.toNumber())}</td>
                <td>
                  {priceMissing ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                      ⚠️ Preço não informado
                    </span>
                  ) : (
                    <>R$ {pricePerGram.toFixed(4)}</>
                  )}
                </td>
                <td>{status.emoji} {status.label}</td>
                <td>
                  <div className="flex items-center gap-3">
                    <Link href={`/filaments?editId=${f.id}`} className="text-amber-600 hover:underline dark:text-amber-400">
                      Editar
                    </Link>
                    <ConfirmDeleteForm action={async () => { 'use server'; await deleteFilament(f.id) }} />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {rows.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
          Nenhum filamento encontrado com esses filtros.
        </div>
      )}

      {inactiveFilaments.length > 0 && (
        <details className="mt-8">
          <summary className="tk-summary">Filamentos esgotados ({inactiveFilaments.length})</summary>
          <table className="mt-3 w-full text-sm">
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
