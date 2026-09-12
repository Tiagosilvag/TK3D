'use server'
import { publishBambuCommand } from '@/lib/bambu/listener'
import { buildPauseCommand, buildResumeCommand, buildStopCommand } from '@/lib/bambu/commands'
import { revalidatePath } from 'next/cache'

type ActionResult = { success: boolean; error?: string }

async function runCommand(printerId: string, command: ReturnType<typeof buildPauseCommand>): Promise<ActionResult> {
  try {
    await publishBambuCommand(printerId, command)
    revalidatePath('/monitor')
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Falha ao enviar comando' }
  }
}

export async function pausePrintJob(printerId: string): Promise<ActionResult> {
  return runCommand(printerId, buildPauseCommand())
}

export async function resumePrintJob(printerId: string): Promise<ActionResult> {
  return runCommand(printerId, buildResumeCommand())
}

export async function stopPrintJob(printerId: string): Promise<ActionResult> {
  return runCommand(printerId, buildStopCommand())
}
