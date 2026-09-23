'use client'
import { useEffect } from 'react'

// Bug "erro client-side não aparece em lugar nenhum" (ver
// app/api/client-error-log/route.ts): error.tsx só captura erro de
// RENDER/hidratação dentro da árvore React -- erro dentro de um onClick,
// de um setTimeout, ou uma Promise rejeitada sem catch (ex.: uma chamada
// fetch que falha dentro de um handler) nunca passa por ele, só aparece
// no console do navegador. Este componente, montado uma vez no layout
// raiz (fora de qualquer error.tsx), escuta os dois eventos globais do
// browser que cobrem esses casos e reporta pro mesmo endpoint -- window
// continua funcionando normalmente depois (nunca faz preventDefault,
// só observa).
export function ClientErrorLogger() {
  useEffect(() => {
    function report(payload: { message: string; stack?: string; source: string }) {
      const body = JSON.stringify({ ...payload, url: window.location.href, userAgent: navigator.userAgent })
      // sendBeacon sobrevive a navegação/fechamento de aba (o erro pode
      // acontecer bem na hora em que a página está saindo); fetch é o
      // fallback pra ambientes sem suporte.
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/client-error-log', new Blob([body], { type: 'application/json' }))
      } else {
        fetch('/api/client-error-log', { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => {})
      }
    }

    function onError(event: ErrorEvent) {
      report({ message: event.message, stack: event.error?.stack, source: 'window.onerror' })
    }
    function onRejection(event: PromiseRejectionEvent) {
      const reason = event.reason
      report({
        message: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
        source: 'unhandledrejection',
      })
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  return null
}
