// Cada mensagem MQTT da Anycubic carrega só um pedaço do estado (ex.: uma
// mensagem type=fan só fala de ventoinha) -- diferente da Bambu, que manda
// o "report" quase inteiro a cada tick. Por isso o parser devolve um PATCH
// parcial pra mesclar no estado acumulado (ver applyStatusPatch), não um
// objeto completo. Mapeamento de campos vem da leitura do código-fonte do
// projeto de referência (ver spec §2.2) -- unidades de remain_time/
// print_time/supplies_usage não confirmadas contra uma conta real ainda
// (mesma ressalva que a Bambu teve pro peso, resolvida com teste ao vivo).
export type AnycubicPrintState = 'IDLE' | 'DOWNLOADING' | 'CHECKING' | 'PREHEATING' | 'PRINTING' | 'PAUSED' | 'FINISHED' | 'CANCELLED'

export type AnycubicStatus = {
  printState: AnycubicPrintState
  progressPercent: number | null
  remainingMinutes: number | null
  currentLayer: number | null
  totalLayers: number | null
  gcodeFile: string | null
  printTimeSeconds: number | null
  nozzleTemp: number | null
  bedTemp: number | null
  fanSpeedPercent: number | null
  suppliesUsage: number | null
}

export const INITIAL_ANYCUBIC_STATUS: AnycubicStatus = {
  printState: 'IDLE',
  progressPercent: null,
  remainingMinutes: null,
  currentLayer: null,
  totalLayers: null,
  gcodeFile: null,
  printTimeSeconds: null,
  nozzleTemp: null,
  bedTemp: null,
  fanSpeedPercent: null,
  suppliesUsage: null,
}

export type AnycubicMqttMessage = {
  type: string
  action: string
  state?: string
  data?: Record<string, unknown>
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseAnycubicPayload(raw: unknown): AnycubicMqttMessage | null {
  if (!isPlainRecord(raw)) return null
  const { type, action, state, data } = raw
  if (typeof type !== 'string' || typeof action !== 'string') return null
  return {
    type,
    action,
    state: typeof state === 'string' ? state : undefined,
    data: isPlainRecord(data) ? data : undefined,
  }
}

function numIfPresent(data: Record<string, unknown> | undefined, key: string): number | undefined {
  if (!data || !(key in data)) return undefined
  const v = data[key]
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v)
  return undefined
}

function strIfPresent(data: Record<string, unknown> | undefined, key: string): string | undefined {
  if (!data || !(key in data)) return undefined
  const v = data[key]
  return typeof v === 'string' ? v : undefined
}

// Estado terminal "failed" não existe como valor próprio no stream da
// Anycubic -- a impressora manda action=start/state=failed, que a própria
// lib de referência trata como Cancelled (com uma mensagem de erro à
// parte). Sem HMS/código de falha equivalente ao da Bambu nesta fase.
const PRINT_STATE_BY_ACTION_STATE: Record<string, AnycubicPrintState> = {
  'start:downloading': 'DOWNLOADING',
  'start:checking': 'CHECKING',
  'start:preheating': 'PREHEATING',
  'start:printing': 'PRINTING',
  'start:finished': 'FINISHED',
  'start:failed': 'CANCELLED',
  'pause:pausing': 'PAUSED',
  'pause:paused': 'PAUSED',
  'resume:resuming': 'PRINTING',
  'resume:resumed': 'PRINTING',
  'start:stoped': 'CANCELLED',
  'start:stopping': 'CANCELLED',
  'stop:stoped': 'CANCELLED',
  'stop:stopping': 'CANCELLED',
  'stop:failed': 'CANCELLED',
}

export function buildStatusPatch(msg: AnycubicMqttMessage): Partial<AnycubicStatus> {
  const patch: Partial<AnycubicStatus> = {}

  if (msg.type === 'tempature' && msg.action === 'auto' && msg.state === 'done') {
    const bed = numIfPresent(msg.data, 'curr_hotbed_temp')
    const nozzle = numIfPresent(msg.data, 'curr_nozzle_temp')
    if (bed !== undefined) patch.bedTemp = bed
    if (nozzle !== undefined) patch.nozzleTemp = nozzle
    return patch
  }

  if (msg.type === 'fan' && msg.action === 'auto' && msg.state === 'done') {
    const fan = numIfPresent(msg.data, 'fan_speed_pct')
    if (fan !== undefined) patch.fanSpeedPercent = fan
    return patch
  }

  if (msg.type === 'print') {
    const printState = PRINT_STATE_BY_ACTION_STATE[`${msg.action}:${msg.state}`]
    if (printState) patch.printState = printState

    const layer = numIfPresent(msg.data, 'curr_layer')
    if (layer !== undefined) patch.currentLayer = layer
    const totalLayers = numIfPresent(msg.data, 'total_layers')
    if (totalLayers !== undefined) patch.totalLayers = totalLayers
    const filename = strIfPresent(msg.data, 'filename')
    if (filename !== undefined) patch.gcodeFile = filename
    const printTime = numIfPresent(msg.data, 'print_time')
    if (printTime !== undefined) patch.printTimeSeconds = printTime
    const progress = numIfPresent(msg.data, 'progress')
    if (progress !== undefined) patch.progressPercent = progress
    const remainTime = numIfPresent(msg.data, 'remain_time')
    if (remainTime !== undefined) patch.remainingMinutes = remainTime
    const supplies = numIfPresent(msg.data, 'supplies_usage')
    if (supplies !== undefined) patch.suppliesUsage = supplies

    return patch
  }

  return patch
}

export function applyStatusPatch(prev: AnycubicStatus, patch: Partial<AnycubicStatus>): AnycubicStatus {
  const next = { ...prev }
  for (const key of Object.keys(patch) as (keyof AnycubicStatus)[]) {
    const value = patch[key]
    if (value !== undefined) (next[key] as unknown) = value
  }
  return next
}
