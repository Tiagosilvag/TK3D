'use client'
import { useEffect } from 'react'

// Mesmo boundary de app/(app)/error.tsx, mas pras rotas FORA do grupo
// (app) -- hoje só /login. Next.js exige um error.tsx por segmento que
// precise de tratamento próprio; este cobre a raiz.
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    const body = JSON.stringify({
      message: error.message,
      stack: error.stack,
      digest: error.digest,
      source: 'error-boundary:root',
      url: window.location.href,
      userAgent: navigator.userAgent,
    })
    fetch('/api/client-error-log', { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => {})
  }, [error])

  return (
    <div className="tk-gradient-bg flex min-h-screen items-center justify-center p-6">
      <div className="tk-panel max-w-md p-6 text-center">
        <h1 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">Algo deu errado</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          O erro já foi registrado no log do servidor{error.digest ? ` (código ${error.digest})` : ''}.
        </p>
        <button type="button" onClick={() => reset()} className="tk-btn-primary mt-4">Tentar de novo</button>
      </div>
    </div>
  )
}
