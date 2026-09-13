// Cada mensagem MQTT da Anycubic carrega só um pedaço do estado (ex.: uma
// mensagem type=fan só fala de ventoinha) -- diferente da Bambu, que manda
// o "report" quase inteiro a cada tick. Por isso o parser devolve um PATCH
// parcial pra mesclar no estado acumulado (ver applyStatusPatch), não um
// objeto completo. Mapeamento de campos vem da leitura do código-fonte do
// projeto de referência (ver spec §2.2) -- remain_time confirmado em
// MINUTOS testando ao vivo (79→76 acompanhando o relógio real); print_time
// tratado como minuto também por simetria de nome/mensagem com remain_time
// (mesma inferência, não 100% confirmada de forma independente --
// supplies_usage (gramas) ainda não confirmado, mas é o mesmo "Consumo
// estimado" que o próprio Anycubic Slicer mostra na tela de detalhes do
// job).
export type AnycubicPrintState = 'IDLE' | 'DOWNLOADING' | 'CHECKING' | 'PREHEATING' | 'PRINTING' | 'PAUSED' | 'FINISHED' | 'CANCELLED'

export type AnycubicStatus = {
  printState: AnycubicPrintState
  progressPercent: number | null
  remainingMinutes: number | null
  currentLayer: number | null
  totalLayers: number | null
  gcodeFile: string | null
  printTimeMinutes: number | null
  nozzleTemp: number | null
  bedTemp: number | null
  nozzleTargetTemp: number | null
  bedTargetTemp: number | null
  fanSpeedPercent: number | null
  printSpeedPercent: number | null
  printSpeedMode: number | null
  suppliesUsage: number | null
  firmwareVersion: string | null
  printErrorMessage: string | null
}

export const INITIAL_ANYCUBIC_STATUS: AnycubicStatus = {
  printState: 'IDLE',
  progressPercent: null,
  remainingMinutes: null,
  currentLayer: null,
  totalLayers: null,
  gcodeFile: null,
  printTimeMinutes: null,
  nozzleTemp: null,
  bedTemp: null,
  nozzleTargetTemp: null,
  bedTargetTemp: null,
  fanSpeedPercent: null,
  printSpeedPercent: null,
  printSpeedMode: null,
  suppliesUsage: null,
  firmwareVersion: null,
  printErrorMessage: null,
}

export type AnycubicMqttMessage = {
  type: string
  action: string
  state?: string
  data?: Record<string, unknown>
  // Mensagem de erro de falha de impressão vem no nível raiz do payload
  // (payload.msg), não dentro de data -- só a Anycubic mesmo, ver
  // buildStatusPatch.
  msg?: string
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseAnycubicPayload(raw: unknown): AnycubicMqttMessage | null {
  if (!isPlainRecord(raw)) return null
  const { type, action, state, data, msg } = raw
  if (typeof type !== 'string' || typeof action !== 'string') return null
  return {
    type,
    action,
    state: typeof state === 'string' ? state : undefined,
    data: isPlainRecord(data) ? data : undefined,
    msg: typeof msg === 'string' ? msg : undefined,
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

  if (msg.type === 'ota' && msg.action === 'reportVersion' && msg.state === 'done') {
    const firmwareVersion = strIfPresent(msg.data, 'firmware_version')
    if (firmwareVersion !== undefined) patch.firmwareVersion = firmwareVersion
    return patch
  }

  if (msg.type === 'print') {
    const printState = PRINT_STATE_BY_ACTION_STATE[`${msg.action}:${msg.state}`]
    if (printState) patch.printState = printState

    if ((msg.action === 'start' || msg.action === 'stop') && msg.state === 'failed' && msg.msg) {
      patch.printErrorMessage = msg.msg
    }

    const layer = numIfPresent(msg.data, 'curr_layer')
    if (layer !== undefined) patch.currentLayer = layer
    const totalLayers = numIfPresent(msg.data, 'total_layers')
    if (totalLayers !== undefined) patch.totalLayers = totalLayers
    const filename = strIfPresent(msg.data, 'filename')
    if (filename !== undefined) patch.gcodeFile = filename
    const printTime = numIfPresent(msg.data, 'print_time')
    if (printTime !== undefined) patch.printTimeMinutes = printTime
    const progress = numIfPresent(msg.data, 'progress')
    if (progress !== undefined) patch.progressPercent = progress
    const remainTime = numIfPresent(msg.data, 'remain_time')
    if (remainTime !== undefined) patch.remainingMinutes = remainTime
    const supplies = numIfPresent(msg.data, 'supplies_usage')
    if (supplies !== undefined) patch.suppliesUsage = supplies

    // Temperatura atual também vem embutida em mensagens type=print (não só
    // no type=tempature dedicado) -- ex.: junto do início/andamento do job.
    const bedTemp = numIfPresent(msg.data, 'curr_hotbed_temp')
    if (bedTemp !== undefined) patch.bedTemp = bedTemp
    const nozzleTemp = numIfPresent(msg.data, 'curr_nozzle_temp')
    if (nozzleTemp !== undefined) patch.nozzleTemp = nozzleTemp

    // Temperatura ALVO e velocidade só vêm aninhadas em data.settings, numa
    // mensagem à parte (action=start|update, state=updated) que é só uma
    // notificação de ajuste de configuração -- não muda o printState.
    const settings = isPlainRecord(msg.data?.settings) ? (msg.data?.settings as Record<string, unknown>) : undefined
    const fanSpeed = numIfPresent(settings, 'fan_speed_pct')
    if (fanSpeed !== undefined) patch.fanSpeedPercent = fanSpeed
    const printSpeedPercent = numIfPresent(settings, 'print_speed_pct')
    if (printSpeedPercent !== undefined) patch.printSpeedPercent = printSpeedPercent
    const printSpeedMode = numIfPresent(settings, 'print_speed_mode')
    if (printSpeedMode !== undefined) patch.printSpeedMode = printSpeedMode
    const bedTargetTemp = numIfPresent(settings, 'target_hotbed_temp')
    if (bedTargetTemp !== undefined) patch.bedTargetTemp = bedTargetTemp
    const nozzleTargetTemp = numIfPresent(settings, 'target_nozzle_temp')
    if (nozzleTargetTemp !== undefined) patch.nozzleTargetTemp = nozzleTargetTemp

    return patch
  }

  return patch
}

// O taskid identifica o job pra buscar depois em GET /v2/project/info
// (thumbnail + consumo por cor + dimensões, ver lib/anycubic/auth.ts) --
// mesmo campo que a própria Anycubic usa internamente pra correlacionar
// mensagens MQTT de progresso ao projeto (visto no código de referência).
// Função separada de buildStatusPatch porque o listener usa isso pra
// decidir quando buscar a info do job (ver onJobStart), não é parte do
// status ao vivo que a UI lê.
export function extractAnycubicTaskId(msg: AnycubicMqttMessage): number | undefined {
  if (msg.type !== 'print') return undefined
  return numIfPresent(msg.data, 'taskid')
}

export function applyStatusPatch(prev: AnycubicStatus, patch: Partial<AnycubicStatus>): AnycubicStatus {
  const next = { ...prev }
  for (const key of Object.keys(patch) as (keyof AnycubicStatus)[]) {
    const value = patch[key]
    if (value !== undefined) (next[key] as unknown) = value
  }
  return next
}
