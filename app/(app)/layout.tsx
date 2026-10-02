import { prisma } from '@/lib/prisma'
import { getFilamentsLowStockCount } from '@/lib/reports'
import { getUnresolvedCount, getUnseenNotifications } from '@/lib/notifications'
import { AppLayoutClient } from './AppLayoutClient'
import { NotificationBell } from '@/components/NotificationBell'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [suppliesOutOfStockCount, filamentsLowStockCount, unresolvedCount, unseenNotifications] = await Promise.all([
    prisma.supply.count({ where: { currentStock: { lte: 0 } } }),
    getFilamentsLowStockCount(),
    getUnresolvedCount(),
    getUnseenNotifications(),
  ])

  // Task 9: NotificationBell renderiza como IRMÃO de AppLayoutClient (não
  // dentro dela) -- AppLayoutClient.tsx tem duas regiões de nav distintas
  // por breakpoint (header mobile md:hidden + aside desktop), e o sino
  // usa position:fixed pra flutuar sobre as duas sem precisar escolher
  // nenhuma, nem alterar o contrato de props de AppLayoutClient.
  return (
    <>
      <NotificationBell
        unresolvedCount={unresolvedCount}
        unseen={unseenNotifications.map((n) => ({ id: n.id, title: n.title, body: n.body, link: n.link }))}
      />
      <AppLayoutClient suppliesOutOfStockCount={suppliesOutOfStockCount} filamentsLowStockCount={filamentsLowStockCount}>
        {children}
      </AppLayoutClient>
    </>
  )
}
