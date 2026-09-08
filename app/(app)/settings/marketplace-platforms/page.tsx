import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { PlatformFeesForm } from './PlatformFeesForm'

export const dynamic = 'force-dynamic'

const PLATFORM_LABELS = { SHOPEE: 'Shopee', MERCADO_LIVRE: 'Mercado Livre' } as const

export default async function MarketplacePlatformsPage() {
  const platforms = await prisma.marketplacePlatform.findMany({ orderBy: { platform: 'asc' } })

  return (
    <div className="tk-page">
      <Link href="/settings" className="text-sm text-slate-500 hover:underline dark:text-slate-400">&larr; Configurações</Link>
      <h1 className="mb-1 mt-1 font-display text-lg font-semibold text-slate-900 dark:text-slate-100">Plataformas de marketplace</h1>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        Taxa %, taxa fixa e frete médio de cada plataforma — usados para sugerir o valor unitário ao registrar uma venda por esse canal.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {platforms.map((p) => (
          <PlatformFeesForm
            key={p.id}
            platform={p.platform}
            label={PLATFORM_LABELS[p.platform]}
            feePercent={p.feePercent.toNumber()}
            feeFixed={p.feeFixed.toNumber()}
            avgFreight={p.avgFreight.toNumber()}
          />
        ))}
      </div>
    </div>
  )
}
