'use client'
import { useEffect } from 'react'

// Cobre erro dentro do PRÓPRIO app/layout.tsx (raríssimo -- normalmente só
// markup estático) -- Next.js exige que este arquivo renderize <html>/
// <body> por conta própria, já que ele SUBSTITUI o layout raiz inteiro
// quando ativado. Estilo inline de propósito: se o layout quebrou, não há
// garantia de que globals.css/as classes tk-* estejam disponíveis.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    const body = JSON.stringify({
      message: error.message,
      stack: error.stack,
      digest: error.digest,
      source: 'error-boundary:global',
      url: window.location.href,
      userAgent: navigator.userAgent,
    })
    fetch('/api/client-error-log', { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => {})
  }, [error])

  return (
    <html lang="pt-BR">
      <body style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif', background: '#f8fafc' }}>
        <div style={{ maxWidth: 420, textAlign: 'center', padding: 24 }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, color: '#0f172a' }}>Algo deu errado</h1>
          <p style={{ marginTop: 8, fontSize: 14, color: '#64748b' }}>
            O erro já foi registrado no log do servidor{error.digest ? ` (código ${error.digest})` : ''}.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{ marginTop: 16, borderRadius: 8, background: '#7c3aed', color: '#fff', padding: '6px 16px', fontSize: 14, fontWeight: 500, border: 'none', cursor: 'pointer' }}
          >
            Tentar de novo
          </button>
        </div>
      </body>
    </html>
  )
}
