import { prisma } from '@/lib/prisma'
import { getFilamentsLowStockCount } from '@/lib/reports'
import { AppLayoutClient } from './AppLayoutClient'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [suppliesOutOfStockCount, filamentsLowStockCount] = await Promise.all([
    prisma.supply.count({ where: { currentStock: { lte: 0 } } }),
    getFilamentsLowStockCount(),
  ])

  return (
    <AppLayoutClient suppliesOutOfStockCount={suppliesOutOfStockCount} filamentsLowStockCount={filamentsLowStockCount}>
      {children}
    </AppLayoutClient>
  )
}
