import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { SettingsForm } from './SettingsForm'
import type { PlatformFeeTier } from '@/lib/costing'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const [settings, platforms] = await Promise.all([
    prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } }),
    // Melhoria "Configurações" §5: as 2 linhas fixas (Shopee/Mercado Livre)
    // deixam de ter tela própria e viram uma lista embutida no card
    // Precificação -- mantidas fixas (sem criar/remover/renomear), só
    // reformatadas visualmente junto do resto de Configurações.
    prisma.marketplacePlatform.findMany({ orderBy: { platform: 'asc' } }),
  ])

  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Configurações</h1>
      <p className="mb-4 -mt-2 text-xs text-slate-400 dark:text-slate-500">
        Gestão de tipos de acessório agora fica dentro do próprio cadastro, em Acessórios &rarr; Novo acessório &rarr; Tipo &rarr; Gerenciar tipos.
      </p>

      {/* Mercado Livre: tela própria em /settings/integrations (precisa de
          URL fixa pra receber o redirect OAuth, ver
          app/api/integrations/mercado-livre/callback/route.ts) -- não dá
          pra embutir inline em SettingsForm como accessory-types/
          marketplace-platforms fizeram. */}
      <div className="tk-panel mb-4 p-4">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Integrações</p>
        <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
          Conectar contas de marketplace pra sincronizar anúncios e pedidos automaticamente.
        </p>
        <Link
          href="/settings/integrations"
          className="mt-2 inline-block text-sm font-medium text-violet-600 underline-offset-2 hover:underline dark:text-violet-400"
        >
          Integrações (Mercado Livre) &rarr;
        </Link>
      </div>

      <SettingsForm
        settings={{
          energyCostPerKwh: settings.energyCostPerKwh.toNumber(),
          laborCostPerHour: settings.laborCostPerHour.toNumber(),
          failureRatePercent: settings.failureRatePercent.toNumber(),
          marketplaceFeePercent: settings.marketplaceFeePercent.toNumber(),
          taxPercent: settings.taxPercent.toNumber(),
          marketplaceFixedFee: settings.marketplaceFixedFee.toNumber(),
          defaultMarkup: settings.defaultMarkup.toNumber(),
          annualMaintenancePercent: settings.annualMaintenancePercent.toNumber(),
          annualUsageHours: settings.annualUsageHours.toNumber(),
          desiredMarginPercent: settings.desiredMarginPercent.toNumber(),
          defaultDiscountPercent: settings.defaultDiscountPercent.toNumber(),
          stockLowThresholdPercent: settings.stockLowThresholdPercent.toNumber(),
          stockCriticalThresholdPercent: settings.stockCriticalThresholdPercent.toNumber(),
          productLowStockThreshold: settings.productLowStockThreshold,
          includeDepreciation: settings.includeDepreciation,
          includeEnergyCost: settings.includeEnergyCost,
          includeMaintenance: settings.includeMaintenance,
          includeLaborCost: settings.includeLaborCost,
          includeFailureRate: settings.includeFailureRate,
          includeFilamentCost: settings.includeFilamentCost,
          includeAccessoriesCost: settings.includeAccessoriesCost,
          includeSuppliesCost: settings.includeSuppliesCost,
          includePackagingCost: settings.includePackagingCost,
          roundingMode: settings.roundingMode,
          roundingCustomCents: settings.roundingCustomCents,
        }}
        platforms={platforms.map((p) => ({
          platform: p.platform,
          feePercent: p.feePercent.toNumber(),
          feeFixed: p.feeFixed.toNumber(),
          avgFreight: p.avgFreight.toNumber(),
          feeTiers: p.feeTiers as unknown as PlatformFeeTier[] | null,
          feeTiersPremium: p.feeTiersPremium as unknown as PlatformFeeTier[] | null,
          categoryReference: p.categoryReference,
        }))}
      />
    </div>
  )
}
