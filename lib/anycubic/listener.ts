import mqtt, { MqttClient } from 'mqtt'
import { prisma } from '@/lib/prisma'
import { decryptCredential } from '@/lib/crypto'
import {
  parseAnycubicPayload,
  buildStatusPatch,
  applyStatusPatch,
  extractAnycubicTaskId,
  INITIAL_ANYCUBIC_STATUS,
  type AnycubicStatus,
} from '@/lib/anycubic/parser'
import { createAnycubicJobTracker, type AnycubicCaptureDraft } from '@/lib/anycubic/jobTracker'
import { encryptMqttToken, buildMqttUsername, buildMqttClientId } from '@/lib/anycubic/mqttCrypto'
import { ANYCUBIC_MQTT_CA_CERT, ANYCUBIC_MQTT_CLIENT_CERT, ANYCUBIC_MQTT_CLIENT_KEY } from '@/lib/anycubic/certs'
import { fetchProjectInfo, type AnycubicProjectInfo } from '@/lib/anycubic/auth'

type PrinterRef = { id: string; anycubicEnabled: boolean; anycubicPrinterKey: string | null }

// Núcleo puro/testável -- mesmo formato do lib/bambu/listener.ts#createListenerCore.
// Diferença chave: cada mensagem MQTT da Anycubic é um PATCH parcial (ver
// lib/anycubic/parser.ts), não um "report" completo -- por isso acumula
// via applyStatusPatch em vez de sobrescrever o status inteiro a cada tick.
export function createAnycubicListenerCore(opts: {
  printers: PrinterRef[]
  subscribe: (printerKey: string, onMessage: (payload: unknown) => void) => void
  onCapture: (printerId: string, capture: AnycubicCaptureDraft) => void
  // Dispara UMA vez quando o taskid muda (job novo) -- mesmo papel do
  // onJobStart da Bambu, mas usando o taskid (id do job na Anycubic) em
  // vez do nome do arquivo, já que é o taskid que GET /v2/project/info
  // precisa (ver lib/anycubic/auth.ts#fetchProjectInfo).
  onJobStart?: (printerId: string, taskId: number) => void
}) {
  const liveStatus = new Map<string, AnycubicStatus>()
  const trackers = new Map<string, ReturnType<typeof createAnycubicJobTracker>>()
  const lastTaskId = new Map<string, number>()

  function start() {
    for (const printer of opts.printers) {
      if (!printer.anycubicEnabled || !printer.anycubicPrinterKey) continue
      const tracker = createAnycubicJobTracker()
      trackers.set(printer.id, tracker)
      opts.subscribe(printer.anycubicPrinterKey, (payload) => {
        const msg = parseAnycubicPayload(payload)
        if (!msg) return

        const taskId = extractAnycubicTaskId(msg)
        if (taskId !== undefined && taskId !== lastTaskId.get(printer.id)) {
          lastTaskId.set(printer.id, taskId)
          opts.onJobStart?.(printer.id, taskId)
        }

        const patch = buildStatusPatch(msg)
        const prev = liveStatus.get(printer.id) ?? INITIAL_ANYCUBIC_STATUS
        const next = applyStatusPatch(prev, patch)
        liveStatus.set(printer.id, next)

        const capture = tracker.handleStatus(next, new Date())
        if (capture) opts.onCapture(printer.id, capture)
      })
    }
  }

  function getLiveStatus(printerId: string): AnycubicStatus | null {
    return liveStatus.get(printerId) ?? null
  }

  // Ajuste "controle de impressão Anycubic": pausar/retomar/parar (HTTP,
  // ver lib/anycubic/auth.ts#sendAnycubicOrder) exige o project_id do job
  // atual -- mesmo taskid já rastreado aqui pra disparar onJobStart, só
  // exposto pra fora também.
  function getCurrentTaskId(printerId: string): number | null {
    return lastTaskId.get(printerId) ?? null
  }

  return { start, getLiveStatus, getCurrentTaskId }
}

