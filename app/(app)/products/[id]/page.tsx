import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getProductionStatusBadge } from '@/lib/format'
import { StatusBadge } from '@/components/StatusBadge'
import {
  calculatePrinterDepreciationCostPerHour,
  calculatePlatformPrice,
  type ProductCostFlags,
} from '@/lib/costing'
import { ProductForm } from '../ProductForm'
import { CostBreakdown, type MarketplacePlatformPrice } from '../CostBreakdown'
import { PriceSimulation } from '../PriceSimulation'
import { ComponentsSection, type ComponentRow, type ProductOption } from '../ComponentsSection'
import { PhotoGallery, PhotoUploadForm } from '../PhotoGallery'
import {
  getProductCostBreakdown,
  getEditableFilamentOptions,
  getProductAverageProductionCost,
  addProductAccessoryColorUsage,
  removeProductAccessoryColorUsage,
  deleteProduct,
} from '@/actions/products'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'
import { getProductVariantBreakdown } from '@/lib/reports'
import { productNeedsAssembly } from '@/lib/products'

const PLATFORM_LABELS: Record<string, string> = { MERCADO_LIVRE: 'Mercado Livre', SHOPEE: 'Shopee' }

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
      packagingUsages: { include: { packagingItem: true } },
      photos: { orderBy: { createdAt: 'asc' }, select: { id: true, isCover: true } },
      parts: { orderBy: { createdAt: 'asc' }, include: { filamentComponents: true } },
      componentUsages: { include: { componentProduct: true } },
    },
  })
  if (!product) notFound()

  const needsAssembly = productNeedsAssembly({
    isComposite: product.isComposite,
    accessoryUsagesCount: product.accessoryUsages.length,
    supplyUsagesCount: product.supplyUsages.length,
    componentUsagesCount: product.componentUsages.length,
  })

  const [printers, filamentOptions, packagingItems, supplies, accessories, breakdown, settings, platforms, partRuns, colorVariants, accessoryColorUsages, productCandidates] = await Promise.all([
    prisma.printer.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    getEditableFilamentOptions(product.id),
    prisma.packagingItem.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.supply.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.accessory.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    getProductCostBreakdown(product.id),
    prisma.settings.findUniqueOrThrow({ where: { id: 1 } }),
    prisma.marketplacePlatform.findMany(),
    product.parts.length > 0
      ? prisma.productionRun.findMany({
          where: { productPartId: { in: product.parts.map((p) => p.id) } },
          orderBy: { createdAt: 'desc' },
        })
      : Promise.resolve([]),
    // Melhoria "Parceiros de consignação" §5: combos de cor já produzidos/
    // montados deste produto -- fonte de verdade pra "quais cores existem
    // pra associar acessório", nunca uma lista pré-declarada à parte.
    getProductVariantBreakdown(product.id, needsAssembly),
    prisma.productAccessoryColorUsage.findMany({ where: { productId: product.id }, include: { accessory: true } }),
    // Melhoria "Produto-como-componente": candidatos elegíveis pra usar
    // como ingrediente deste produto -- ativos, NÃO compostos (restrição
    // desta rodada), excluindo o próprio produto. Ciclo é revalidado no
    // servidor em addProductComponentUsage (mais barato checar aqui só o
    // óbvio, sem percorrer o grafo inteiro pra montar a lista).
    prisma.product.findMany({
      where: { active: true, isComposite: false, id: { not: product.id } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ])

  const productOptions: ProductOption[] = productCandidates

  // Melhoria "Produto-como-componente": custo médio de produção de cada
  // componente-produto já cadastrado na ficha técnica, ao vivo, pra
  // exibir na coluna "Custo" da lista unificada de componentes.
  const componentAvgCosts = await Promise.all(
    product.componentUsages.map((u) => getProductAverageProductionCost(u.componentProductId)),
  )

  // 2.1: "peça pronta" reaproveita o ProductionStatus já existente
  // (CONCLUIDA = sucesso atingiu o planejado) -- aqui só pega a produção
  // MAIS RECENTE de cada peça (partRuns já vem ordenado desc) pra exibir
  // como status atual dela, sem inventar um campo novo.
  const latestRunByPart = new Map<string, (typeof partRuns)[number]>()
  for (const run of partRuns) {
    if (run.productPartId && !latestRunByPart.has(run.productPartId)) {
      latestRunByPart.set(run.productPartId, run)
    }
  }

  const printerOptions = printers.map((p) => {
    const purchasePrice = p.purchasePrice.toNumber()
    const depreciationHours = p.depreciationHours.toNumber()
    const costPerHour =
      calculatePrinterDepreciationCostPerHour({ purchasePrice, depreciationHours }) +
      p.maintenanceCostPerHour.toNumber() +
      p.avgPowerConsumptionKwh.toNumber() * p.energyCostPerKwh.toNumber()
    return { id: p.id, name: p.name, costPerHour }
  })

  const currentSuppliesCost = product.supplyUsages.reduce(
    (sum, u) => sum + u.quantity.toNumber() * u.supply.avgUnitCost.toNumber(),
    0,
  )
  const currentAccessoriesCost = product.accessoryUsages.reduce(
    (sum, u) => sum + u.quantity.toNumber() * u.accessory.avgUnitCost.toNumber(),
    0,
  )

  // Melhoria "Produtos" §3: uma lista só "Componentes" juntando Acessórios,
  // Insumos e Embalagem (antes 3 seções separadas) -- ComponentsSection cuida
  // da apresentação unificada, os dados continuam vindo de 3 tabelas
  // diferentes por baixo.
  const components: ComponentRow[] = [
    ...product.accessoryUsages.map((u): ComponentRow => ({
      id: u.id,
      type: 'ACCESSORY',
      name: accessoryOptionLabel(u.accessory),
      quantity: u.quantity.toNumber(),
      unitSuffix: '',
      cost: u.quantity.toNumber() * u.accessory.avgUnitCost.toNumber(),
    })),
    ...product.supplyUsages.map((u): ComponentRow => ({
      id: u.id,
      type: 'SUPPLY',
      name: u.supply.name,
      quantity: u.quantity.toNumber(),
      unitSuffix: '',
      cost: u.quantity.toNumber() * u.supply.avgUnitCost.toNumber(),
    })),
    ...product.packagingUsages.map((u): ComponentRow => ({
      id: u.id,
      type: 'PACKAGING',
      name: u.packagingItem.name,
      quantity: u.quantity.toNumber(),
      unitSuffix: '',
      cost: u.quantity.toNumber() * u.packagingItem.avgUnitCost.toNumber(),
    })),
    // Melhoria "Produto-como-componente": outros PRODUTOS usados como
    // ingrediente (ex.: Mosquetão dentro de Chaveiro Café) -- custo é
    // quantidade × custo médio de produção do componente, ao vivo.
    ...product.componentUsages.map((u, i): ComponentRow => ({
      id: u.id,
      type: 'PRODUCT',
      name: u.componentProduct.name,
      quantity: u.quantity,
      unitSuffix: '',
      cost: u.quantity * componentAvgCosts[i],
    })),
  ]

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

  // Melhoria "Produtos" §3: "Preço marketplace" genérico vira 1 valor por
  // plataforma cadastrada (Mercado Livre, Shopee) -- mesma fórmula de
  // getPlatformSalePrice (actions/marketplacePlatforms.ts), calculada aqui
  // direto porque já temos o breakdown carregado.
  const marketplacePlatformPrices: MarketplacePlatformPrice[] = platforms.map((platform) => ({
    label: PLATFORM_LABELS[platform.platform] ?? platform.platform,
    price: calculatePlatformPrice(breakdown.suggestedPrice, settings.taxPercent.toNumber(), platform.feePercent.toNumber(), platform.feeFixed.toNumber()),
  }))

  return (
    <div className="tk-page">
      <div className="mb-4 mt-1 flex items-center justify-between">
        <div>
          <Link href="/products" className="text-sm text-slate-500 hover:underline dark:text-slate-400">&larr; Produtos</Link>
          <h1 className="mt-1 font-display text-lg font-semibold text-slate-900 dark:text-slate-100">{product.name}</h1>
        </div>
        <ConfirmDeleteForm
          action={async () => { 'use server'; return await deleteProduct(product.id) }}
          label="Remover produto"
          confirmMessage="Remover este produto? Ele deixa de aparecer nas listagens, mas o histórico é preservado."
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ProductForm
            product={{
              id: product.id,
              name: product.name,
              category: product.category,
              isComposite: product.isComposite,
              printerId: product.printerId,
              filamentId: product.filamentId,
              weightGrams: product.weightGrams.toNumber(),
              printTimeHours: product.printTimeHours.toNumber(),
              laborTimeHours: product.laborTimeHours.toNumber(),
              finishingType: product.finishingType,
              usesGlue: product.usesGlue,
              notes: product.notes,
            }}
            existingParts={product.parts.map((p) => ({
              id: p.id,
              name: p.name,
              printerId: p.printerId,
              filaments: p.filamentComponents.map((f) => ({ filamentId: f.filamentId, weightGrams: f.weightGrams.toNumber() })),
              printTimeHours: p.printTimeHours.toNumber(),
              quantityPerUnit: p.quantityPerUnit,
            }))}
            printers={printerOptions}
            filaments={filamentOptions}
            laborCostPerHour={settings.laborCostPerHour.toNumber()}
            currentSuppliesCost={currentSuppliesCost}
            currentAccessoriesCost={currentAccessoriesCost}
            showLiveCostPanel={false}
          />

          {product.isComposite && product.parts.length > 0 && (
            <div className="mt-6 tk-panel p-4">
              <h2 className="mb-3 font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Histórico de produção por peça</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="tk-table-head-row">
                    <th className="py-1">Peça</th>
                    <th>Qtd. por unidade</th>
                    <th>Última produção</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {product.parts.map((part) => {
                    const latestRun = latestRunByPart.get(part.id)
                    const badge = latestRun ? getProductionStatusBadge(latestRun.status) : null
                    return (
                      <tr key={part.id} className="tk-row">
                        <td className="py-1">{part.name}</td>
                        <td>{part.quantityPerUnit}</td>
                        <td>{latestRun ? latestRun.date.toLocaleDateString('pt-BR') : '—'}</td>
                        <td>
                          {badge ? (
                            <StatusBadge badge={badge} />
                          ) : (
                            <span className="text-slate-400 dark:text-slate-500">Sem produção ainda</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <ComponentsSection
            productId={product.id}
            components={components}
            accessories={accessories.map((a) => ({ id: a.id, name: a.name, colorName: a.colorName }))}
            supplies={supplies.map((s) => ({ id: s.id, name: s.name, unit: s.unit, defaultUsage: s.defaultUsage?.toNumber() ?? null }))}
            packagingItems={packagingItems.map((p) => ({ id: p.id, name: p.name }))}
            products={product.isComposite ? productOptions : []}
          />

          {/* Melhoria "Parceiros de consignação" §5: mapa opcional de "quais
              acessórios (variação exata, já com cor) cada COMBINAÇÃO DE COR
              deste produto usa" -- só existe pra alimentar os chips de
              acessório no detalhe por cor da tela de Parceiros, nunca muda
              Montagem/custeio (a lista "Componentes" acima continua sendo a
              única que confirmAssembly consome). Só aparece quando o
              produto já tem alguma cor conhecida (colorVariants vem de
              getProductVariantBreakdown, nunca uma lista pré-declarada). */}
          {colorVariants.length > 0 && (
            <details className="mt-6 tk-panel p-4">
              <summary className="tk-summary">Acessórios por cor (opcional)</summary>
              <p className="mb-3 mt-3 text-sm text-slate-500 dark:text-slate-400">
                Pra cada cor já produzida deste produto, quais acessórios (com a cor exata) foram usados -- usado só pra exibir na tela de Parceiros de consignação, não afeta Montagem.
              </p>
              <div className="space-y-4">
                {colorVariants.map((variant) => {
                  const usagesForCombo = accessoryColorUsages.filter((u) => u.colorComboKey === variant.key)
                  return (
                    <div key={variant.key} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                      <h3 className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">{variant.label}</h3>
                      {usagesForCombo.length === 0 ? (
                        <p className="text-xs text-slate-400 dark:text-slate-500">Nenhum acessório associado a esta cor.</p>
                      ) : (
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="tk-table-head-row">
                              <th className="py-1">Acessório</th>
                              <th>Quantidade</th>
                              <th></th>
                            </tr>
                          </thead>
                          <tbody>
                            {usagesForCombo.map((usage) => (
                              <tr key={usage.id} className="tk-row">
                                <td className="py-1">{accessoryOptionLabel(usage.accessory)}</td>
                                <td>{usage.quantity.toNumber()}</td>
                                <td>
                                  <form action={async () => { 'use server'; await removeProductAccessoryColorUsage(usage.id) }}>
                                    <button className="tk-link-danger">Remover</button>
                                  </form>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      <form action={async (formData: FormData) => { 'use server'; await addProductAccessoryColorUsage(formData) }} className="mt-3 grid grid-cols-3 gap-2">
                        <input type="hidden" name="productId" value={product.id} />
                        <input type="hidden" name="colorComboKey" value={variant.key} />
                        <select name="accessoryId" className="tk-input" required defaultValue="">
                          <option value="" disabled>Selecione um acessório</option>
                          {accessories.map((a) => (
                            <option key={a.id} value={a.id}>{accessoryOptionLabel(a)}</option>
                          ))}
                        </select>
                        <input name="quantity" type="number" step="0.01" min="0.01" placeholder="Quantidade" className="tk-input" required />
                        <button className="tk-btn-primary">Adicionar</button>
                      </form>
                    </div>
                  )
                })}
              </div>
            </details>
          )}

          <div className="mt-6 tk-panel p-4">
            <h2 className="mb-3 font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Fotos</h2>
            {product.photos.length === 0 ? (
              <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">Nenhuma foto ainda.</p>
            ) : (
              <>
                <p className="mb-2 text-xs text-slate-400 dark:text-slate-500">Clique numa foto pra marcá-la como capa (usada no card da listagem).</p>
                <PhotoGallery productName={product.name} photos={product.photos} />
              </>
            )}

            <PhotoUploadForm productId={product.id} />
            <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">JPEG, PNG, WEBP ou GIF — até 5MB.</p>
          </div>
        </div>

        <div>
          <CostBreakdown breakdown={breakdown} flags={costFlags} marketplacePlatformPrices={marketplacePlatformPrices} />
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
            roundingCustomCents={settings.roundingCustomCents}
            currentSuggestedPrice={product.suggestedPrice?.toNumber() ?? null}
            currentMarketplacePrice={product.marketplacePrice?.toNumber() ?? null}
          />
        </div>
      </div>
    </div>
  )
}
