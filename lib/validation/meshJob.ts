import { z } from 'zod'

// Valores confirmados no código-fonte oficial do Hunyuan3D 2.1 (não
// inventados): octreeResolution é o parâmetro `octree_resolution` do
// pipeline de forma (default 384 no pipeline, 256 na UI de referência,
// 512 como opção de mais detalhe). textureResolution é o `resolution`
// do Hunyuan3DPaintConfig (README do hy3dpaint documenta 512 ou 768).
export const MESH_OCTREE_RESOLUTIONS = [256, 384, 512] as const
export const MESH_TEXTURE_RESOLUTIONS = [512, 768] as const

export const meshJobGenerationSchema = z.object({
  generateTexture: z.boolean(),
  seed: z.coerce.number().int().min(0).max(2147483647).nullable(),
  octreeResolution: z.coerce.number().int().refine((v) => (MESH_OCTREE_RESOLUTIONS as readonly number[]).includes(v), {
    message: 'Resolução inválida',
  }),
  textureResolution: z.coerce.number().int().refine((v) => (MESH_TEXTURE_RESOLUTIONS as readonly number[]).includes(v), {
    message: 'Resolução de textura inválida',
  }),
  simplifyTarget: z.coerce.number().int().min(1000).max(2000000).nullable(),
})

export type MeshJobGenerationInput = z.infer<typeof meshJobGenerationSchema>
