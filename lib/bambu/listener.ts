import mqtt, { MqttClient } from 'mqtt'
import { prisma } from '@/lib/prisma'
import { decryptCredential } from '@/lib/crypto'
import { parseBambuReport, type BambuStatus } from '@/lib/bambu/parser'
import { createJobTracker, type CaptureDraft } from '@/lib/bambu/jobTracker'
import { fetchLatestTask } from '@/lib/bambu/auth'
import type { BambuCommand } from '@/lib/bambu/commands'

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
// A URL da capa vem assinada/temporária da nuvem e vence no meio de
// impressões longas (imagem quebrada "às vezes") -- renovada periodicamente
// enquanto o job está em andamento (currentThumbnails só tem entrada de job
// ativo: preenchida no início, apagada ao capturar o fim).
const THUMBNAIL_REFRESH_MS = 5 * 60_000
let thumbnailRefreshTimer: ReturnType<typeof setInterval> | null = null

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
    //
    // Investigação em andamento (2026-09-14): visto em produção com o
    // client virando null (publishBambuCommand recusa "não conectada")
    // sem nenhum erro/close logado no meio. Hipótese inicial de colisão de
    // sessão com Bambu Studio/Handy abertos na mesma conta foi TESTADA E
    // DESCARTADA no caso equivalente da Anycubic (ver
    // lib/anycubic/listener.ts) -- usuário confirmou que múltiplos apps/
    // dispositivos conectados normalmente não causam conflito. Causa raiz
    // real ainda não identificada.
    username: `u_${settings.bambuCloudUserId}`,
    password: token,
    reconnectPeriod: 5000,
  })

  client.on('connect', () => {
    connectionStatus = 'connected'
    console.error(`[bambu] MQTT conectado (pid=${process.pid})`)
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
    // CONNACK negativo (credencial errada/expirada) nunca se resolve
    // tentando de novo -- reconexão insistente nesse tipo de erro foi o
    // que causou uma race condition real na lib mqtt na integração
    // Anycubic (timer de "connack timeout" virando exceção não tratada e
    // derrubando o processo INTEIRO). Mesma defesa aplicada aqui por
    // simetria/segurança, mesmo sem ter reproduzido o crash neste listener.
    if (err.message.startsWith('Connection refused:')) client?.end(true)
  })
  // Diagnóstico (bug real reportado pelo usuário: "pausar" recusava com
  // "não conectada" mesmo sem nenhum 'error' nos logs) -- até agora só
  // logávamos erro explícito, nunca uma queda silenciosa da conexão
  // (close/offline sem 'error' associado, comum em timeout de rede/idle).
  // Sem isso não dava pra saber se client.connected realmente cai às vezes
  // ou se o problema está em outro lugar.
  client.on('close', () => console.error('[bambu] MQTT desconectado (close)'))
  client.on('reconnect', () => console.error('[bambu] tentando reconectar ao MQTT...'))
  client.on('offline', () => console.error('[bambu] MQTT offline'))

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

  if (thumbnailRefreshTimer) clearInterval(thumbnailRefreshTimer)
  thumbnailRefreshTimer = setInterval(async () => {
    for (const printer of printers) {
      if (!printer.bambuSerial || !currentThumbnails.has(printer.id)) continue
      try {
        const task = await fetchLatestTask(token, printer.bambuSerial)
        if (task?.thumbnailUrl) currentThumbnails.set(printer.id, task.thumbnailUrl)
      } catch (err) {
        console.error('[bambu] falha ao renovar thumbnail do job atual:', err)
      }
    }
  }, THUMBNAIL_REFRESH_MS)
  thumbnailRefreshTimer.unref?.()
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
export async function restartBambuListener(reason: string = 'desconhecido'): Promise<void> {
  // Diagnóstico (bug real, 2026-09-14): a conexão ficou reconectando
  // dezenas de vezes em 12 minutos, presa em client=null boa parte do
  // tempo -- só acontece se algo estiver chamando este restart repetidamente.
  // Loga QUEM chamou (reason) em vez de adivinhar pela stack minificada do
  // build de produção.
  console.error(`[bambu] restartBambuListener chamado (motivo: ${reason}, pid=${process.pid})`)
  if (client) {
    client.removeAllListeners()
    // Mesmo ajuste feito no listener Anycubic (ver comentário lá):
    // end(true) força o fechamento sem mandar o DISCONNECT limpo pro
    // broker -- troca pra end(false) aqui, force=true continua só no
    // handler de erro "Connection refused:" abaixo.
    client.end(false)
    client = null
  }
  core = null
  if (thumbnailRefreshTimer) {
    clearInterval(thumbnailRefreshTimer)
    thumbnailRefreshTimer = null
  }
  currentThumbnails.clear()
  connectionStatus = 'not_configured'
  await startBambuListener()
}

export function getConnectionStatus(): BambuConnectionStatus {
  return connectionStatus
}

// Estado REAL do socket agora (connectionStatus só muda em connect/error e
// fica 'connected' depois de uma queda silenciosa) -- usado pra avisar no
// Monitoramento que os números na tela podem estar velhos.
export function isBambuMqttLive(): boolean {
  return client?.connected === true
}

// Publica um comando de controle (pause/resume/stop) pro tópico
// device/{serial}/request -- mesmo tópico usado pelo pushall, único outro
// publish que este listener faz. Busca o serial na hora (sem cache) porque
// é uma ação pontual do usuário, não um hot path.
export async function publishBambuCommand(printerId: string, command: BambuCommand): Promise<void> {
  // client.connected reflete o estado REAL do socket MQTT agora -- não a
  // variável connectionStatus (que só muda nos eventos 'connect'/'error' e
  // pode ficar presa em 'expired' depois de um erro transitório que não
  // chegou a fechar a conexão de verdade, mesmo com dados chegando ao vivo
  // normalmente -- bug real reportado pelo usuário: card mostrando progresso
  // e thumbnail atualizando, mas pausar recusava com "não conectada").
  if (!client || !client.connected) {
    console.error(
      `[bambu] publishBambuCommand recusado -- client=${client ? 'existe' : 'null'} connected=${client?.connected} pid=${process.pid}`,
    )
    throw new Error('Impressora não está conectada à nuvem Bambu no momento')
  }
  const printer = await prisma.printer.findUnique({ where: { id: printerId }, select: { bambuSerial: true } })
  if (!printer?.bambuSerial) {
    throw new Error('Impressora sem número de série Bambu configurado')
  }
  client.publish(`device/${printer.bambuSerial}/request`, JSON.stringify(command))
}
