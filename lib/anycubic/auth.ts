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

// `id` (numérico) e `key` (hash usado nos tópicos MQTT) são campos
// DIFERENTES na resposta da Anycubic -- controle de impressão
// (sendAnycubicOrder) exige o `id`, monitoramento MQTT exige a `key`.
export type AnycubicPrinterRef = { id: number; key: string; name: string }

// Lista as impressoras vinculadas à conta -- mesmo papel do
// fetchBoundDevices da Bambu, pra escolher a "key"/id numa lista em vez de
// caçar eles manualmente.
export async function fetchMyPrinters(authToken: string): Promise<AnycubicPrinterRef[]> {
  const res = await signedFetch('/work/printer/getPrinters', { authToken })
  if (!res.ok) throw new Error('Falha ao buscar impressoras da conta Anycubic')
  const data = (await res.json()) as { data?: { id?: number; key?: string; name?: string }[] }
  return (data.data ?? [])
    .filter((p): p is { id: number; key: string; name?: string } => typeof p.id === 'number' && Boolean(p.key))
    .map((p) => ({ id: p.id, key: p.key, name: p.name ?? p.key }))
}

// order_id visto no código de referência (hass-anycubic_cloud_v3,
// enums.py#AnycubicOrderID) -- não documentado oficialmente.
export const ANYCUBIC_ORDER_ID = {
  PAUSE_PRINT: 2,
  RESUME_PRINT: 3,
  STOP_PRINT: 4,
} as const

// Controle de impressão (pausar/retomar/parar) da Anycubic é feito por
// HTTP, não MQTT publish como a Bambu -- POST /work/operation/sendOrder
// (achado lendo hass-anycubic_cloud_v3, functions.py#_send_order_pause_print
// e data_models/orders.py#AnycubicProjectCtrlOrderRequest.order_request_data).
// printerId é o id NUMÉRICO (não a key), projectId é o id do job/task atual
// (mesmo valor usado em fetchProjectInfo).
export async function sendAnycubicOrder(
  authToken: string,
  opts: { printerId: number; projectId: number; orderId: number },
): Promise<void> {
  const res = await signedFetch('/work/operation/sendOrder', {
    method: 'POST',
    authToken,
    body: {
      order_id: opts.orderId,
      printer_id: opts.printerId,
      project_id: opts.projectId,
      data: null,
      ams_info: null,
      settings: null,
    },
  })
  if (!res.ok) throw new Error('Falha ao enviar comando pra impressora Anycubic')
  const data = (await res.json()) as { data?: { msgid?: string } | null; msg?: string }
  if (data.data === null || data.data === undefined) {
    throw new Error(data.msg ? `Anycubic recusou o comando: ${data.msg}` : 'Anycubic recusou o comando')
  }
}

export type AnycubicMaterialUsage = { materialType: string; colorHex: string | null; grams: number }
export type AnycubicProjectInfo = {
  thumbnailUrl: string | null
  materialBreakdown: AnycubicMaterialUsage[] | null
  modelDimensions: string | null
  // Nomes reais dos modos de velocidade (ex.: {1: 'Quiet', 2: 'Standard',
  // 3: 'Sport'}), confirmados contra resposta real em print_speed_model_des
  // -- chave é o mesmo número de printSpeedMode que já vem do MQTT ao vivo.
  printSpeedModeLabels: Record<number, string> | null
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

// paint_color vem como array RGB [r,g,b] (0-255) -- confirmado contra
// resposta real. Vira hex pra usar direto como CSS backgroundColor.
function rgbArrayToHex(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length < 3) return undefined
  const [r, g, b] = value
  if (![r, g, b].every((c) => typeof c === 'number' && c >= 0 && c <= 255)) return undefined
  const toHex = (c: number) => Math.round(c).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

// Cada entrada de paint_infos tem um `filament_used` (gramas) direto --
// confirmado lendo slice_total_filament_used no código de referência, que
// soma esse campo pra cada item da lista sem nenhuma conversão, e também
// contra resposta real. Cor vem como paint_color [r,g,b] (confirmado);
// color/color_hex/hex como string ficam de fallback defensivo caso a
// Anycubic mude o formato.
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
    const colorHex = typeof colorRaw === 'string' ? colorRaw : (rgbArrayToHex(e.paint_color) ?? null)
    result.push({ materialType, colorHex, grams })
  }
  return result.length > 0 ? result : null
}

// Dimensões vêm em slice_result.size_x/size_y/size_z -- um campo IRMÃO de
// slice_param no registro do projeto, não dentro dele (confirmado contra
// resposta real -- diferente do que a primeira tentativa assumiu).
function extractModelDimensions(record: Record<string, unknown>): string | null {
  const sliceResult = record.slice_result
  if (typeof sliceResult !== 'object' || sliceResult === null) return null
  const sr = sliceResult as Record<string, unknown>
  const x = toNumber(sr.size_x)
  const y = toNumber(sr.size_y)
  const z = toNumber(sr.size_z)
  if (x === undefined || y === undefined || z === undefined) return null
  return `${x} x ${y} x ${z} mm`
}

