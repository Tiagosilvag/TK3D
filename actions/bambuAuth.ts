'use server'
import { prisma } from '@/lib/prisma'
import { requestLoginCode, confirmLoginCode } from '@/lib/bambu/auth'
import { encryptCredential } from '@/lib/bambu/crypto'
import { restartBambuListener } from '@/lib/bambu/listener'
import { revalidatePath } from 'next/cache'

type ActionResult = { success: boolean; error?: string }

export async function connectBambuAccountStep1(formData: FormData): Promise<ActionResult & { needsCode?: boolean }> {
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')
  if (!email || !password) return { success: false, error: 'E-mail e senha são obrigatórios' }
  try {
    const result = await requestLoginCode(email, password)
    if (result.status === 'authenticated') {
      await saveCredential(email, result.accessToken)
      return { success: true, needsCode: false }
    }
    return { success: true, needsCode: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Falha ao conectar com a Bambu' }
  }
}

export async function connectBambuAccountStep2(formData: FormData): Promise<ActionResult> {
  const email = String(formData.get('email') ?? '')
  const code = String(formData.get('code') ?? '')
  if (!email || !code) return { success: false, error: 'Código é obrigatório' }
  try {
    const { accessToken } = await confirmLoginCode(email, code)
    await saveCredential(email, accessToken)
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Código inválido' }
  }
  return { success: true }
}

async function saveCredential(email: string, accessToken: string): Promise<void> {
  const encrypted = encryptCredential(accessToken)
  await prisma.settings.upsert({
    where: { id: 1 },
    update: { bambuCloudEmail: email, bambuCloudCredentialEncrypted: encrypted },
    create: { id: 1, bambuCloudEmail: email, bambuCloudCredentialEncrypted: encrypted } as never,
  })
  await restartBambuListener()
  revalidatePath('/settings')
}

export async function disconnectBambuAccount(): Promise<ActionResult> {
  await prisma.settings.upsert({
    where: { id: 1 },
    update: { bambuCloudEmail: null, bambuCloudCredentialEncrypted: null },
    create: { id: 1 } as never,
  })
  await restartBambuListener()
  revalidatePath('/settings')
  return { success: true }
}
