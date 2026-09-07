import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { formatCurrency } from '@/lib/format'
import { ProductForm } from './ProductForm'
import { deleteProduct, getProductCostBreakdown } from '@/actions/products'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'

export const dynamic = 'force-dynamic'

export default async function ProductsPage() {
  const [products, printers, filaments, packagingItems, accessories] = await Promise.all([
    prisma.product.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.printer.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.filament.findMany({ where: { active: true }, orderBy: { manufacturer: 'asc' } }),
    prisma.packagingItem.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.accessory.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
  ])

  const breakdowns = await Promise.all(products.map((p) => getProductCostBreakdown(p.id)))

  return (
    <div className="p-6">
      <h1 className="mb-4 text-lg font-semibold">Produtos</h1>
      <ProductForm
        printers={printers}
        filaments={filaments.map((f) => ({ id: f.id, name: f.manufacturer }))}
        packagingItems={packagingItems}
        accessories={accessories}
      />
      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="border-b text-left text-slate-500">
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
              <tr key={p.id} className="border-b">
                <td className="py-2">
                  <Link href={`/products/${p.id}`} className="text-slate-900 hover:underline">
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
