import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { formatCurrency } from '@/lib/format'
import {
  calculatePrinterDepreciationCostPerHour,
  calculatePrinterMaintenanceCostPerHour,
  calculateFilamentPricePerGram,
} from '@/lib/costing'
import { ProductForm } from './ProductForm'
import { deleteProduct, getProductCostBreakdown } from '@/actions/products'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'

export const dynamic = 'force-dynamic'

export default async function ProductsPage() {
  const [products, printers, filaments, packagingItems, settings] = await Promise.all([
    prisma.product.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.printer.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.filament.findMany({ where: { currentStockGrams: { gt: 0 } }, orderBy: { manufacturer: 'asc' } }),
    prisma.packagingItem.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.settings.findUniqueOrThrow({ where: { id: 1 } }),
  ])

  const breakdowns = await Promise.all(products.map((p) => getProductCostBreakdown(p.id)))

  const annualMaintenancePercent = settings.annualMaintenancePercent.toNumber()
  const annualUsageHours = settings.annualUsageHours.toNumber()
  const energyCostPerKwh = settings.energyCostPerKwh.toNumber()

  const printerOptions = printers.map((p) => {
    const purchasePrice = p.purchasePrice.toNumber()
    const depreciationHours = p.depreciationHours.toNumber()
    const costPerHour =
      calculatePrinterDepreciationCostPerHour({ purchasePrice, depreciationHours }) +
      calculatePrinterMaintenanceCostPerHour({ purchasePrice, annualMaintenancePercent, annualUsageHours }) +
      p.avgPowerConsumptionKwh.toNumber() * energyCostPerKwh
    return { id: p.id, name: p.name, costPerHour }
  })

  const filamentOptions = filaments.map((f) => ({
    id: f.id,
    name: `${f.manufacturer} ${f.colorName} (${f.material}) — Rolo #${String(f.rollNumber).padStart(3, '0')}`,
    pricePerGram: calculateFilamentPricePerGram({ spoolPrice: f.spoolPrice.toNumber(), spoolWeightKg: f.spoolWeightKg.toNumber() }),
  }))

  const packagingOptions = packagingItems.map((p) => ({ id: p.id, name: p.name, unitCost: p.unitCost.toNumber() }))

  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Produtos</h1>
      <ProductForm
        printers={printerOptions}
        filaments={filamentOptions}
        packagingItems={packagingOptions}
        laborCostPerHour={settings.laborCostPerHour.toNumber()}
      />
      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="tk-table-head-row">
            <th className="py-2">Nome</th>
            <th>Categoria</th>
            <th>Custo Final</th>
            <th>Preço Sugerido</th>
            <th>Preço Marketplace</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {products.map((p, i) => {
            const breakdown = breakdowns[i]
            return (
              <tr key={p.id} className="tk-row">
                <td className="py-2">
                  <Link href={`/products/${p.id}`} className="font-medium text-amber-700 hover:underline dark:text-amber-400">
                    {p.name}
                  </Link>
                </td>
                <td>{p.category}</td>
                <td>{formatCurrency(breakdown.finalCost)}</td>
                <td>{formatCurrency(breakdown.suggestedPrice)}</td>
                <td>{formatCurrency(breakdown.marketplacePrice)}</td>
                <td>
                  <ConfirmDeleteForm action={async () => { 'use server'; await deleteProduct(p.id) }} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
