import { prisma } from '@/lib/prisma'
import { SettingsForm } from './SettingsForm'
import { BambuConnectionForm } from './BambuConnectionForm'
import { getBambuConnectionStatus } from '@/actions/bambuStatus'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const [settings, platforms, bambuConnectionStatus] = await Promise.all([
    prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } }),
    // Melhoria "Configurações" §5: as 2 linhas fixas (Shopee/Mercado Livre)
    // deixam de ter tela própria e viram uma lista embutida no card
    // Precificação -- mantidas fixas (sem criar/remover/renomear), só
    // reformatadas visualmente junto do resto de Configurações.
    prisma.marketplacePlatform.findMany({ orderBy: { platform: 'asc' } }),
    getBambuConnectionStatus(),
  ])

  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Configurações</h1>
      <p className="mb-4 -mt-2 text-xs text-slate-400 dark:text-slate-500">
        Gestão de tipos de acessório agora fica dentro do próprio cadastro, em Acessórios &rarr; Novo acessório &rarr; Tipo &rarr; Gerenciar tipos.
      </p>
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
        }))}
      />
      <div className="mt-4">
        <BambuConnectionForm connectedEmail={settings.bambuCloudEmail} connectionStatus={bambuConnectionStatus} />
      </div>
    </div>
  )
}
