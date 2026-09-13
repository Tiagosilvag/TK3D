// Cliente HTTP da Anycubic Cloud (engenharia reversa comunitária, sem doc
// oficial -- ver spec 2026-09-12 §2). Sem login programático: o usuário
// cola o token extraído manualmente do Anycubic Slicer Next (Windows).
import { buildSignedHeadersNow } from './signing'

const BASE_URL = 'https://cloud-universe.anycubic.com/p/p/workbench/api'
// Bucket S3 público onde a Anycubic guarda as thumbnails de projeto --
// image_id (de GET /v2/project/info) concatenado direto nessa base já é a
// URL da imagem, sem autenticação nenhuma (achado lendo o código de
// referência: PROJECT_IMAGE_URL_BASE + slice_param.image_id).
const PROJECT_IMAGE_BASE_URL = 'https://workbentch.s3.us-east-2.amazonaws.com/'

async function signedFetch(path: string, opts: { method?: 'GET' | 'POST'; body?: unknown; authToken?: string } = {}) {
  const headers = buildSignedHeadersNow(opts.authToken)
  return fetch(`${BASE_URL}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
}

// Copiar a saída do PowerShell (Task de extração do token) pode trazer
// quebras de linha/espaços NO MEIO do JWT, quando o console quebra a linha
// visualmente e isso vira newline literal ao colar -- trim() só limpa as
// pontas. Removendo todo espaço em branco (o token nunca contém espaço de
// verdade) resolve; bug real encontrado testando contra a conta do usuário
// (login retornava "inválido" mesmo com o token certo).
function sanitizeSlicerToken(raw: string): string {
  return raw.replace(/\s+/g, '')
}

export async function exchangeSlicerToken(pastedToken: string): Promise<{ authToken: string }> {
  const res = await signedFetch('/v3/public/loginWithAccessToken', {
    method: 'POST',
    body: { device_type: 'pcf', access_token: sanitizeSlicerToken(pastedToken) },
  })
  if (!res.ok) throw new Error('Falha ao trocar o token do Slicer Next — tente novamente')
  const data = (await res.json()) as { data?: { token?: string } }
  if (!data.data?.token) throw new Error('Token do Slicer Next inválido ou expirado — extraia um novo e cole de novo')
  return { authToken: data.data.token }
}

export async function fetchUserInfo(authToken: string): Promise<{ id: string; email: string }> {
  const res = await signedFetch('/user/profile/userInfo', { authToken })
  if (!res.ok) throw new Error('Falha ao obter dados da conta Anycubic')
  const data = (await res.json()) as { data?: { id?: number | string; user_email?: string } }
  if (data.data?.id === undefined || !data.data.user_email) throw new Error('Anycubic não retornou id/e-mail da conta')
  return { id: String(data.data.id), email: data.data.user_email }
}

export type AnycubicPrinterRef = { key: string; name: string }

// Lista as impressoras vinculadas à conta -- mesmo papel do
// fetchBoundDevices da Bambu, pra escolher a "key" numa lista em vez de
// caçar ela manualmente.
export async function fetchMyPrinters(authToken: string): Promise<AnycubicPrinterRef[]> {
  const res = await signedFetch('/work/printer/getPrinters', { authToken })
  if (!res.ok) throw new Error('Falha ao buscar impressoras da conta Anycubic')
  const data = (await res.json()) as { data?: { key?: string; name?: string }[] }
  return (data.data ?? [])
    .filter((p): p is { key: string; name?: string } => Boolean(p.key))
    .map((p) => ({ key: p.key, name: p.name ?? p.key }))
}

export type AnycubicMaterialUsage = { materialType: string; colorHex: string | null; grams: number }
export type AnycubicProjectInfo = {
  thumbnailUrl: string | null
  materialBreakdown: AnycubicMaterialUsage[] | null
  modelDimensions: string | null
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value)
  return undefined
}

// slice_param vem às vezes como string JSON, às vezes como objeto direto
// (os dois formatos aparecem no código de referência, dependendo do
// endpoint) -- aceita ambos.
function parseSliceParam(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
    } catch {
      return null
    }
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  return null
}

// Cada entrada de paint_infos tem um `filament_used` (gramas) direto --
// confirmado lendo slice_total_filament_used no código de referência, que
// soma esse campo pra cada item da lista sem nenhuma conversão. Nomes de
// cor/material não confirmados contra uma resposta real ainda -- tenta as
// chaves mais prováveis, ignora a entrada se não achar peso nenhuma.
function extractMaterialBreakdown(sliceParam: Record<string, unknown>): AnycubicMaterialUsage[] | null {
  const paintInfos = sliceParam.paint_infos
  if (!Array.isArray(paintInfos)) return null

  const result: AnycubicMaterialUsage[] = []
  for (const entry of paintInfos) {
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as Record<string, unknown>
    const grams = toNumber(e.filament_used ?? e.filament_used_g ?? e.weight)
    if (grams === undefined) continue
    const materialTypeRaw = e.material_type ?? e.type ?? e.material
    const materialType = typeof materialTypeRaw === 'string' ? materialTypeRaw : 'Filamento'
    const colorRaw = e.color ?? e.color_hex ?? e.hex ?? e.material_color
    const colorHex = typeof colorRaw === 'string' ? colorRaw : null
    result.push({ materialType, colorHex, grams })
  }
  return result.length > 0 ? result : null
}

// Nomes de campo de dimensão não confirmados contra uma resposta real --
// tenta as duas variantes mais prováveis (x_size/width etc.).
function extractModelDimensions(sliceParam: Record<string, unknown>): string | null {
  const x = toNumber(sliceParam.x_size ?? sliceParam.width)
  const y = toNumber(sliceParam.y_size ?? sliceParam.depth)
  const z = toNumber(sliceParam.z_size ?? sliceParam.height)
  if (x === undefined || y === undefined || z === undefined) return null
  return `${x} x ${y} x ${z} mm`
}

// Busca a info completa do job (thumbnail + consumo por cor + dimensões)
// pra enriquecer o card de Monitoramento -- disparada quando o taskid muda
// (ver lib/anycubic/listener.ts#onJobStart), mesmo papel do
// fetchLatestTask da Bambu. Nunca lança erro por causa de campo ausente/
// formato inesperado -- devolve null nos campos que não achar, só lança se
// a chamada HTTP em si falhar.
export async function fetchProjectInfo(authToken: string, taskId: number): Promise<AnycubicProjectInfo> {
  const res = await signedFetch(`/v2/project/info?id=${taskId}`, { authToken })
  if (!res.ok) throw new Error('Falha ao buscar informações do job na nuvem Anycubic')
  const data = (await res.json()) as { data?: Record<string, unknown> }
  const projectData = data.data
  if (!projectData) return { thumbnailUrl: null, materialBreakdown: null, modelDimensions: null }

  // DEBUG temporário (2026-09-13): campo de cor dentro de paint_infos e o
  // campo de thumbnail ainda não confirmados contra uma resposta real --
  // esse log aparece nos logs do servidor na próxima vez que um job novo
  // começar, pra eu conseguir ver o JSON de verdade e acertar de vez.
  // Remover depois de confirmado.
  console.error('[anycubic debug] project/info raw response:', JSON.stringify(projectData))

  const sliceParam = parseSliceParam(projectData.slice_param)
  // "img" é o campo confirmado no código de referência (from_list_json);
  // "image_id" no nível raiz ou dentro de slice_param são tentativas
  // alternativas pra essa mesma resposta específica, ainda não confirmadas.
  const imgField = strFromRecord(projectData, 'img') ?? strFromRecord(projectData, 'image_id') ?? strFromRecord(sliceParam, 'image_id')
  const thumbnailUrl = imgField ? (imgField.startsWith('http') ? imgField : `${PROJECT_IMAGE_BASE_URL}${imgField}`) : null

  return {
    thumbnailUrl,
    materialBreakdown: sliceParam ? extractMaterialBreakdown(sliceParam) : null,
    modelDimensions: sliceParam ? extractModelDimensions(sliceParam) : null,
  }
}

function strFromRecord(record: Record<string, unknown> | null, key: string): string | undefined {
  const v = record?.[key]
  return typeof v === 'string' ? v : undefined
}
