'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogoWatermark } from '@/components/LogoWatermark'

export default function LoginPage() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (res.ok) {
      router.push('/dashboard')
      router.refresh()
    } else {
      setError('Senha incorreta')
    }
  }

  return (
    <div className="tk-gradient-bg flex min-h-screen items-center justify-center">
      <LogoWatermark />
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      >
        {/* Peça completa da logo (ícone + "TK3D" por extenso) em destaque --
            login é a única tela com espaço/motivo pra mostrar a marca por
            inteiro; a sidebar (components/Logo.tsx) usa só o ícone
            recortado por questão de espaço. <img> direto, não next/image
            -- ver comentário em components/Logo.tsx (bug "logo não
            aparece em produção", falta de `sharp` em runtime). */}
        <div className="mb-6 flex flex-col items-center text-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- arquivo estático em public/, sem necessidade de otimização em runtime */}
          <img src="/brand/logo-full.png" alt="TK3D" width={1222} height={1210} className="h-24 w-auto" />
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Controle de Produção</p>
        </div>
        <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor="password">
          Senha
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          className="mb-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/30 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
          autoFocus
        />
        {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button
          type="submit"
          className="w-full rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700 dark:bg-violet-500 dark:text-slate-950 dark:hover:bg-violet-400"
        >
          Entrar
        </button>
      </form>
    </div>
  )
}
