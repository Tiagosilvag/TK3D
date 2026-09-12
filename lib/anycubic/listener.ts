import mqtt, { MqttClient } from 'mqtt'
import { prisma } from '@/lib/prisma'
import { decryptCredential } from '@/lib/crypto'
import {
  parseAnycubicPayload,
  buildStatusPatch,
  applyStatusPatch,
  INITIAL_ANYCUBIC_STATUS,
  type AnycubicStatus,
} from '@/lib/anycubic/parser'
import { createAnycubicJobTracker, type AnycubicCaptureDraft } from '@/lib/anycubic/jobTracker'
import { encryptMqttToken, buildMqttUsername, buildMqttClientId } from '@/lib/anycubic/mqttCrypto'
import { ANYCUBIC_MQTT_CA_CERT, ANYCUBIC_MQTT_CLIENT_CERT, ANYCUBIC_MQTT_CLIENT_KEY } from '@/lib/anycubic/certs'

type PrinterRef = { id: string; anycubicEnabled: boolean; anycubicPrinterKey: string | null }

// Núcleo puro/testável -- mesmo formato do lib/bambu/listener.ts#createListenerCore.
// Diferença chave: cada mensagem MQTT da Anycubic é um PATCH parcial (ver
// lib/anycubic/parser.ts), não um "report" completo -- por isso acumula
// via applyStatusPatch em vez de sobrescrever o status inteiro a cada tick.
export function createAnycubicListenerCore(opts: {
  printers: PrinterRef[]
  subscribe: (printerKey: string, onMessage: (payload: unknown) => void) => void
  onCapture: (printerId: string, capture: AnycubicCaptureDraft) => void
}) {
  const liveStatus = new Map<string, AnycubicStatus>()
  const trackers = new Map<string, ReturnType<typeof createAnycubicJobTracker>>()

  function start() {
    for (const printer of opts.printers) {
      if (!printer.anycubicEnabled || !printer.anycubicPrinterKey) continue
      const tracker = createAnycubicJobTracker()
      trackers.set(printer.id, tracker)
      opts.subscribe(printer.anycubicPrinterKey, (payload) => {
        const msg = parseAnycubicPayload(payload)
        if (!msg) return
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

  return { start, getLiveStatus }
}

// --- Casca real (não coberta por teste automatizado -- depende da nuvem
// Anycubic de verdade, ver spec §2/§9) ---

export type AnycubicConnectionStatus = 'connected' | 'expired' | 'not_configured' | 'no_printer'

let connectionStatus: AnycubicConnectionStatus = 'not_configured'
let core: ReturnType<typeof createAnycubicListenerCore> | null = null
let client: MqttClient | null = null

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
      // machine_type não é usado pra roteamento aqui -- assina com "+" no
      // lugar dele, já que só precisamos filtrar por key (o "+" aceita
      // qualquer machine_type, sem precisar saber o valor exato).
      const topic = `${MQTT_TOPIC_PREFIX}/printer/app/+/${printerKey}/#`
      client!.subscribe(topic)
      client!.on('message', (receivedTopic, buffer) => {
        const parts = receivedTopic.split('/')
        if (parts[3] !== 'printer' || parts[4] !== 'app' || parts[6] !== printerKey) return
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
    },
  })
  core.start()
}

export function getAnycubicLiveStatus(printerId: string): AnycubicStatus | null {
  return core?.getLiveStatus(printerId) ?? null
}

export async function restartAnycubicListener(): Promise<void> {
  if (client) {
    client.removeAllListeners()
    client.end(true)
    client = null
  }
  core = null
  connectionStatus = 'not_configured'
  await startAnycubicListener()
}

export function getAnycubicConnectionStatus(): AnycubicConnectionStatus {
  return connectionStatus
}
