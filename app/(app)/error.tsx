'use client'
import { useEffect } from 'react'
import Link from 'next/link'

// Bug "tela inteira branqueia num erro" (ver
// app/api/client-error-log/route.ts, components/ClientErrorLogger.tsx):
// sem este arquivo, um erro de render/hidratação em qualquer tela do app
// (Produtos, Produção, Pedidos, etc.) derrubava a página inteira pro
// fallback genérico do Next.js -- sem sidebar, sem "tente de novo", sem
// nenhum rastro no log. Next.js chama este componente automaticamente
// quando um erro escapa de qualquer página dentro de app/(app)/ (só não
// cobre o próprio layout raiz -- ver app/global-error.tsx -- nem erro
// dentro de um event handler/Promise, cobertos por ClientErrorLogger).
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    const body = JSON.stringify({
      message: error.message,
      stack: error.stack,
      digest: error.digest,
      source: 'error-boundary:(app)',
      url: window.location.href,
      userAgent: navigator.userAgent,
    })
    fetch('/api/client-error-log', { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => {})
  }, [error])

  return (
    <div className="tk-page flex min-h-[60vh] items-center justify-center">
      <div className="tk-panel max-w-md p-6 text-center">
        <h1 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">Algo deu errado nesta tela</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          O erro já foi registrado no log do servidor{error.digest ? ` (código ${error.digest})` : ''}.
        </p>
        <div className="mt-4 flex justify-center gap-3">
          <button type="button" onClick={() => reset()} className="tk-btn-primary">Tentar de novo</button>
          <Link href="/dashboard" className="rounded-lg px-4 py-1.5 text-sm font-medium text-slate-600 hover:underline dark:text-slate-300">Voltar ao início</Link>
        </div>
      </div>
    </div>
  )
}
