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
      <SettingsForm
        settings={{
          energyCostPerKwh: settings.energyCostPerKwh.toNumber(),
          laborCostPerHour: settings.laborCostPerHour.toNumber(),
          failureRatePercent: settings.failureRatePercent.toNumber(),
          marketplaceFeePercent: settings.marketplaceFeePercent.toNumber(),
          taxPercent: settings.taxPercent.toNumber(),
          marketplaceFixedFee: settings.marketplaceFixedFee.toNumber(),
          defaultMarkup: settings.defaultMarkup.toNumber(),
        }}
      />
    </div>
  )
}
