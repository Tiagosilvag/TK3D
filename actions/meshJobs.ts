'use server'
import { revalidatePath } from 'next/cache'
import { createJob, deleteJob, listRecentJobs, type MeshJobSummary } from '@/lib/meshJobs/jobs'

type ActionResult = { success: boolean; error?: string }

// Mesmos limites/tipos aceitos de actions/productPhotos.ts, ajustados
// pro tamanho de imagem de entrada do gerador (ver spec §3/§7).
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export async function createMeshJob(formData: FormData): Promise<ActionResult> {
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, error: 'Selecione uma imagem' }
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return { success: false, error: 'Formato não suportado (use JPEG, PNG ou WEBP)' }
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { success: false, error: 'Imagem muito grande (máximo 10MB)' }
  }

  const data = Buffer.from(await file.arrayBuffer())
  await createJob({ data, contentType: file.type, sizeBytes: file.size })

  revalidatePath('/3d-generator')
  return { success: true }
}

export async function deleteMeshJob(id: string): Promise<ActionResult> {
  await deleteJob(id)
  revalidatePath('/3d-generator')
  return { success: true }
}

export async function getRecentMeshJobs(): Promise<MeshJobSummary[]> {
  return listRecentJobs()
}
