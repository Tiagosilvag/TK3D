// Status ao vivo via HTTP (GET /work/project/getProjects) -- fallback quando o
// MQTT da Anycubic não está entregando dados (em produção a conexão MQTT cai
// milissegundos depois do CONNACK, mas o HTTP funciona: pausar/retomar via
// sendOrder foi confirmado contra a impressora real). Semântica dos campos
// lida em AnycubicProject (hass-anycubic_cloud_v3, data_models/project.py):
// print_status 1=Printing 2=Complete 3=Cancelled 4=Downloading 5=Checking
// 6=Preheating; pause != 0 com print em andamento = pausada; progress em %;
// remain_time/print_time em minutos; camadas em settings.curr_layer/total_layers.
import type { AnycubicPrintState, AnycubicStatus } from './parser'

export type AnycubicLiveProject = {
  // id do projeto -- o mesmo valor do taskid que vem no MQTT e que o
  // sendOrder/project-info usam como project_id.
  id: number
  printerId: number | null
  printStatus: number | null
  paused: boolean
  progressPercent: number | null
  remainingMinutes: number | null
  printTimeMinutes: number | null
  gcodeName: string | null
  currentLayer: number | null
  totalLayers: number | null
}

const IN_PROGRESS_STATUSES = new Set([1, 4, 5, 6])

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value)
  return null
}

// settings vem como objeto ou como string JSON, dependendo do endpoint.
function parseSettings(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
    } catch {
      return null
    }
  }
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
}

export function isInProgressStatus(printStatus: number | null): boolean {
  return printStatus !== null && IN_PROGRESS_STATUSES.has(printStatus)
}

export function parseLiveProject(record: unknown): AnycubicLiveProject | null {
  if (typeof record !== 'object' || record === null) return null
  const r = record as Record<string, unknown>
  const id = toNumber(r.id)
  if (id === null) return null

  const settings = parseSettings(r.settings)
  const pause = toNumber(r.pause)
  const printStatus = toNumber(r.print_status)
  const gcodeName = typeof r.gcode_name === 'string' && r.gcode_name ? r.gcode_name : null

  return {
    id,
    printerId: toNumber(r.printer_id),
    printStatus,
    paused: pause !== null && pause !== 0 && isInProgressStatus(printStatus),
    progressPercent: toNumber(r.progress),
    remainingMinutes: toNumber(r.remain_time),
    printTimeMinutes: toNumber(r.print_time),
    gcodeName,
    currentLayer: toNumber(settings?.curr_layer),
    totalLayers: toNumber(settings?.total_layers),
  }
}

function printStateOf(project: AnycubicLiveProject): AnycubicPrintState | undefined {
  if (project.paused) return 'PAUSED'
  switch (project.printStatus) {
    case 1:
      return 'PRINTING'
    case 2:
      return 'FINISHED'
    case 3:
      return 'CANCELLED'
    case 4:
      return 'DOWNLOADING'
    case 5:
      return 'CHECKING'
    case 6:
      return 'PREHEATING'
    default:
      return undefined
  }
}

// Só inclui no patch o que o registro realmente trouxe -- campo ausente NÃO
// apaga o que o MQTT já preencheu (temperaturas, ventoinha etc. só existem
// via MQTT).
export function statusPatchFromLiveProject(project: AnycubicLiveProject): Partial<AnycubicStatus> {
  const patch: Partial<AnycubicStatus> = {}
  const state = printStateOf(project)
  if (state) patch.printState = state
  if (project.progressPercent !== null) patch.progressPercent = project.progressPercent
  if (project.remainingMinutes !== null) patch.remainingMinutes = project.remainingMinutes
  if (project.printTimeMinutes !== null) patch.printTimeMinutes = project.printTimeMinutes
  if (project.gcodeName) patch.gcodeFile = project.gcodeName
  if (project.currentLayer !== null) patch.currentLayer = project.currentLayer
  if (project.totalLayers !== null) patch.totalLayers = project.totalLayers
  return patch
}
