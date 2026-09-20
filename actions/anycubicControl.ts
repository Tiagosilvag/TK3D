'use server'
import { prisma } from '@/lib/prisma'
import { decryptCredential } from '@/lib/crypto'
import { sendAnycubicOrder, ANYCUBIC_ORDER_ID } from '@/lib/anycubic/auth'
import { getAnycubicCurrentTaskId, refreshAnycubicStatusNow } from '@/lib/anycubic/listener'
import { revalidatePath } from 'next/cache'

type ActionResult = { success: boolean; error?: string }

// Espelha actions/bambuControl.ts, mas o transporte é HTTP (sendAnycubicOrder)
// em vez de MQTT publish -- ver lib/anycubic/auth.ts#sendAnycubicOrder.
async function runCommand(printerId: string, orderId: number): Promise<ActionResult> {
  try {
    const settings = await prisma.settings.findUnique({ where: { id: 1 } })
    if (!settings?.anycubicAuthTokenEncrypted) {
      console.error('[anycubic] comando recusado -- conta não conectada')
      return { success: false, error: 'Conecte a conta Anycubic em Configurações primeiro' }
    }
    const printer = await prisma.printer.findUnique({ where: { id: printerId }, select: { anycubicPrinterId: true } })
    if (!printer?.anycubicPrinterId) {
      console.error(`[anycubic] comando recusado -- printer ${printerId} sem anycubicPrinterId`)
      return { success: false, error: 'Impressora sem id Anycubic configurado -- selecione ela de novo em Impressoras' }
    }
    const projectId = getAnycubicCurrentTaskId(printerId)
    if (!projectId) {
      console.error(
        `[anycubic] comando recusado -- sem taskId em memória pro printer ${printerId} (listener sem job ativo registrado, pid=${process.pid})`,
      )
      return { success: false, error: 'Nenhuma impressão em andamento pra controlar' }
    }
    const authToken = decryptCredential(settings.anycubicAuthTokenEncrypted)
    await sendAnycubicOrder(authToken, { printerId: printer.anycubicPrinterId, projectId, orderId })
    // A impressora leva um instante pra aplicar o comando -- confere o status
    // por HTTP logo depois (sem bloquear a resposta ao usuário).
    setTimeout(() => void refreshAnycubicStatusNow().catch(() => {}), 2500)
    revalidatePath('/monitor')
    return { success: true }
  } catch (err) {
    console.error('[anycubic] falha ao enviar comando:', err)
    return { success: false, error: err instanceof Error ? err.message : 'Falha ao enviar comando' }
  }
}

export async function pauseAnycubicPrintJob(printerId: string): Promise<ActionResult> {
  return runCommand(printerId, ANYCUBIC_ORDER_ID.PAUSE_PRINT)
}

export async function resumeAnycubicPrintJob(printerId: string): Promise<ActionResult> {
  return runCommand(printerId, ANYCUBIC_ORDER_ID.RESUME_PRINT)
}

export async function stopAnycubicPrintJob(printerId: string): Promise<ActionResult> {
  return runCommand(printerId, ANYCUBIC_ORDER_ID.STOP_PRINT)
}