// --- Casca real (não coberta por teste automatizado -- depende da nuvem
// Anycubic de verdade, ver spec §2/§9) ---

export type AnycubicConnectionStatus = 'connected' | 'expired' | 'not_configured' | 'no_printer'

let connectionStatus: AnycubicConnectionStatus = 'not_configured'
let core: ReturnType<typeof createAnycubicListenerCore> | null = null
let client: MqttClient | null = null
// Info do job atual por impressora (thumbnail + consumo por cor +
// dimensões) -- preenchida quando um job novo começa (onJobStart), via
// GET /v2/project/info. Mesmo padrão do currentThumbnails da Bambu: cache
// em memória separado do status ao vivo, porque vem de uma chamada HTTP
// assíncrona, não do tick do MQTT.
const currentProjectInfo = new Map<string, AnycubicProjectInfo>()

const MQTT_HOST = 'mqtt-universe.anycubic.com'
const MQTT_PORT = 8883
const MQTT_TOPIC_PREFIX = 'anycubic/anycubicCloud/v1'

function buildMqttSslOptions() {
  return {
    ca: ANYCUBIC_MQTT_CA_CERT,
    cert: ANYCUBIC_MQTT_CLIENT_CERT,
    key: ANYCUBIC_MQTT_CLIENT_KEY,
    rejectUnauthorized: false,
    // O certificado CA da Anycubic (2023, "AC Root CA") é assinado com um
    // algoritmo fraco -- OpenSSL moderno recusa por padrão
    // ("ca md too weak", visto em produção). O projeto de referência em
    // Python contorna isso com `set_ciphers('ALL:@SECLEVEL=0')`; o
    // equivalente no TLS do Node é baixar o nível de segurança via sufixo
    // @SECLEVEL=0 na lista de cifras, e travar em TLSv1.2 (mesma versão
    // que o broker deles espera, igual ao PROTOCOL_TLSv1_2 do Python).
    ciphers: 'DEFAULT@SECLEVEL=0',
    minVersion: 'TLSv1.2' as const,
    maxVersion: 'TLSv1.2' as const,
  }
}

