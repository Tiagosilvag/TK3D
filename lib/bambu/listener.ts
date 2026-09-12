import mqtt, { MqttClient } from 'mqtt'
import { prisma } from '@/lib/prisma'
import { decryptCredential } from '@/lib/bambu/crypto'
import { parseBambuReport, type BambuStatus } from '@/lib/bambu/parser'
import { createJobTracker, type CaptureDraft } from '@/lib/bambu/jobTracker'
import { fetchLatestTask } from '@/lib/bambu/auth'

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
  // Ajuste "thumbnail ao vivo" (2026-09-12): dispara UMA vez quando o nome
  // do arquivo em impressão muda (job novo) -- nunca a cada tick, e nunca
  // pra I/O de rede aqui dentro (núcleo continua puro/testável; quem busca
  // a foto de verdade é a casca real, via este callback).
  onJobStart?: (printerId: string, gcodeFile: string) => void
}) {
  const liveStatus = new Map<string, BambuStatus>()
  const trackers = new Map<string, ReturnType<typeof createJobTracker>>()
  const lastGcodeFile = new Map<string, string | null>()

  function start() {
    for (const printer of opts.printers) {
      if (!printer.bambuEnabled || !printer.bambuSerial) continue
      const tracker = createJobTracker()
      trackers.set(printer.id, tracker)
      opts.subscribe(printer.bambuSerial, (payload) => {
        const status = parseBambuReport(payload)
        if (!status) return
        liveStatus.set(printer.id, status)

        if (status.gcodeFile && status.gcodeFile !== lastGcodeFile.get(printer.id)) {
          lastGcodeFile.set(printer.id, status.gcodeFile)
          opts.onJobStart?.(printer.id, status.gcodeFile)
        }

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

// 'not_configured': sem conta Bambu conectada em Configurações.
// 'no_printer': conta conectada, mas nenhuma impressora habilitada tem o
// número de série preenchido (não dá pra saber qual tópico MQTT assinar).
// 'expired': conta conectada, impressora com serial, mas o broker recusou
// (token expirado, credencial inválida etc.) -- ver log do servidor.
// 'connected': tudo certo, recebendo dados.
export type BambuConnectionStatus = 'connected' | 'expired' | 'not_configured' | 'no_printer'

let connectionStatus: BambuConnectionStatus = 'not_configured'
let core: ReturnType<typeof createListenerCore> | null = null
let client: MqttClient | null = null
// Thumbnail do job atual por impressora (ajuste "thumbnail ao vivo") --
// preenchida quando um job novo começa, via histórico da nuvem. Confirmado
// pelo usuário: a Bambu cria o registro de task no INÍCIO do job (não só
// no fim), então a task "mais recente" já é a que está imprimindo agora.
const currentThumbnails = new Map<string, string | null>()

const BROKER_BY_REGION: Record<string, string> = {
  US: 'mqtts://us.mqtt.bambulab.com:8883',
  CN: 'mqtts://cn.mqtt.bambulab.com:8883',
}

export async function startBambuListener(): Promise<void> {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } })
  if (!settings?.bambuCloudCredentialEncrypted || !settings.bambuCloudUserId) {
    connectionStatus = 'not_configured'
    return
  }

  const printers = await prisma.printer.findMany({
    where: { bambuEnabled: true, bambuSerial: { not: null } },
    select: { id: true, bambuEnabled: true, bambuSerial: true },
  })
  if (printers.length === 0) {
    connectionStatus = 'no_printer'
    return
  }

  const token = decryptCredential(settings.bambuCloudCredentialEncrypted)
  const brokerUrl = BROKER_BY_REGION[settings.bambuCloudRegion ?? 'US'] ?? BROKER_BY_REGION.US

  client = mqtt.connect(brokerUrl, {
    // Username do broker MQTT da nuvem é "u_{uid}", nunca o e-mail --
    // bug real encontrado testando com a conta do usuário (a conexão
    // nunca fechava, ficava presa em not_configured/expired).
    username: `u_${settings.bambuCloudUserId}`,
    password: token,
    reconnectPeriod: 5000,
  })

  client.on('connect', () => {
    connectionStatus = 'connected'
    // Pedido "pushall" (ajuste "extrair mais dados", 2026-09-12): única
    // publicação que este listener faz -- o resto do módulo só assina/lê.
    // Sem isso, campos que só vêm num dump completo (ex.: versão de
    // firmware) podem nunca aparecer nos reports incrementais, que só
    // mandam o que mudou desde o último tick.
    for (const printer of printers) {
      if (!printer.bambuSerial) continue
      client!.publish(`device/${printer.bambuSerial}/request`, JSON.stringify({ pushing: { sequence_id: '0', command: 'pushall' } }))
    }
  })
  client.on('error', (err) => {
    connectionStatus = 'expired'
    console.error('[bambu] erro na conexão MQTT:', err.message)
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
      // Enriquecimento com o histórico oficial da nuvem (achado nesta
      // sessão): peso real calculado pela Bambu (substitui o null que o
      // cálculo via AMS quase sempre dá) + foto da peça. Nunca bloqueia a
      // gravação da captura -- se a chamada falhar, grava só o que o
      // jobTracker já tinha, como sempre fez.
      let gramsUsedTotal = capture.gramsUsedTotal
      let thumbnailUrl: string | null = null
      const serial = printers.find((p) => p.id === printerId)?.bambuSerial
      if (serial) {
        try {
          const task = await fetchLatestTask(token, serial)
          if (task) {
            if (gramsUsedTotal === null) gramsUsedTotal = task.weightGrams
            thumbnailUrl = task.thumbnailUrl
          }
        } catch (err) {
          console.error('[bambu] falha ao buscar histórico da nuvem pra enriquecer captura:', err)
        }
      }

      await prisma.printerCapture.create({
        data: {
          printerId,
          startedAt: capture.startedAt,
          finishedAt: capture.finishedAt,
          gcodeFileName: capture.gcodeFileName,
          durationHours: capture.durationHours,
          gramsUsedTotal,
          amsBreakdown: capture.amsBreakdown as never,
          outcome: capture.outcome,
          hmsCode: capture.hmsCode,
          thumbnailUrl,
        },
      })
      currentThumbnails.delete(printerId)
    },
    onJobStart: async (printerId, _gcodeFile) => {
      const serial = printers.find((p) => p.id === printerId)?.bambuSerial
      if (!serial) return
      try {
        const task = await fetchLatestTask(token, serial)
        currentThumbnails.set(printerId, task?.thumbnailUrl ?? null)
      } catch (err) {
        console.error('[bambu] falha ao buscar thumbnail do job atual:', err)
      }
    },
  })
  core.start()
}

export function getLiveStatus(printerId: string): BambuStatus | null {
  return core?.getLiveStatus(printerId) ?? null
}

// Thumbnail (render do modelo, não foto de câmera) do job em andamento.
export function getCurrentThumbnail(printerId: string): string | null {
  return currentThumbnails.get(printerId) ?? null
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
  currentThumbnails.clear()
  connectionStatus = 'not_configured'
  await startBambuListener()
}

export function getConnectionStatus(): BambuConnectionStatus {
  return connectionStatus
}
