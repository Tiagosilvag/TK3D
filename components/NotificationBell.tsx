'use client'
import { useState } from 'react'
import { markNotificationsSeenAction } from '@/actions/notifications'

interface UnseenNotification {
  id: string
  title: string
  body: string | null
  link: string | null
}

// Sino de notificações (genérico, Task 9): ícone fixo (position:fixed via
// `.tk-notification-bell`, app/globals.css) flutuando sobre QUALQUER tela,
// montado 1x em app/(app)/layout.tsx como irmão de <AppLayoutClient> --
// não dentro dela, já que o header mobile e a sidebar desktop de
// AppLayoutClient.tsx são duas regiões de nav distintas por breakpoint, e
// um elemento fixed sidesteps essa diferença (ver brief da Task 9). Bolinha
// vermelha (`.tk-notification-dot`) só aparece com unresolvedCount > 0.
// Modal "Novidades" abre uma vez quando existe notificação não vista
// (useState inicializado só na primeira renderização) e marca como vista
// ao fechar -- nunca reabre sozinha pra essa mesma leva (getUnseenNotifications
// só retorna o que ainda não foi marcado, e o layout só reconstrói `unseen`
// a cada navegação/revalidate).
export function NotificationBell({ unresolvedCount, unseen }: { unresolvedCount: number; unseen: UnseenNotification[] }) {
  const [modalOpen, setModalOpen] = useState(unseen.length > 0)

  async function handleClose() {
    setModalOpen(false)
    await markNotificationsSeenAction(unseen.map((n) => n.id))
  }

  return (
    <>
      <a href="/orders" className="tk-notification-bell" aria-label="Notificações">
        🔔
        {unresolvedCount > 0 && <span className="tk-notification-dot" aria-label={`${unresolvedCount} pendente(s)`} />}
      </a>
      {modalOpen && (
        <dialog open className="tk-modal">
          <h2 className="font-display text-sm font-semibold">Novidades</h2>
          <ul className="mt-2 grid gap-2 text-sm">
            {unseen.map((n) => (
              <li key={n.id}>
                <strong>{n.title}</strong>
                {n.body && <p className="text-slate-500 dark:text-slate-400">{n.body}</p>}
              </li>
            ))}
          </ul>
          <button onClick={handleClose} className="tk-btn-primary mt-3">
            Ok, entendi
          </button>
        </dialog>
      )}
    </>
  )
}
