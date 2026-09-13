'use server'
import { prisma } from '@/lib/prisma'
import { getAnycubicConnectionStatus, restartAnycubicListener } from '@/lib/anycubic/listener'
import { decryptCredential } from '@/lib/crypto'
import { fetchMyPrinters, fetchProjectHistory, type AnycubicPrinterRef, type AnycubicHistoryTask } from '@/lib/anycubic/auth'

export async function getAnycubicStatus() {
  return getAnycubicConnectionStatus()
}

export async function getAnycubicBoundPrinters(): Promise<{ success: boolean; printers?: AnycubicPrinterRef[]; error?: string }> {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } })
  if (!settings?.anycubicAuthTokenEncrypted) {
    return { success: false, error: 'Conecte a conta Anycubic em Configurações primeiro' }
  }
  try {
    const authToken = decryptCredential(settings.anycubicAuthTokenEncrypted)
    const printers = await fetchMyPrinters(authToken)
    return { success: true, printers }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Falha ao buscar impressoras' }
  }
}

export async function reconnectAnycubicListener(): Promise<{ success: boolean }> {
  await restartAnycubicListener()
  return { success: true }
}

// Histórico oficial completo da conta Anycubic -- busca ao vivo direto da
// nuvem a cada chamada, nunca salvo no banco (mesmo padrão do
// getBambuTaskHistory). Paginado por número de página (a API da Anycubic
// pagina assim, diferente do cursor da Bambu).
export async function getAnycubicProjectHistory(
  page = 1,
): Promise<{ success: boolean; tasks?: AnycubicHistoryTask[]; nextPage?: number | null; error?: string }> {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } })
  if (!settings?.anycubicAuthTokenEncrypted) {
    return { success: false, error: 'Conecte a conta Anycubic em Configurações primeiro' }
  }
  try {
    const authToken = decryptCredential(settings.anycubicAuthTokenEncrypted)
    const { tasks, hasMore } = await fetchProjectHistory(authToken, { page })
    return { success: true, tasks, nextPage: hasMore ? page + 1 : null }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Falha ao buscar histórico' }
  }
}
