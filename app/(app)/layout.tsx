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
  const unseenIds = unseenNotifications.map((n) => n.id)

  return (
    <>
      {/* Bug "modal não reabre pra notificação nova": app/(app)/layout.tsx
          é um layout compartilhado -- o App Router NÃO remonta
          NotificationBell entre navegações client-side, só atualiza suas
          props na mesma instância. O `useState(unseen.length > 0)` do
          componente só inicializa uma vez, então depois do primeiro
          "Ok, entendi" a modal nunca mais abriria sozinha, mesmo com uma
          Notification nova de verdade chegando depois (ex.: poller de
          reconciliação do Mercado Livre). `key` no conjunto de ids não
          vistos força um remount só quando esse CONJUNTO muda de verdade
          (id entra ou sai) -- navegação/revalidate com o mesmo conjunto
          mantém a mesma instância (modalOpen continua false depois de
          fechada), e um id novo gera uma key nova (remount, useState
          reinicializa com unseen.length > 0 = true). */}
      <NotificationBell
        key={unseenIds.join(',')}
        unresolvedCount={unresolvedCount}
        unseen={unseenNotifications.map((n) => ({ id: n.id, title: n.title, body: n.body, link: n.link }))}
      />
      <AppLayoutClient suppliesOutOfStockCount={suppliesOutOfStockCount} filamentsLowStockCount={filamentsLowStockCount}>
        {children}
      </AppLayoutClient>
    </>
  )
}
