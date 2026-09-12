'use server'
import { prisma } from '@/lib/prisma'
import { exchangeSlicerToken, fetchUserInfo } from '@/lib/anycubic/auth'
import { encryptCredential } from '@/lib/crypto'
import { restartAnycubicListener } from '@/lib/anycubic/listener'
import { revalidatePath } from 'next/cache'

type ActionResult = { success: boolean; error?: string }

export async function connectAnycubicAccount(formData: FormData): Promise<ActionResult> {
  const pastedToken = String(formData.get('slicerToken') ?? '').trim()
  if (!pastedToken) return { success: false, error: 'Cole o token do Slicer Next' }

  try {
    const { authToken } = await exchangeSlicerToken(pastedToken)
    const { id, email } = await fetchUserInfo(authToken)

    await prisma.settings.update({
      where: { id: 1 },
      data: {
        anycubicAuthTokenEncrypted: encryptCredential(authToken),
        anycubicUserEmail: email,
        anycubicUserId: id,
      },
    })

    await restartAnycubicListener()
    revalidatePath('/settings')
    revalidatePath('/monitor')
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Falha ao conectar conta Anycubic' }
  }
}

export async function disconnectAnycubicAccount(): Promise<ActionResult> {
  await prisma.settings.update({
    where: { id: 1 },
    data: { anycubicAuthTokenEncrypted: null, anycubicUserEmail: null, anycubicUserId: null },
  })
  await restartAnycubicListener()
  revalidatePath('/settings')
  revalidatePath('/monitor')
  return { success: true }
}
