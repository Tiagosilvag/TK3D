import mqtt, { MqttClient } from 'mqtt'
import { prisma } from '@/lib/prisma'
import { decryptCredential } from '@/lib/bambu/crypto'
import { parseBambuReport, type BambuStatus } from '@/lib/bambu/parser'
import { createJobTracker, type CaptureDraft } from '@/lib/bambu/jobTracker'

type PrinterRef = { id: string; bambuEnabled: boolean; bambuSerial: string | null }

// Núcleo puro/testável: recebe uma função `subscribe` e devolve os
// callbacks que a casca real (start/stop de conexão MQTT verdadeira)
// registra. Nada aqui toca rede ou banco diretamente -- só orquestra
// parser + jobTracker + o cache em memória, e chama `onCapture` quando um
// job termina (quem persiste em PrinterCapture é a casca real abaixo, não
// este núcleo).
export function createListenerCore(opts: {
  printers: PrinterRef[]
  subscribe: (serial: string, onMessage: (payload: unknown) => void) => void
  onCapture: (printerId: string, capture: CaptureDraft) => void
}) {
  const liveStatus = new Map<string, BambuStatus>()
  const trackers = new Map<string, ReturnType<typeof createJobTracker>>()

  function start() {
    for (const printer of opts.printers) {
      if (!printer.bambuEnabled || !printer.bambuSerial) continue
      const tracker = createJobTracker()
      trackers.set(printer.id, tracker)
      opts.subscribe(printer.bambuSerial, (payload) => {
        const status = parseBambuReport(payload)
        if (!status) return
        liveStatus.set(printer.id, status)
        const capture = tracker.handleStatus(status, new Date())
        if (capture) opts.onCapture(printer.id, capture)
      })
    }
  }

  function getLiveStatus(printerId: string): BambuStatus | null {
    return liveStatus.get(printerId) ?? null
  }

  return { start, getLiveStatus }
}

// --- Casca real (não coberta por teste automatizado -- depende da nuvem
// Bambu de verdade, ver spec §9) ---

let connectionStatus: 'connected' | 'expired' | 'not_configured' = 'not_configured'
let core: ReturnType<typeof createListenerCore> | null = null
let client: MqttClient | null = null

const BROKER_BY_REGION: Record<string, string> = {
  US: 'mqtts://us.mqtt.bambulab.com:8883',
  CN: 'mqtts://cn.mqtt.bambulab.com:8883',
}

export async function startBambuListener(): Promise<void> {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } })
  if (!settings?.bambuCloudCredentialEncrypted || !settings.bambuCloudEmail) {
    connectionStatus = 'not_configured'
    return
  }

  const printers = await prisma.printer.findMany({
    where: { bambuEnabled: true, bambuSerial: { not: null } },
    select: { id: true, bambuEnabled: true, bambuSerial: true },
  })
  if (printers.length === 0) {
    connectionStatus = 'not_configured'
    return
  }

  const token = decryptCredential(settings.bambuCloudCredentialEncrypted)
  const brokerUrl = BROKER_BY_REGION[settings.bambuCloudRegion ?? 'US'] ?? BROKER_BY_REGION.US

  client = mqtt.connect(brokerUrl, {
    username: settings.bambuCloudEmail,
    password: token,
    reconnectPeriod: 5000,
  })

  client.on('connect', () => {
    connectionStatus = 'connected'
  })
  client.on('error', () => {
    connectionStatus = 'expired'
  })

  core = createListenerCore({
    printers,
    subscribe: (serial, onMessage) => {
      const topic = `device/${serial}/report`
      client!.subscribe(topic)
      client!.on('message', (receivedTopic, buffer) => {
        if (receivedTopic !== topic) return
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
          amsBreakdown: capture.amsBreakdown as never,
          outcome: capture.outcome,
        },
      })
    },
  })
  core.start()
}

export function getLiveStatus(printerId: string): BambuStatus | null {
  return core?.getLiveStatus(printerId) ?? null
}

// Reinicia o listener sem precisar reiniciar o container -- chamado depois
// de conectar/desconectar a conta Bambu (actions/bambuAuth.ts) e de
// salvar uma impressora (actions/printers.ts), pra pegar credencial/opt-in
// novos sem exigir redeploy. Fecha a conexão MQTT antiga antes de abrir
// outra, pra não vazar socket nem duplicar assinatura de tópico.
export async function restartBambuListener(): Promise<void> {
  if (client) {
    client.removeAllListeners()
    client.end(true)
    client = null
  }
  core = null
  connectionStatus = 'not_configured'
  await startBambuListener()
}

export function getConnectionStatus(): 'connected' | 'expired' | 'not_configured' {
  return connectionStatus
}
