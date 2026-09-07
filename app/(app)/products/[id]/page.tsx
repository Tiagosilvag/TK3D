import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { formatCurrency } from '@/lib/format'
import { ProductForm } from '../ProductForm'
import { CostBreakdown } from '../CostBreakdown'
import { getProductCostBreakdown, addProductSupplyUsage, removeProductSupplyUsage } from '@/actions/products'

const SUPPLY_UNIT_LABELS: Record<string, string> = {
  UN: 'Unidade',
  ML: 'Mililitro',
  G: 'Grama',
}

export default async function ProductEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const product = await prisma.product.findUnique({
    where: { id },
    include: { supplyUsages: { include: { supply: true } } },
  })
  if (!product) notFound()

  const [printers, filaments, packagingItems, accessories, supplies, breakdown] = await Promise.all([
    prisma.printer.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.filament.findMany({ where: { active: true }, orderBy: { manufacturer: 'asc' } }),
    prisma.packagingItem.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.accessory.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.supply.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    getProductCostBreakdown(product.id),
  ])

  return (
    <div className="tk-page">
      <Link href="/products" className="text-sm text-slate-500 hover:underline dark:text-slate-400">&larr; Produtos</Link>
      <h1 className="mb-4 mt-1 font-display text-lg font-semibold text-slate-900 dark:text-slate-100">{product.name}</h1>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ProductForm
            product={{
              id: product.id,
              name: product.name,
              category: product.category,
              printerId: product.printerId,
              filamentId: product.filamentId,
              weightGrams: product.weightGrams.toNumber(),
              printTimeHours: product.printTimeHours.toNumber(),
              laborTimeHours: product.laborTimeHours.toNumber(),
              packagingItemId: product.packagingItemId,
              accessoryId: product.accessoryId,
              finishingType: product.finishingType,
              usesGlue: product.usesGlue,
              notes: product.notes,
            }}
            printers={printers}
            filaments={filaments.map((f) => ({ id: f.id, name: f.manufacturer }))}
            packagingItems={packagingItems}
            accessories={accessories}
          />

          <div className="mt-6 tk-panel p-4">
            <h2 className="mb-3 font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Insumos usados</h2>
            {product.supplyUsages.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum insumo cadastrado.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="tk-table-head-row">
                    <th className="py-1">Insumo</th>
                    <th>Quantidade</th>
                    <th>Custo</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {product.supplyUsages.map((usage) => (
                    <tr key={usage.id} className="tk-row">
                      <td className="py-1">{usage.supply.name}</td>
                      <td>{usage.quantity.toNumber()} {SUPPLY_UNIT_LABELS[usage.supply.unit] ?? usage.supply.unit}</td>
                      <td>{formatCurrency(usage.quantity.toNumber() * usage.supply.unitCost.toNumber())}</td>
                      <td>
                        <form action={async () => { 'use server'; await removeProductSupplyUsage(usage.id) }}>
                          <button className="tk-link-danger">Remover</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <form action={async (formData: FormData) => { 'use server'; await addProductSupplyUsage(formData) }} className="mt-4 grid grid-cols-3 gap-2">
              <input type="hidden" name="productId" value={product.id} />
              <select name="supplyId" className="tk-input" required defaultValue="">
                <option value="" disabled>Selecione um insumo</option>
                {supplies.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <input name="quantity" type="number" step="0.001" placeholder="Quantidade" className="tk-input" required />
              <button className="tk-btn-primary">Adicionar</button>
            </form>
          </div>
        </div>

        <div>
          <CostBreakdown breakdown={breakdown} />
        </div>
      </div>
    </div>
  )
}
