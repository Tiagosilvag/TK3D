'use server'
import { prisma } from '@/lib/prisma'
import { settingsSchema } from '@/lib/validation/settings'
import { revalidatePath } from 'next/cache'

type ActionResult = { success: boolean; error?: string }

// Settings is a singleton (id always 1): there is no create/delete, only
// this upsert-based update.
export async function updateSettings(formData: FormData): Promise<ActionResult> {
  const parsed = settingsSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  await prisma.settings.upsert({ where: { id: 1 }, update: parsed.data, create: { id: 1, ...parsed.data } })
  revalidatePath('/settings')
  return { success: true }
}
