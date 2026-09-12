'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { connectBambuAccountStep1, connectBambuAccountStep2, disconnectBambuAccount } from '@/actions/bambuAuth'
import { reconnectBambuListener, type getBambuConnectionStatus } from '@/actions/bambuStatus'
import { SubmitButton } from '@/components/SubmitButton'

type ConnectionStatus = Awaited<ReturnType<typeof getBambuConnectionStatus>>

const STATUS_BADGE: Record<ConnectionStatus, { label: string; className: string }> = {
  connected: { label: 'MQTT conectado', className: 'text-emerald-600 dark:text-emerald-400' },
  expired: { label: 'MQTT com erro — ver logs do servidor', className: 'text-red-600 dark:text-red-400' },
  not_configured: { label: 'MQTT ainda não conectado', className: 'text-amber-600 dark:text-amber-400' },
  no_printer: {
    label: 'Nenhuma impressora com número de série preenchido — ver Impressoras',
    className: 'text-amber-600 dark:text-amber-400',
  },
}

export function BambuConnectionForm({
  connectedEmail,
  connectionStatus,
}: {
  connectedEmail: string | null
  connectionStatus: ConnectionStatus
}) {
  const router = useRouter()
  const [step, setStep] = useState<'idle' | 'code'>('idle')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleStep1(formData: FormData) {
    setError(null)
    const result = await connectBambuAccountStep1(formData)
    if (!result.success) {
      setError(result.error ?? 'Falha ao conectar')
      return
    }
    setEmail(String(formData.get('email')))
    if (result.needsCode) {
      setStep('code')
    } else {
      // Conta sem verificação extra habilitada -- já autenticou de primeira,
      // sem precisar do passo do código por e-mail.
      setStep('idle')
      router.refresh()
    }
  }

  async function handleStep2(formData: FormData) {
    setError(null)
    formData.set('email', email)
    const result = await connectBambuAccountStep2(formData)
    if (!result.success) {
      setError(result.error ?? 'Código inválido')
      return
    }
    setStep('idle')
    router.refresh()
  }

  async function handleDisconnect() {
    await disconnectBambuAccount()
    router.refresh()
  }

  async function handleReconnect() {
    await reconnectBambuListener()
    router.refresh()
  }

  return (
    <div className="tk-panel p-4">
      <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Integração Bambu Lab</h2>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
        Monitoramento somente leitura via Cloud MQTT — mantém o Bambu Handy funcionando fora da rede local.
      </p>
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
        ) : step === 'code' ? (
          <form action={handleStep2} className="flex flex-col gap-3">
            <p className="text-sm text-slate-500 dark:text-slate-400">Código enviado por e-mail para {email}</p>
            <label className="text-sm">
              Código
              <input name="code" className="tk-input-full" required placeholder="000000" />
            </label>
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <SubmitButton pendingLabel="Confirmando…">Confirmar</SubmitButton>
          </form>
        ) : (
          <form action={handleStep1} className="flex flex-col gap-3">
            <label className="text-sm">
              E-mail da conta Bambu
              <input name="email" type="email" className="tk-input-full" required />
            </label>
            <label className="text-sm">
              Senha
              <input name="password" type="password" className="tk-input-full" required />
            </label>
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <SubmitButton pendingLabel="Conectando…">Conectar</SubmitButton>
          </form>
        )}
      </div>
    </div>
  )
}
