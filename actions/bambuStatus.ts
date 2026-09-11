'use server'
import { prisma } from '@/lib/prisma'
import { getLiveStatus, getConnectionStatus, restartBambuListener } from '@/lib/bambu/listener'
import { revalidatePath } from 'next/cache'

export async function getBambuConnectionStatus() {
  return getConnectionStatus()
}

// Reconecta manualmente (ex.: sessão expirada) sem precisar de restart do
// container -- ver lib/bambu/listener.ts#restartBambuListener.
export async function reconnectBambuListener(): Promise<{ success: boolean }> {
  await restartBambuListener()
  revalidatePath('/settings')
  revalidatePath('/monitor')
  return { success: true }
}

export async function getAllLiveBambuStatuses() {
  const printers = await prisma.printer.findMany({
    where: { bambuEnabled: true, active: true },
    select: { id: true, name: true, nickname: true },
  })
  return printers.map((printer) => ({
    printerId: printer.id,
    name: printer.nickname ?? printer.name,
    status: getLiveStatus(printer.id),
  }))
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