// print_speed_model_des dá o nome real de cada modo (confirmado contra
// resposta real: [{print_speed_mode:1,title:'Quiet'}, ...]) -- chave pelo
// mesmo número que já vem em printSpeedMode no status ao vivo (MQTT).
function extractPrintSpeedModeLabels(record: Record<string, unknown>): Record<number, string> | null {
  const list = record.print_speed_model_des
  if (!Array.isArray(list)) return null
  const labels: Record<number, string> = {}
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as Record<string, unknown>
    const mode = toNumber(e.print_speed_mode)
    const title = e.title
    if (mode !== undefined && typeof title === 'string') labels[mode] = title
  }
  return Object.keys(labels).length > 0 ? labels : null
}

function strFromRecord(record: Record<string, unknown> | null, key: string): string | undefined {
  const v = record?.[key]
  return typeof v === 'string' ? v : undefined
}

// Thumbnail + consumo por cor + dimensões a partir de um registro de
// projeto -- reaproveitado tanto pro job atual (fetchProjectInfo) quanto
// pro histórico (fetchProjectHistory), já que os dois vêm no mesmo shape
// de registro (img/slice_param no nível raiz).
function extractThumbnailAndSliceInfo(record: Record<string, unknown>): AnycubicProjectInfo {
  const sliceParam = parseSliceParam(record.slice_param)
  // "img" é o campo confirmado no código de referência (from_list_json);
  // "image_id" no nível raiz ou dentro de slice_param são tentativas
  // alternativas, ainda não confirmadas contra uma resposta real.
  const imgField = strFromRecord(record, 'img') ?? strFromRecord(record, 'image_id') ?? strFromRecord(sliceParam, 'image_id')
  const thumbnailUrl = imgField ? (imgField.startsWith('http') ? imgField : `${PROJECT_IMAGE_BASE_URL}${imgField}`) : null

  return {
    thumbnailUrl,
    materialBreakdown: sliceParam ? extractMaterialBreakdown(sliceParam) : null,
    modelDimensions: extractModelDimensions(record),
    printSpeedModeLabels: extractPrintSpeedModeLabels(record),
  }
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
  if (!projectData) return { thumbnailUrl: null, materialBreakdown: null, modelDimensions: null, printSpeedModeLabels: null }

  return extractThumbnailAndSliceInfo(projectData)
}

export type AnycubicHistoryTask = {
  id: string
  gcodeName: string | null
  printerName: string | null
  // Valor bruto de AnycubicPrintStatus (1=Printing, 2=Complete,
  // 3=Cancelled, 4=Downloading, 5=Checking, 6=Preheating, 7=Slicing) --
  // sem tradução aqui, a UI decide o rótulo.
  printStatus: number | null
  createTime: number | null
  startTime: number | null
  endTime: number | null
  printTimeMinutes: number | null
} & AnycubicProjectInfo

const HISTORY_PAGE_SIZE = 20

// Histórico oficial completo da conta Anycubic -- busca ao vivo direto da
// nuvem a cada chamada, nunca salvo no banco, mesmo padrão do
// fetchTaskHistory da Bambu. Endpoint real e ativo (GET
// /work/project/getProjects), não é o "WIP" -- usado pela própria lib de
// referência pra listar o histórico. create_time/start_time/end_time em
// segundos Unix (confirmado pelo mesmo formato usado em user_email/
// casdoor_user.create_time na resposta de login).
export async function fetchProjectHistory(
  authToken: string,
  opts: { page?: number } = {},
): Promise<{ tasks: AnycubicHistoryTask[]; hasMore: boolean }> {
  const page = opts.page ?? 1
  const res = await signedFetch(`/work/project/getProjects?page=${page}&limit=${HISTORY_PAGE_SIZE}`, { authToken })
  if (!res.ok) throw new Error('Falha ao buscar histórico de impressões da Anycubic')
  const data = (await res.json()) as { data?: unknown[] }
  const records = Array.isArray(data.data) ? data.data : []

  const tasks = records
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    .map((record) => ({
      id: String(record.id ?? record.taskid ?? ''),
      gcodeName: strFromRecord(record, 'gcode_name') ?? strFromRecord(record, 'model') ?? null,
      printerName: strFromRecord(record, 'printer_name') ?? strFromRecord(record, 'machine_name') ?? null,
      printStatus: toNumber(record.print_status) ?? null,
      createTime: toNumber(record.create_time) ?? null,
      startTime: toNumber(record.start_time) ?? null,
      endTime: toNumber(record.end_time) ?? null,
      printTimeMinutes: toNumber(record.print_time) ?? null,
      ...extractThumbnailAndSliceInfo(record),
    }))

  return { tasks, hasMore: records.length >= HISTORY_PAGE_SIZE }
}
