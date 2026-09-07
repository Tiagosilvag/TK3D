'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

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
    <div className="print-bed-bg flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="mb-6 flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-600 text-sm font-bold text-white dark:bg-amber-500 dark:text-slate-950">
            3D
          </span>
          <h1 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
            Controle de Produção
          </h1>
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
          className="mb-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
          autoFocus
        />
        {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button
          type="submit"
          className="w-full rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700 dark:bg-amber-500 dark:text-slate-950 dark:hover:bg-amber-400"
        >
          Entrar
        </button>
      </form>
    </div>
  )
}
