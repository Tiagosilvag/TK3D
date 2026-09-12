'use server'
import { prisma } from '@/lib/prisma'
import { getAnycubicConnectionStatus, restartAnycubicListener } from '@/lib/anycubic/listener'
import { decryptCredential } from '@/lib/crypto'
import { fetchMyPrinters, type AnycubicPrinterRef } from '@/lib/anycubic/auth'

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
