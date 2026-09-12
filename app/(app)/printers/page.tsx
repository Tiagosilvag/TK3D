import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { calculatePrinterDepreciationCostPerHour } from '@/lib/costing'
import { formatCurrency } from '@/lib/format'
import { NewPrinterButton } from './NewPrinterButton'
import { deletePrinter, reactivatePrinter, deletePrinterPermanently } from '@/actions/printers'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'
import { DeletePrinterButton } from '@/components/DeletePrinterButton'
import { ActionsMenu } from '@/components/ActionsMenu'

export const dynamic = 'force-dynamic'

interface PrinterCardData {
  id: string
  name: string
  nickname: string | null
  purchasePrice: number
  depreciationHours: number
  avgPowerConsumptionKwh: number
  energyCostPerKwh: number
  maintenanceCostPerHour: number
  depCost: number
  electricityCost: number
  totalCost: number
}

export default async function PrintersPage({
  searchParams,
}: {
  searchParams: Promise<{ editId?: string }>
}) {
  const { editId } = await searchParams

  const [printers, inactivePrinters, editingPrinterRecord] = await Promise.all([
    prisma.printer.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.printer.findMany({ where: { active: false }, orderBy: { name: 'asc' } }),
    editId ? prisma.printer.findUnique({ where: { id: editId } }) : null,
  ])

  const editingPrinter = editingPrinterRecord
    ? {
        id: editingPrinterRecord.id,
        name: editingPrinterRecord.name,
        nickname: editingPrinterRecord.nickname,
        purchasePrice: editingPrinterRecord.purchasePrice.toNumber(),
        depreciationHours: editingPrinterRecord.depreciationHours.toNumber(),
        avgPowerConsumptionKwh: editingPrinterRecord.avgPowerConsumptionKwh.toNumber(),
        energyCostPerKwh: editingPrinterRecord.energyCostPerKwh.toNumber(),
        maintenanceCostPerHour: editingPrinterRecord.maintenanceCostPerHour.toNumber(),
        bambuEnabled: editingPrinterRecord.bambuEnabled,
        bambuSerial: editingPrinterRecord.bambuSerial,
        anycubicEnabled: editingPrinterRecord.anycubicEnabled,
        anycubicPrinterKey: editingPrinterRecord.anycubicPrinterKey,
      }
    : undefined

  const cards: PrinterCardData[] = printers.map((p) => {
    const purchasePrice = p.purchasePrice.toNumber()
    const depreciationHours = p.depreciationHours.toNumber()
    const avgPowerConsumptionKwh = p.avgPowerConsumptionKwh.toNumber()
    const energyCostPerKwh = p.energyCostPerKwh.toNumber()
    const maintenanceCostPerHour = p.maintenanceCostPerHour.toNumber()
    const depCost = calculatePrinterDepreciationCostPerHour({ purchasePrice, depreciationHours })
    const electricityCost = avgPowerConsumptionKwh * energyCostPerKwh
    return {
      id: p.id,
      name: p.name,
      nickname: p.nickname,
      purchasePrice,
      depreciationHours,
      avgPowerConsumptionKwh,
      energyCostPerKwh,
      maintenanceCostPerHour,
      depCost,
      electricityCost,
      totalCost: depCost + electricityCost + maintenanceCostPerHour,
    }
  })

  // Melhoria "Impressoras" item 2: cards de resumo -- escopo nas
  // impressoras ATIVAS (mesmo universo que a lista abaixo mostra por
  // padrão; inativas ficam na seção recolhível, fora da conta).
  const avgCostPerHour = cards.length > 0 ? cards.reduce((sum, c) => sum + c.totalCost, 0) / cards.length : 0
  const totalInvestment = cards.reduce((sum, c) => sum + c.purchasePrice, 0)

  return (
    <div className="tk-page">
      <div className="flex items-center justify-between">
        <h1 className="tk-page-title mb-0">Impressoras</h1>
        <NewPrinterButton editingPrinter={editingPrinter} />
      </div>

      <div className="mb-6 mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="tk-panel p-4">
          <p className="text-sm text-slate-500 dark:text-slate-400">Impressoras ativas</p>
          <p className="mt-1 font-display text-2xl font-semibold text-slate-900 dark:text-slate-100">{cards.length}</p>
        </div>
        <div className="tk-panel p-4">
          <p className="text-sm text-slate-500 dark:text-slate-400">Custo médio R$/h</p>
          <p className="mt-1 font-display text-2xl font-semibold text-slate-900 dark:text-slate-100">{formatCurrency(avgCostPerHour)}</p>
        </div>
        <div className="tk-panel p-4">
          <p className="text-sm text-slate-500 dark:text-slate-400">Investimento total</p>
          <p className="mt-1 font-display text-2xl font-semibold text-slate-900 dark:text-slate-100">{formatCurrency(totalInvestment)}</p>
        </div>
      </div>

      <div className="space-y-3">
        {cards.map((c) => (
          <div key={c.id} className="tk-panel p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-lg text-violet-700 dark:bg-violet-500/10 dark:text-violet-400">
                  🖨️
                </div>
                <div>
                  <p className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">{c.name}</p>
                  {c.nickname && <p className="text-sm text-slate-500 dark:text-slate-400">{c.nickname}</p>}
                </div>
              </div>
              <div className="flex items-start gap-2">
                <div className="text-right">
                  <p className="text-xs text-slate-500 dark:text-slate-400">Custo total</p>
                  <p className="font-display text-lg font-semibold text-violet-600 dark:text-violet-400">{formatCurrency(c.totalCost)}/h</p>
                </div>
                <ActionsMenu>
                  <Link href={`/printers?editId=${c.id}`} className="tk-menu-item">
                    Editar
                  </Link>
                  <ConfirmDeleteForm
                    action={async () => { 'use server'; await deletePrinter(c.id) }}
                    label="Desativar"
                    className="tk-menu-item-danger"
                  />
                  <DeletePrinterButton
                    printerName={c.name}
                    onDelete={async () => { 'use server'; return deletePrinterPermanently(c.id) }}
                  />
                </ActionsMenu>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-sm dark:border-slate-800 sm:grid-cols-5">
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">Preço</p>
                <p className="text-slate-900 dark:text-slate-100">{formatCurrency(c.purchasePrice)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">Vida útil</p>
                <p className="text-slate-900 dark:text-slate-100">{c.depreciationHours} h</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">Depreciação</p>
                <p className="text-slate-900 dark:text-slate-100">{formatCurrency(c.depCost)}/h</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">Energia</p>
                <p className="text-slate-900 dark:text-slate-100">{formatCurrency(c.electricityCost)}/h</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">Manutenção</p>
                <p className="text-slate-900 dark:text-slate-100">{formatCurrency(c.maintenanceCostPerHour)}/h</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {cards.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
          Nenhuma impressora ativa cadastrada.
        </div>
      )}

      {inactivePrinters.length > 0 && (
        <details className="mt-8">
          <summary className="tk-summary">Mostrar inativas ({inactivePrinters.length})</summary>
          <div className="mt-3 space-y-2">
            {inactivePrinters.map((p) => (
              <div key={p.id} className="tk-panel flex items-center justify-between p-3 text-slate-400 dark:text-slate-600">
                <div>
                  <p className="font-medium">{p.name}</p>
                  <p className="text-sm">{formatCurrency(p.purchasePrice.toNumber())}</p>
                </div>
                <ActionsMenu>
                  <form action={async () => { 'use server'; await reactivatePrinter(p.id) }}>
                    <button className="tk-menu-item-success">Reativar</button>
                  </form>
                  <DeletePrinterButton
                    printerName={p.name}
                    onDelete={async () => { 'use server'; return deletePrinterPermanently(p.id) }}
                  />
                </ActionsMenu>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
