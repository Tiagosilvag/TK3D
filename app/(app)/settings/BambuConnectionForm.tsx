'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { connectBambuAccountStep1, connectBambuAccountStep2, disconnectBambuAccount } from '@/actions/bambuAuth'
import { SubmitButton } from '@/components/SubmitButton'

export function BambuConnectionForm({ connectedEmail }: { connectedEmail: string | null }) {
  const router = useRouter()
  const [step, setStep] = useState<'idle' | 'code'>('idle')
  const [ticket, setTicket] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleStep1(formData: FormData) {
    setError(null)
    const result = await connectBambuAccountStep1(formData)
    if (!result.success || !result.ticket) {
      setError(result.error ?? 'Falha ao conectar')
      return
    }
    setTicket(result.ticket)
    setEmail(String(formData.get('email')))
    setStep('code')
  }

  async function handleStep2(formData: FormData) {
    setError(null)
    formData.set('ticket', ticket)
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
            <button type="button" onClick={handleDisconnect} className="mt-2 text-sm text-red-600 hover:underline dark:text-red-400">
              Desconectar
            </button>
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
