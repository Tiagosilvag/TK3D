'use server'
import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'

type ActionResult = { success: boolean; error?: string }

export async function disconnectMercadoLivre(): Promise<ActionResult> {
  const connection = await prisma.marketplaceConnection.findUnique({ where: { platform: 'MERCADO_LIVRE' } })
  if (!connection) return { success: false, error: 'Mercado Livre não está conectado' }
  await prisma.marketplaceConnection.delete({ where: { platform: 'MERCADO_LIVRE' } })
  revalidatePath('/settings/integrations')
  return { success: true }
}
