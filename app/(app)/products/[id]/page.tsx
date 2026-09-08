import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { formatCurrency } from '@/lib/format'
import {
  calculatePrinterDepreciationCostPerHour,
  calculatePrinterMaintenanceCostPerHour,
  type ProductCostFlags,
} from '@/lib/costing'
import { ProductForm } from '../ProductForm'
import { CostBreakdown } from '../CostBreakdown'
import { PriceSimulation } from '../PriceSimulation'
import {
  getProductCostBreakdown,
  getEditableFilamentOptions,
  addProductSupplyUsage,
  removeProductSupplyUsage,
  addProductAccessoryUsage,
  removeProductAccessoryUsage,
} from '@/actions/products'
import { addProductPhoto, removeProductPhoto } from '@/actions/productPhotos'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'

const SUPPLY_UNIT_LABELS: Record<string, string> = {
  UN: 'Unidade',
  ML: 'Mililitro',
  G: 'Grama',
}

function accessoryOptionLabel(a: { name: string; colorName: string }): string {
  return a.colorName ? `${a.name} — ${a.colorName}` : a.name
}

export default async function ProductEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      supplyUsages: { include: { supply: true } },
      accessoryUsages: { include: { accessory: true } },
      photos: { orderBy: { createdAt: 'asc' }, select: { id: true } },
    },
  })
  if (!product) notFound()

  const [printers, filamentOptions, packagingItems, supplies, accessories, breakdown, settings] = await Promise.all([
    prisma.printer.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    getEditableFilamentOptions(product.id),
    prisma.packagingItem.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.supply.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.accessory.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    getProductCostBreakdown(product.id),
    prisma.settings.findUniqueOrThrow({ where: { id: 1 } }),
  ])

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

  const packagingOptions = packagingItems.map((p) => ({ id: p.id, name: p.name, unitCost: p.unitCost.toNumber() }))

  const currentSuppliesCost = product.supplyUsages.reduce(
    (sum, u) => sum + u.quantity.toNumber() * u.supply.avgUnitCost.toNumber(),
    0,
  )
  const currentAccessoriesCost = product.accessoryUsages.reduce(
    (sum, u) => sum + u.quantity.toNumber() * u.accessory.avgUnitCost.toNumber(),
    0,
  )

  const costFlags: ProductCostFlags = {
    includeDepreciation: settings.includeDepreciation,
    includeEnergyCost: settings.includeEnergyCost,
    includeMaintenance: settings.includeMaintenance,
    includeLaborCost: settings.includeLaborCost,
    includeFailureRate: settings.includeFailureRate,
    includeFilamentCost: settings.includeFilamentCost,
    includeAccessoriesCost: settings.includeAccessoriesCost,
    includeSuppliesCost: settings.includeSuppliesCost,
    includePackagingCost: settings.includePackagingCost,
  }

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
              finishingType: product.finishingType,
              usesGlue: product.usesGlue,
              notes: product.notes,
            }}
            printers={printerOptions}
            filaments={filamentOptions}
            packagingItems={packagingOptions}
            laborCostPerHour={settings.laborCostPerHour.toNumber()}
            currentSuppliesCost={currentSuppliesCost}
            currentAccessoriesCost={currentAccessoriesCost}
          />

          <details className="mt-6 tk-panel p-4">
            <summary className="tk-summary">Insumos (opcional)</summary>
            <h2 className="mb-3 mt-3 font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Insumos usados</h2>
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
                      <td>{formatCurrency(usage.quantity.toNumber() * usage.supply.avgUnitCost.toNumber())}</td>
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
          </details>

          <details className="mt-6 tk-panel p-4">
            <summary className="tk-summary">Acessórios (opcional)</summary>
            <h2 className="mb-3 mt-3 font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Acessórios usados</h2>
            {product.accessoryUsages.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum acessório cadastrado.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="tk-table-head-row">
                    <th className="py-1">Acessório</th>
                    <th>Quantidade</th>
                    <th>Custo</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {product.accessoryUsages.map((usage) => (
                    <tr key={usage.id} className="tk-row">
                      <td className="py-1">{accessoryOptionLabel(usage.accessory)}</td>
                      <td>{usage.quantity.toNumber()}</td>
                      <td>{formatCurrency(usage.quantity.toNumber() * usage.accessory.avgUnitCost.toNumber())}</td>
                      <td>
                        <form action={async () => { 'use server'; await removeProductAccessoryUsage(usage.id) }}>
                          <button className="tk-link-danger">Remover</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <form action={async (formData: FormData) => { 'use server'; await addProductAccessoryUsage(formData) }} className="mt-4 grid grid-cols-3 gap-2">
              <input type="hidden" name="productId" value={product.id} />
              <select name="accessoryId" className="tk-input" required defaultValue="">
                <option value="" disabled>Selecione um acessório</option>
                {accessories.map((a) => (
                  <option key={a.id} value={a.id}>{accessoryOptionLabel(a)}</option>
                ))}
              </select>
              <input name="quantity" type="number" step="0.01" placeholder="Quantidade" className="tk-input" required />
              <button className="tk-btn-primary">Adicionar</button>
            </form>
          </details>

          <div className="mt-6 tk-panel p-4">
            <h2 className="mb-3 font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Fotos da peça</h2>
            {product.photos.length === 0 ? (
              <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">Nenhuma foto ainda.</p>
            ) : (
              <div className="mb-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
                {product.photos.map((photo) => (
                  <div key={photo.id} className="group relative overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
                    {/* eslint-disable-next-line @next/next/no-img-element -- served from our own DB-backed route, not a static/optimizable asset */}
                    <img
                      src={`/api/photos/${photo.id}`}
                      alt={`Foto de ${product.name}`}
                      className="aspect-square w-full object-cover"
                    />
                    <ConfirmDeleteForm
                      action={async () => { 'use server'; await removeProductPhoto(photo.id) }}
                      confirmMessage="Remover esta foto?"
                      className="absolute right-1 top-1 rounded-md bg-slate-950/70 px-1.5 py-0.5 text-xs text-white opacity-0 transition-opacity hover:bg-red-600 group-hover:opacity-100"
                    />
                  </div>
                ))}
              </div>
            )}

            <form
              action={async (formData: FormData) => { 'use server'; await addProductPhoto(formData) }}
              className="flex items-center gap-2"
            >
              <input type="hidden" name="productId" value={product.id} />
              <input
                type="file"
                name="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                required
                className="tk-input flex-1 file:mr-3 file:rounded-md file:border-0 file:bg-amber-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white dark:file:bg-amber-500 dark:file:text-slate-950"
              />
              <button className="tk-btn-primary shrink-0 px-4">Enviar</button>
            </form>
            <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">JPEG, PNG, WEBP ou GIF — até 5MB.</p>
          </div>
        </div>

        <div>
          <CostBreakdown breakdown={breakdown} flags={costFlags} />
          <PriceSimulation
            productId={product.id}
            finalCost={breakdown.finalCost}
            defaultMarkup={settings.defaultMarkup.toNumber()}
            defaultMarginPercent={settings.desiredMarginPercent.toNumber()}
            defaultDiscountPercent={settings.defaultDiscountPercent.toNumber()}
            marketplaceFeePercent={settings.marketplaceFeePercent.toNumber()}
            taxPercent={settings.taxPercent.toNumber()}
            marketplaceFixedFee={settings.marketplaceFixedFee.toNumber()}
            roundingMode={settings.roundingMode}
            currentSuggestedPrice={product.suggestedPrice?.toNumber() ?? null}
            currentMarketplacePrice={product.marketplacePrice?.toNumber() ?? null}
          />
        </div>
      </div>
    </div>
  )
}