export async function startAnycubicListener(): Promise<void> {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } })
  if (!settings?.anycubicAuthTokenEncrypted || !settings.anycubicUserEmail) {
    connectionStatus = 'not_configured'
    return
  }

  const printers = await prisma.printer.findMany({
    where: { anycubicEnabled: true, anycubicPrinterKey: { not: null } },
    select: { id: true, anycubicEnabled: true, anycubicPrinterKey: true },
  })
  if (printers.length === 0) {
    connectionStatus = 'no_printer'
    return
  }

  const authToken = decryptCredential(settings.anycubicAuthTokenEncrypted)
  const email = settings.anycubicUserEmail
  const mqttPassword = encryptMqttToken(authToken)
  const mqttUsername = buildMqttUsername(email, mqttPassword)

  client = mqtt.connect(`mqtts://${MQTT_HOST}:${MQTT_PORT}`, {
    // O client_id de baixo nível do CONNECT precisa ser o MESMO
    // md5(email+"pcf") usado dentro da assinatura do username (ver
    // buildMqttUsername) -- sem isso a lib mqtt gera um id aleatório e o
    // broker recusa com "Connection refused: Not authorized" (bug real
    // encontrado em produção: a conta conectava certinho via HTTP, só o
    // MQTT que rejeitava).
    clientId: buildMqttClientId(email),
    username: mqttUsername,
    password: mqttPassword,
    reconnectPeriod: 5000,
    ...buildMqttSslOptions(),
  })

  client.on('connect', () => {
    connectionStatus = 'connected'
    console.error(`[anycubic] MQTT conectado (pid=${process.pid})`)
  })
  client.on('error', (err) => {
    connectionStatus = 'expired'
    console.error('[anycubic] erro na conexão MQTT:', err.message)
    // CONNACK negativo (credencial errada/expirada, não autorizado etc.)
    // nunca se resolve tentando de novo -- deixar o reconnectPeriod bater
    // insistentemente nesse tipo de erro foi o que disparou uma race
    // condition real na lib mqtt (um timer de "connack timeout" de uma
    // tentativa anterior virando exceção não tratada e derrubando o
    // processo INTEIRO, inclusive o listener da Bambu, visto em produção).
    // Parar de vez aqui e exigir reconectar manual (botão em Configurações)
    // depois de corrigir a credencial.
    if (err.message.startsWith('Connection refused:')) client?.end(true)
  })

  core = createAnycubicListenerCore({
    printers,
    subscribe: (printerKey, onMessage) => {
      // O projeto de referência assina DOIS padrões de tópico por
      // impressora, não um -- "printer/app/..." (visto inicialmente) e
      // "+/public/..." (achado relendo o código de referência depois de
      // testar contra a conta real e não chegar report nenhum). A key da
      // impressora cai sempre no índice 6 em ambos os formatos, então dá
      // pra rotear os dois com o mesmo filtro. machine_type vira "+" nos
      // dois (não precisamos saber o valor exato, só filtrar por key).
      const topics = [
        `${MQTT_TOPIC_PREFIX}/printer/app/+/${printerKey}/#`,
        `${MQTT_TOPIC_PREFIX}/+/public/+/${printerKey}/#`,
      ]
      for (const topic of topics) client!.subscribe(topic)
      client!.on('message', (receivedTopic, buffer) => {
        const parts = receivedTopic.split('/')
        if (parts[6] !== printerKey) return
        try {
          onMessage(JSON.parse(buffer.toString()))
        } catch {
          // payload malformado -- ignora esta mensagem, mantém a conexão
        }
      })
    },
    onCapture: async (printerId, capture) => {
      await prisma.printerCapture.create({
        data: {
          printerId,
          startedAt: capture.startedAt,
          finishedAt: capture.finishedAt,
          gcodeFileName: capture.gcodeFileName,
          durationHours: capture.durationHours,
          gramsUsedTotal: capture.gramsUsedTotal,
          outcome: capture.outcome === 'FINISHED' ? 'FINISHED' : capture.outcome === 'CANCELLED' ? 'CANCELLED' : 'UNKNOWN',
        },
      })
      currentProjectInfo.delete(printerId)
    },
    onJobStart: async (printerId, taskId) => {
      try {
        const info = await fetchProjectInfo(authToken, taskId)
        currentProjectInfo.set(printerId, info)
      } catch (err) {
        console.error('[anycubic] falha ao buscar info do job atual:', err)
      }
    },
  })
  core.start()
}

export function getAnycubicLiveStatus(printerId: string): AnycubicStatus | null {
  return core?.getLiveStatus(printerId) ?? null
}

export function getAnycubicProjectInfo(printerId: string): AnycubicProjectInfo | null {
  return currentProjectInfo.get(printerId) ?? null
}

export function getAnycubicCurrentTaskId(printerId: string): number | null {
  return core?.getCurrentTaskId(printerId) ?? null
}

export async function restartAnycubicListener(reason: string = 'desconhecido'): Promise<void> {
  // Diagnóstico (mesmo bug investigado no listener Bambu, 2026-09-14): loga
  // quem chamou o restart, pra confirmar se os dois listeners estão sendo
  // reiniciados repetidamente pela mesma causa.
  console.error(`[anycubic] restartAnycubicListener chamado (motivo: ${reason}, pid=${process.pid})`)
  if (client) {
    client.removeAllListeners()
    client.end(true)
    client = null
  }
  core = null
  currentProjectInfo.clear()
  connectionStatus = 'not_configured'
  await startAnycubicListener()
}

export function getAnycubicConnectionStatus(): AnycubicConnectionStatus {
  return connectionStatus
}
