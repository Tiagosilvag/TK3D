import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { SettingsForm } from './SettingsForm'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const settings = await prisma.settings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  })

  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Configurações</h1>
      <div className="mb-4 flex flex-wrap gap-4">
        <Link href="/settings/marketplace-platforms" className="text-sm text-amber-600 hover:underline dark:text-amber-400">
          Plataformas de marketplace &rarr;
        </Link>
      </div>
      <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">
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
        }}
      />
    </div>
  )
}
