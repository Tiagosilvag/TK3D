import { prisma } from '@/lib/prisma'
import { AppLayoutClient } from './AppLayoutClient'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const suppliesOutOfStockCount = await prisma.supply.count({ where: { currentStock: { lte: 0 } } })

  return <AppLayoutClient suppliesOutOfStockCount={suppliesOutOfStockCount}>{children}</AppLayoutClient>
}
