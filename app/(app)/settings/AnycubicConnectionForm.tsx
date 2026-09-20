'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { connectAnycubicAccount, disconnectAnycubicAccount } from '@/actions/anycubicAuth'
import { reconnectAnycubicListener, type getAnycubicStatus } from '@/actions/anycubicStatus'
import { pickSlicerTokenFromCandidates, type LogFileCandidate } from '@/lib/anycubic/tokenExtraction'
import { SubmitButton } from '@/components/SubmitButton'

const SLICER_LOG_FOLDER_PATH = String.raw`%AppData%\AnycubicSlicerNext\log`

type ConnectionStatus = Awaited<ReturnType<typeof getAnycubicStatus>>

const STATUS_BADGE: Record<ConnectionStatus, { label: string; className: string }> = {
  connected: { label: 'MQTT conectado', className: 'text-emerald-600 dark:text-emerald-400' },
  expired: { label: 'MQTT com erro — ver logs do servidor', className: 'text-red-600 dark:text-red-400' },
  not_configured: { label: 'MQTT ainda não conectado', className: 'text-amber-600 dark:text-amber-400' },
  no_printer: {
    label: 'Nenhuma impressora com a "key" da Anycubic preenchida — ver Impressoras',
    className: 'text-amber-600 dark:text-amber-400',
  },
}

