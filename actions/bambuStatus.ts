'use server'
import { prisma } from '@/lib/prisma'
import { getLiveStatus, getConnectionStatus, restartBambuListener, getCurrentThumbnail } from '@/lib/bambu/listener'
import { getAnycubicLiveStatus } from '@/lib/anycubic/listener'
import { decryptCredential } from '@/lib/crypto'
import { fetchBoundDevices, fetchTaskHistory, type BambuDevice, type BambuCloudTaskFull } from '@/lib/bambu/auth'
import { revalidatePath } from 'next/cache'

export async function getBambuConnectionStatus() {
  return getConnectionStatus()
}

// Lista as impressoras vinculadas à conta Bambu já conectada, pra escolher
// o número de série numa lista em vez de caçar no app/Studio.
export async function getBambuBoundDevices(): Promise<{ success: boolean; devices?: BambuDevice[]; error?: string }> {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } })
  if (!settings?.bambuCloudCredentialEncrypted) {
    return { success: false, error: 'Conecte a conta Bambu em Configurações primeiro' }
  }
  try {
    const token = decryptCredential(settings.bambuCloudCredentialEncrypted)
    const devices = await fetchBoundDevices(token)
    return { success: true, devices }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Falha ao buscar impressoras' }
  }
}

// Reconecta manualmente (ex.: sessão expirada) sem precisar de restart do
// container -- ver lib/bambu/listener.ts#restartBambuListener.
export async function reconnectBambuListener(): Promise<{ success: boolean }> {
  await restartBambuListener()
  revalidatePath('/settings')
  revalidatePath('/monitor')
  return { success: true }
}

// Mescla as duas marcas por impressora (spec 2026-09-12 §7) -- /monitor não
// é mais bloqueado por um status de conexão único; cada card lê o estado da
// SUA própria impressora.
export async function getAllLiveStatuses() {
  const printers = await prisma.printer.findMany({
    where: { active: true, OR: [{ bambuEnabled: true }, { anycubicEnabled: true }] },
    select: { id: true, name: true, nickname: true, bambuEnabled: true, anycubicEnabled: true },
  })
  return printers.map((printer) => {
    if (printer.bambuEnabled) {
      return {
        printerId: printer.id,
        name: printer.nickname ?? printer.name,
        brand: 'bambu' as const,
        status: getLiveStatus(printer.id),
        thumbnailUrl: getCurrentThumbnail(printer.id),
      }
    }
    return {
      printerId: printer.id,
      name: printer.nickname ?? printer.name,
      brand: 'anycubic' as const,
      status: getAnycubicLiveStatus(printer.id),
      thumbnailUrl: null,
    }
  })
}

// Histórico oficial completo da conta Bambu -- busca ao vivo direto da
// nuvem a cada chamada, nunca salvo no banco (é literalmente o registro
// deles, não precisa duplicar). Paginado por cursor (ver lib/bambu/auth.ts).
export async function getBambuTaskHistory(
  cursor?: string,
): Promise<{ success: boolean; tasks?: BambuCloudTaskFull[]; nextCursor?: string | null; error?: string }> {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } })
  if (!settings?.bambuCloudCredentialEncrypted) {
    return { success: false, error: 'Conecte a conta Bambu em Configurações primeiro' }
  }
  try {
    const token = decryptCredential(settings.bambuCloudCredentialEncrypted)
    const { tasks, nextCursor } = await fetchTaskHistory(token, { cursor })
    return { success: true, tasks, nextCursor }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Falha ao buscar histórico' }
  }
}

const CAPTURE_WINDOW_HOURS = 48

export async function getAvailablePrinterCapture(printerId: string) {
  if (!printerId) return null
  const since = new Date(Date.now() - CAPTURE_WINDOW_HOURS * 3_600_000)
  const capture = await prisma.printerCapture.findFirst({
    where: { printerId, linkedPlateId: null, finishedAt: { gte: since } },
    orderBy: { finishedAt: 'desc' },
  })
  if (!capture) return null
  return {
    id: capture.id,
    finishedAt: capture.finishedAt,
    durationHours: capture.durationHours.toNumber(),
    gramsUsedTotal: capture.gramsUsedTotal?.toNumber() ?? null,
    outcome: capture.outcome,
    gcodeFileName: capture.gcodeFileName,
  }
}
