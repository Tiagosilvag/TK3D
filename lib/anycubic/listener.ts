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
import { fetchProjectInfo, fetchLiveProjects, type AnycubicProjectInfo } from '@/lib/anycubic/auth'
import { isInProgressStatus, statusPatchFromLiveProject } from '@/lib/anycubic/liveProject'

type PrinterRef = { id: string; anycubicEnabled: boolean; anycubicPrinterKey: string | null; anycubicPrinterId?: number | null }

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

  // Caminho ÚNICO de atualização de status, usado pelo MQTT e pelo fallback
  // HTTP (ingestProject) -- assim job novo/captura de fim de job se
  // comportam igual não importa de onde o dado veio.
  function apply(printerId: string, taskId: number | undefined, patch: Partial<AnycubicStatus>) {
    const tracker = trackers.get(printerId)
    if (!tracker) return
    if (taskId !== undefined && taskId !== lastTaskId.get(printerId)) {
      lastTaskId.set(printerId, taskId)
      opts.onJobStart?.(printerId, taskId)
    }
    const prev = liveStatus.get(printerId) ?? INITIAL_ANYCUBIC_STATUS
    const next = applyStatusPatch(prev, patch)
    liveStatus.set(printerId, next)
    const capture = tracker.handleStatus(next, new Date())
    if (capture) opts.onCapture(printerId, capture)
  }

  function start() {
    for (const printer of opts.printers) {
      if (!printer.anycubicEnabled || !printer.anycubicPrinterKey) continue
      trackers.set(printer.id, createAnycubicJobTracker())
      opts.subscribe(printer.anycubicPrinterKey, (payload) => {
        const msg = parseAnycubicPayload(payload)
        if (!msg) return
        apply(printer.id, extractAnycubicTaskId(msg), buildStatusPatch(msg))
      })
    }
  }

  // Dado vindo do HTTP (ver lib/anycubic/liveProject.ts), quando o MQTT
  // está mudo.
  function ingestProject(printerId: string, taskId: number, patch: Partial<AnycubicStatus>) {
    apply(printerId, taskId, patch)
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

  return { start, getLiveStatus, getCurrentTaskId, ingestProject }
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
// Mesma razão da Bambu: a thumbnail (img) do project/info é uma URL S3
// assinada temporária -- renova enquanto há job ativo (entrada em
// currentProjectInfo).
const PROJECT_INFO_REFRESH_MS = 10 * 60_000
let projectInfoRefreshTimer: ReturnType<typeof setInterval> | null = null

// Fallback HTTP (lib/anycubic/liveProject.ts): em produção o MQTT da Anycubic
// conecta e cai ~ms depois em loop, mas o HTTP funciona -- enquanto o MQTT
// estiver mudo o status vem de GET /work/project/getProjects.
const HTTP_POLL_MS = 15_000
const MQTT_SILENCE_BEFORE_POLL_MS = 30_000
const DATA_FRESH_MS = 60_000
let httpPollTimer: ReturnType<typeof setInterval> | null = null
let lastMqttMessageAt = 0
let lastDataAt = 0
let lastPollErrorLogAt = 0
let loggedProjectShape = false
const lastPolledState = new Map<string, string>()

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

function maskKey(key: string): string {
  return key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}(${key.length})` : `(${key.length})`
}

// Informação de socket pra diagnóstico: IP/família do broker (IPv4 vs IPv6 =
// bordas diferentes da Cloudflare na frente do broker) e TLS negociado.
function describeSocket(stream: unknown): string {
  try {
    const s = stream as {
      remoteAddress?: string
      remoteFamily?: string
      getProtocol?: () => string | null
      getCipher?: () => { name: string } | undefined
    }
    return `broker=${s.remoteAddress ?? '?'}/${s.remoteFamily ?? '?'} tls=${s.getProtocol?.() ?? '?'}/${s.getCipher?.()?.name ?? '?'}`
  } catch {
    return 'socket=?'
  }
}

export async function startAnycubicListener(): Promise<void> {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } })
  if (!settings?.anycubicAuthTokenEncrypted || !settings.anycubicUserEmail) {
    connectionStatus = 'not_configured'
    return
  }

  const printers = (
    await prisma.printer.findMany({
      where: { anycubicEnabled: true, anycubicPrinterKey: { not: null } },
      select: { id: true, anycubicEnabled: true, anycubicPrinterKey: true, anycubicPrinterId: true },
    })
  ).filter((p) => p.anycubicPrinterKey?.trim())
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
    //
    // Loop de reconexão visto em produção (2026-09-20): CONNACK ok e o
    // broker/rede fecha ~ms depois, a cada ~5s. Causa AINDA NÃO identificada.
    // Descartado por teste: end() forçado vs gracioso; cliente zumbi (mqtt
    // 5.15.2 real); senha RSA reaproveitada (retry com token novo = mesmo
    // loop); assinar tópicos antes/depois do connect; restart em processo
    // reproduzido localmente; Slicer Next fechado (sem processo nem
    // conexão) -- o loop segue. O MESMO código roda estável na máquina do
    // dev, então a causa está no ambiente de produção. Ver o log por
    // conexão ("MQTT fechado ... trace=[...]") adicionado abaixo.
    clientId: buildMqttClientId(email),
    username: mqttUsername,
    password: mqttPassword,
    // Reconnect nativo do mqtt.js: mantém o mesmo client/core (e portanto o
    // último status ao vivo) entre quedas. Um retry que recria o listener
    // inteiro apagava o status a cada tentativa (card piscando "Ocioso").
    reconnectPeriod: 5000,
    ...buildMqttSslOptions(),
  })

  // --- Diagnóstico + backoff (2026-09-20) ---
  // Em produção a conexão cai ~ms depois do CONNACK, em loop de ~5s, mas o
  // MESMO código/identidade/tópicos fica estável rodando da máquina do
  // dev (testado com mqtt real: assinatura antes/depois do connect,
  // restart em processo, token antigo) -- então a causa está no ambiente
  // de produção. Cada conexão loga UMA linha ao fechar, com o que o broker
  // e a rede fizeram: uptime, IP/família do broker, TLS e a sequência de
  // pacotes. Backoff exponencial (5s -> 60s, como a lib de referência com
  // reconnect_delay_set(5, 60)) tira o cliente do loop apertado e, se o
  // broker limita taxa de conexão por origem, dá tempo da janela expirar.
  const thisClient = client
  console.error(
    `[anycubic] iniciando listener (node=${process.version}, openssl=${process.versions.openssl}, impressoras=${printers.map((p) => maskKey(p.anycubicPrinterKey!)).join(',')}, pid=${process.pid})`,
  )
  const trace: string[] = []
  let attemptStartedAt = Date.now()
  let connectedAt = 0
  let shortLivedStreak = 0
  let remoteInfo = ''
  const pushTrace = (label: string) => {
    if (trace.length < 14) trace.push(`${Date.now() - attemptStartedAt}ms:${label}`)
  }
  thisClient.on('packetsend', (packet) => pushTrace(`>${packet.cmd}`))
  thisClient.on('packetreceive', (packet) => pushTrace(`<${packet.cmd}`))
  thisClient.on('reconnect', () => {
    attemptStartedAt = Date.now()
    trace.length = 0
  })
  thisClient.on('connect', () => {
    connectionStatus = 'connected'
    connectedAt = Date.now()
    remoteInfo = describeSocket(thisClient.stream)
    console.error(`[anycubic] MQTT conectado (${remoteInfo}) (pid=${process.pid})`)
  })
  thisClient.on('error', (err) => {
    connectionStatus = 'expired'
    console.error(`[anycubic] erro na conexão MQTT: "${err.message}" (name=${err.name}, stack=${err.stack?.split('\n')[0]})`)
    // CONNACK negativo (credencial errada/expirada, não autorizado etc.)
    // nunca se resolve tentando de novo -- deixar o reconnectPeriod bater
    // insistentemente nesse tipo de erro foi o que disparou uma race
    // condition real na lib mqtt (um timer de "connack timeout" de uma
    // tentativa anterior virando exceção não tratada e derrubando o
    // processo INTEIRO, inclusive o listener da Bambu, visto em produção).
    // Parar de vez aqui e exigir reconectar manual (botão em Configurações)
    // depois de corrigir a credencial.
    //
    // CONFIRMADO por teste (2026-09-20): cada login novo em
    // /v3/public/loginWithAccessToken INVALIDA o token de sessão anterior da
    // conta -- conectar com o token velho dá "Connection refused: Not
    // authorized" e o novo conecta normal. O token de sessão guardado em
    // Settings morre sempre que qualquer outra coisa loga nessa conta (o
    // Slicer Next ao abrir, um script de teste...). A tela de Monitoramento
    // mostra "conexão recusada" nesse caso; a correção é reconectar a conta
    // (botão "Conectar pelo log do Slicer Next").
    if (err.message.startsWith('Connection refused:')) thisClient.end(true)
  })
  thisClient.on('disconnect', (packet) => console.error('[anycubic] pacote DISCONNECT recebido do broker:', JSON.stringify(packet)))
  thisClient.on('close', () => {
    const uptime = connectedAt ? Date.now() - connectedAt : 0
    connectedAt = 0
    // uptime 0 = nem chegou a conectar (falha de rede/TLS); 1..2999ms =
    // conectou e caiu na hora (o sintoma); >=30s = conexão saudável.
    shortLivedStreak = uptime >= 30_000 ? 0 : shortLivedStreak + 1
    const nextDelay = Math.min(60_000, 5_000 * 2 ** Math.max(0, shortLivedStreak - 1))
    thisClient.options.reconnectPeriod = nextDelay
    console.error(
      `[anycubic] MQTT fechado (uptime=${uptime}ms, seq_curtas=${shortLivedStreak}, proxima_tentativa=${nextDelay / 1000}s, ${remoteInfo || 'sem conexão'}, trace=[${trace.join(' ')}]) (pid=${process.pid})`,
    )
    trace.length = 0
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
          const payload = JSON.parse(buffer.toString())
          lastMqttMessageAt = Date.now()
          lastDataAt = lastMqttMessageAt
          onMessage(payload)
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

  if (projectInfoRefreshTimer) clearInterval(projectInfoRefreshTimer)
  projectInfoRefreshTimer = setInterval(async () => {
    for (const printer of printers) {
      const taskId = core?.getCurrentTaskId(printer.id)
      if (!taskId || !currentProjectInfo.has(printer.id)) continue
      try {
        currentProjectInfo.set(printer.id, await fetchProjectInfo(authToken, taskId))
      } catch (err) {
        console.error('[anycubic] falha ao renovar info do job atual:', err)
      }
    }
  }, PROJECT_INFO_REFRESH_MS)
  projectInfoRefreshTimer.unref?.()

  lastMqttMessageAt = 0
  lastPolledState.clear()
  const poll = () => pollLiveProjects(printers, authToken)
  if (httpPollTimer) clearInterval(httpPollTimer)
  httpPollTimer = setInterval(poll, HTTP_POLL_MS)
  httpPollTimer.unref?.()
  void poll()
}

// Ingere o(s) projeto(s) atual(is) vindo(s) por HTTP -- só quando o MQTT
// está mudo (ou force=true, ex.: logo depois de pausar/retomar). Regras pra
// não inventar estado: só entra registro EM ANDAMENTO, ou o registro do
// próprio job que já estávamos acompanhando (pra virar Concluído/Cancelado);
// o registro mais recente ser um job velho já concluído NÃO vira "Concluído"
// num card de impressora ociosa.
async function pollLiveProjects(
  printers: { id: string; anycubicPrinterId?: number | null }[],
  authToken: string,
  force = false,
): Promise<void> {
  if (!core) return
  if (!force && Date.now() - lastMqttMessageAt < MQTT_SILENCE_BEFORE_POLL_MS) return
  try {
    const { projects, sampleKeys } = await fetchLiveProjects(authToken)
    lastDataAt = Date.now()
    if (!loggedProjectShape) {
      loggedProjectShape = true
      console.error(`[anycubic] status via HTTP ativo (fallback do MQTT). Campos do registro: ${sampleKeys.join(',')}`)
    }
    for (const printer of printers) {
      if (printer.anycubicPrinterId == null) continue
      const project = projects.find((p) => p.printerId === printer.anycubicPrinterId)
      if (!project) continue
      const knownTask = core.getCurrentTaskId(printer.id)
      if (!isInProgressStatus(project.printStatus) && knownTask !== project.id) continue
      const patch = statusPatchFromLiveProject(project)
      const signature = `${project.id}:${patch.printState}`
      if (lastPolledState.get(printer.id) !== signature) {
        lastPolledState.set(printer.id, signature)
        console.error(`[anycubic] HTTP: printer=${printer.id} projeto=${project.id} estado=${patch.printState ?? '?'} progresso=${project.progressPercent ?? '?'}%`)
      }
      core.ingestProject(printer.id, project.id, patch)
    }
  } catch (err) {
    if (Date.now() - lastPollErrorLogAt > 60_000) {
      lastPollErrorLogAt = Date.now()
      console.error('[anycubic] polling HTTP falhou:', err instanceof Error ? err.message : err)
    }
  }
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
    // end(false) manda o DISCONNECT limpo antes de fechar (testado como
    // hipótese pro loop de reconexão em 2026-09-14 -- não foi a causa raiz
    // sozinho, mas continua sendo o jeito correto de fechar uma conexão
    // que a gente mesmo decidiu encerrar). force=true continua só no
    // handler de erro "Connection refused:" acima, onde a conexão nunca
    // chegou a ser aceita pelo broker.
    client.end(false)
    client = null
  }
  core = null
  if (projectInfoRefreshTimer) {
    clearInterval(projectInfoRefreshTimer)
    projectInfoRefreshTimer = null
  }
  if (httpPollTimer) {
    clearInterval(httpPollTimer)
    httpPollTimer = null
  }
  currentProjectInfo.clear()
  connectionStatus = 'not_configured'
  await startAnycubicListener()
}

export function getAnycubicConnectionStatus(): AnycubicConnectionStatus {
  return connectionStatus
}

export function isAnycubicMqttLive(): boolean {
  return client?.connected === true
}

// Chegou dado recente (MQTT OU polling HTTP)? É isso que importa pro card
// do Monitoramento -- não se o socket MQTT está de pé.
export function isAnycubicDataFresh(): boolean {
  return Date.now() - lastDataAt < DATA_FRESH_MS
}

// Atualiza o status agora via HTTP (usado logo depois de pausar/retomar/
// parar, pra tela não esperar o próximo ciclo de polling).
export async function refreshAnycubicStatusNow(): Promise<void> {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } })
  if (!settings?.anycubicAuthTokenEncrypted) return
  const printers = await prisma.printer.findMany({
    where: { anycubicEnabled: true, anycubicPrinterId: { not: null } },
    select: { id: true, anycubicPrinterId: true },
  })
  await pollLiveProjects(printers, decryptCredential(settings.anycubicAuthTokenEncrypted), true)
}