export function AnycubicConnectionForm({
  connectedEmail,
  connectionStatus,
}: {
  connectedEmail: string | null
  connectionStatus: ConnectionStatus
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [pathCopied, setPathCopied] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const folderInputRef = useRef<HTMLInputElement>(null)

  // webkitdirectory/directory não têm tipo no JSX do React -- setados via
  // DOM direto pra deixar o seletor de arquivo abrir em modo "escolher
  // pasta" (suporte: Chrome/Edge; navegadores sem suporte caem pra seleção
  // múltipla de arquivo normal, o usuário só marca todos manualmente).
  useEffect(() => {
    folderInputRef.current?.setAttribute('webkitdirectory', 'true')
    folderInputRef.current?.setAttribute('directory', 'true')
  }, [])

  // Um clique só: copia o caminho da pasta e abre a seleção de pasta no MESMO
  // gesto do usuário (o navegador só libera o seletor de arquivo dentro dele
  // -- por isso o clipboard não é aguardado). Um site não consegue ler o
  // AppData do Windows sem o usuário escolher a pasta, então esse é o
  // mínimo possível; o resto (achar o token e conectar) é automático.
  function handleLogConnectClick() {
    setFileError(null)
    setError(null)
    navigator.clipboard?.writeText(SLICER_LOG_FOLDER_PATH).catch(() => {
      // sem permissão/contexto seguro -- o caminho continua escrito na tela
    })
    setPathCopied(true)
    setTimeout(() => setPathCopied(false), 4000)
    folderInputRef.current?.click()
  }

  async function handleFolderSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = '' // permite escolher a mesma pasta de novo depois
    if (files.length === 0) return
    setFileError(null)

    const candidates: LogFileCandidate[] = await Promise.all(
      files
        .filter((f) => /\.(log|conf|txt)$/i.test(f.name))
        .map(async (f) => ({ name: f.name, lastModified: f.lastModified, text: await f.text() })),
    )

    const token = pickSlicerTokenFromCandidates(candidates)
    if (!token) {
      setFileError('Não achei um token em nenhum arquivo dessa pasta — confira se você fez login no Slicer Next recentemente')
      return
    }

    setConnecting(true)
    const formData = new FormData()
    formData.set('slicerToken', token)
    await handleConnect(formData)
    setConnecting(false)
  }

  async function handleConnect(formData: FormData) {
    setError(null)
    const result = await connectAnycubicAccount(formData)
    if (!result.success) {
      setError(result.error ?? 'Falha ao conectar')
      return
    }
    router.refresh()
  }

  async function handleDisconnect() {
    await disconnectAnycubicAccount()
    router.refresh()
  }

  async function handleReconnect() {
    await reconnectAnycubicListener()
    router.refresh()
  }

  return (
    <div className="tk-panel p-4">
      <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Integração Anycubic</h2>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
        Monitoramento somente leitura via Cloud MQTT. Sem login automático — precisa colar um token extraído do
        Anycubic Slicer Next (Windows).
      </p>
      <details className="mt-2 text-xs text-slate-500 dark:text-slate-400" open>
        <summary className="tk-summary cursor-pointer">Como conectar</summary>
        <ol className="mt-1 list-decimal space-y-1 pl-4">
          <li>Abra o Anycubic Slicer Next no Windows e deixe logado.</li>
          <li>
            Clique em <strong>&ldquo;Conectar pelo log do Slicer Next&rdquo;</strong> — o caminho da pasta já vai
            copiado: na janela que abrir, cole (Ctrl+V) na barra de endereço, aperte Enter e confirme a pasta.
          </li>
          <li>Pronto: o token é encontrado e a conexão é feita sozinha (nas próximas vezes a janela já abre na pasta certa).</li>
        </ol>
        <details className="mt-2">
          <summary className="tk-summary cursor-pointer">Alternativa avançada (PowerShell)</summary>
          <pre className="mt-1 overflow-x-auto rounded bg-slate-100 p-2 dark:bg-slate-800">
            {`foreach ($f in (Get-ChildItem "$env:AppData\\AnycubicSlicerNext\\log" -Filter "debug_*.log" | Sort-Object LastWriteTime -Descending)) {
  $m = Select-String -Path $f.FullName -Pattern 'accessToken = ([^,\\s]+)|id_token=(eyJ[\\w-]+\\.[\\w-]+\\.[\\w-]+)' | Select-Object -Last 1
  if ($m) { $g = $m.Matches[0].Groups; "$($g[1].Value)$($g[2].Value)"; break }
}`}
          </pre>
        </details>
      </details>
      <div className="mt-4">
        {connectedEmail ? (
          <div className="text-sm">
            <p>
              Conectado como <strong>{connectedEmail}</strong>
            </p>
            <p className={`mt-1 text-xs font-medium ${STATUS_BADGE[connectionStatus].className}`}>{STATUS_BADGE[connectionStatus].label}</p>
            <div className="mt-2 flex gap-3">
              <button type="button" onClick={handleReconnect} className="text-sm text-violet-600 hover:underline dark:text-violet-400">
                Reconectar
              </button>
              <button type="button" onClick={handleDisconnect} className="text-sm text-red-600 hover:underline dark:text-red-400">
                Desconectar
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <input ref={folderInputRef} type="file" multiple onChange={handleFolderSelect} className="hidden" />
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleLogConnectClick}
                disabled={connecting}
                className="tk-btn-primary disabled:opacity-60"
              >
                {connecting ? 'Conectando…' : 'Conectar pelo log do Slicer Next'}
              </button>
              <code className="text-xs text-slate-500 dark:text-slate-400">
                {pathCopied ? 'Caminho copiado — cole (Ctrl+V) na barra de endereço da janela' : SLICER_LOG_FOLDER_PATH}
              </code>
            </div>
            {fileError && <p className="text-xs text-red-600 dark:text-red-400">{fileError}</p>}
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <details className="text-xs text-slate-500 dark:text-slate-400">
              <summary className="tk-summary cursor-pointer">Não deu certo? Colar o token manualmente</summary>
              <form action={handleConnect} className="mt-2 flex flex-col gap-3">
                <label className="text-sm">
                  Token do Slicer Next
                  <textarea name="slicerToken" className="tk-input-full" rows={3} required placeholder="eyJhbGciOi..." />
                </label>
                <SubmitButton pendingLabel="Conectando…">Conectar</SubmitButton>
              </form>
            </details>
          </div>
        )}
      </div>
    </div>
  )
}
