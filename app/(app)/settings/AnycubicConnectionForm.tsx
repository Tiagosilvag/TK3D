'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { connectAnycubicAccount, disconnectAnycubicAccount } from '@/actions/anycubicAuth'
import { reconnectAnycubicListener, type getAnycubicStatus } from '@/actions/anycubicStatus'
import { extractSlicerTokenFromText } from '@/lib/anycubic/tokenExtraction'
import { SubmitButton } from '@/components/SubmitButton'

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
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // permite escolher o mesmo arquivo de novo depois
    if (!file) return
    setFileError(null)
    const text = await file.text()
    const token = extractSlicerTokenFromText(text)
    if (!token) {
      setFileError('Não achei um token nesse arquivo — confira se escolheu o log/conf certo do Slicer Next')
      return
    }
    if (textareaRef.current) textareaRef.current.value = token
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
      <details className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        <summary className="tk-summary cursor-pointer">Como extrair o token</summary>
        <ol className="mt-1 list-decimal space-y-1 pl-4">
          <li>Abra o Anycubic Slicer Next no Windows e deixe logado.</li>
          <li>
            No PowerShell, rode:
            <pre className="mt-1 overflow-x-auto rounded bg-slate-100 p-2 dark:bg-slate-800">
              {`$log = Get-ChildItem "$env:AppData\\AnycubicSlicerNext\\log" -Filter "debug_*.log" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Select-String -Path $log.FullName -Pattern 'accessToken = ([^,\\s]+)' | Select-Object -Last 1`}
            </pre>
          </li>
          <li>Copie o valor capturado e cole abaixo.</li>
        </ol>
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
          <form action={handleConnect} className="flex flex-col gap-3">
            <label className="text-sm">
              Selecionar arquivo de log do Slicer Next (opcional — preenche o token sozinho)
              <input
                type="file"
                accept=".log,.conf,.txt"
                onChange={handleFileSelect}
                className="tk-input flex-1 file:mr-3 file:rounded-md file:border-0 file:bg-violet-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white dark:file:bg-violet-500 dark:file:text-slate-950"
              />
            </label>
            {fileError && <p className="text-xs text-red-600 dark:text-red-400">{fileError}</p>}
            <label className="text-sm">
              Token do Slicer Next
              <textarea ref={textareaRef} name="slicerToken" className="tk-input-full" rows={3} required placeholder="eyJhbGciOi..." />
            </label>
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <SubmitButton pendingLabel="Conectando…">Conectar</SubmitButton>
          </form>
        )}
      </div>
    </div>
  )
}
