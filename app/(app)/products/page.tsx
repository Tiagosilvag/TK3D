import { prisma } from '@/lib/prisma'
import {
  calculatePrinterDepreciationCostPerHour,
  calculateFilamentPricePerGram,
  resolvePlatformPrice,
  type PlatformFeeTier,
} from '@/lib/costing'
import { getProductCostBreakdown } from '@/actions/products'
import { ProductsExplorer, type ProductCardData } from './ProductsExplorer'

export const dynamic = 'force-dynamic'

export default async function ProductsPage() {
  const [products, printers, filaments, settings, platforms] = await Promise.all([
    prisma.product.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      include: {
        parts: { include: { filamentComponents: true } },
        photos: { where: { isCover: true }, select: { id: true } },
      },
    }),
    prisma.printer.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.filament.findMany({ where: { currentStockGrams: { gt: 0 } }, orderBy: { manufacturer: 'asc' } }),
    prisma.settings.findUniqueOrThrow({ where: { id: 1 } }),
    prisma.marketplacePlatform.findMany(),
  ])

  const breakdowns = await Promise.all(products.map((p) => getProductCostBreakdown(p.id)))

  const mercadoLivre = platforms.find((p) => p.platform === 'MERCADO_LIVRE')
  const shopee = platforms.find((p) => p.platform === 'SHOPEE')
  const taxPercent = settings.taxPercent.toNumber()

  // Melhoria "Produtos" §2: card da listagem mostra "N peça(s) · N cores" --
  // ambos vêm da FICHA TÉCNICA (nunca do que já foi produzido, essa tela é
  // só sobre variações/ficha técnica, estoque é assunto de "Meu Estoque").
  // Composto: N peças = parts.length, N cores = filamentIds distintos entre
  // TODAS as peças. Simples: sempre 1 peça · 1 cor (o próprio produto/filamento).
  const cards: ProductCardData[] = products.map((p, i) => {
    const breakdown = breakdowns[i]
    const colorsCount = p.isComposite
      ? new Set(p.parts.flatMap((part) => part.filamentComponents.map((f) => f.filamentId))).size
      : 1
    return {
      id: p.id,
      name: p.name,
      category: p.category,
      partsCount: p.isComposite ? p.parts.length : 1,
      colorsCount,
      coverPhotoId: p.photos[0]?.id ?? null,
      costPrice: breakdown.finalCost,
      suggestedPrice: breakdown.suggestedPrice,
      mercadoLivrePrice: mercadoLivre
        ? resolvePlatformPrice(
            breakdown.suggestedPrice,
            taxPercent,
            mercadoLivre.feePercent.toNumber(),
            mercadoLivre.feeFixed.toNumber(),
            mercadoLivre.feeTiers as unknown as PlatformFeeTier[] | null,
          )
        : null,
      // Bug "Preço Shopee na listagem ignora faixa": calculatePlatformPrice
      // direto com shopee.feePercent/feeFixed sempre usava a taxa da 1ª
      // faixa (o par "achatado" só espelha ela, ver comentário em
      // SettingsForm.tsx) -- resolvePlatformPrice (lib/costing.ts) resolve
      // a faixa certa quando feeTiers existir, mesmo helper que
      // getPlatformSalePrice já usa pro prefill em Vendas.
      shopeePrice: shopee
        ? resolvePlatformPrice(
            breakdown.suggestedPrice,
            taxPercent,
            shopee.feePercent.toNumber(),
            shopee.feeFixed.toNumber(),
            shopee.feeTiers as unknown as PlatformFeeTier[] | null,
          )
        : null,
    }
  })

  const printerOptions = printers.map((p) => {
    const purchasePrice = p.purchasePrice.toNumber()
    const depreciationHours = p.depreciationHours.toNumber()
    const costPerHour =
      calculatePrinterDepreciationCostPerHour({ purchasePrice, depreciationHours }) +
      p.maintenanceCostPerHour.toNumber() +
      p.avgPowerConsumptionKwh.toNumber() * p.energyCostPerKwh.toNumber()
    return { id: p.id, name: p.name, costPerHour }
  })

  const filamentOptions = filaments.map((f) => ({
    id: f.id,
    name: `${f.manufacturer} ${f.colorName} (${f.material}) — Rolo #${String(f.rollNumber).padStart(3, '0')}`,
    pricePerGram: calculateFilamentPricePerGram({ spoolPrice: f.spoolPrice.toNumber(), spoolWeightKg: f.spoolWeightKg.toNumber() }),
    colorHex: f.colorHex,
  }))

  return (
    <div className="tk-page">
      <ProductsExplorer
        products={cards}
        printers={printerOptions}
        filaments={filamentOptions}
        laborCostPerHour={settings.laborCostPerHour.toNumber()}
      />
    </div>
  )
}
