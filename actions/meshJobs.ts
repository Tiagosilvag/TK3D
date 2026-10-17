'use server'
import { revalidatePath } from 'next/cache'
import { createJob, deleteJob, listRecentJobs, type MeshJobSummary } from '@/lib/meshJobs/jobs'
import { meshJobGenerationSchema } from '@/lib/validation/meshJob'

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

  const randomizeSeed = formData.get('randomizeSeed') === 'on'
  const seedRaw = formData.get('seed')
  // Seed aleatória gerada aqui (não no worker) pra já ficar gravada no
  // job e aparecer na tela -- reprodutível mesmo com "aleatória" marcado.
  const seed = randomizeSeed ? Math.floor(Math.random() * 2147483647) : seedRaw ? Number(seedRaw) : null

  const simplifyRaw = formData.get('simplifyTarget')
  // O <select> de resolução de textura só existe no DOM quando "Gerar
  // textura" está marcado (ver MeshJobsExplorer.tsx) -- com o checkbox
  // desmarcado o campo nem é enviado no form, então cai aqui como null.
  // Nesse caso o valor é irrelevante (textura não vai ser gerada), mas a
  // coluna no banco não aceita nulo -- usa o próprio default do schema.
  const textureResolutionRaw = formData.get('textureResolution')

  const parsed = meshJobGenerationSchema.safeParse({
    generateTexture: formData.get('generateTexture') === 'on',
    seed,
    octreeResolution: formData.get('octreeResolution'),
    textureResolution: textureResolutionRaw ?? 512,
    simplifyTarget: simplifyRaw && simplifyRaw !== '' ? simplifyRaw : null,
  })
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Configuração inválida' }
  }

  const data = Buffer.from(await file.arrayBuffer())
  await createJob({
    data,
    contentType: file.type,
    sizeBytes: file.size,
    generateTexture: parsed.data.generateTexture,
    seed: parsed.data.seed,
    octreeResolution: parsed.data.octreeResolution,
    textureResolution: parsed.data.textureResolution,
    simplifyTarget: parsed.data.simplifyTarget,
  })

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
