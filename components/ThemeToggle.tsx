'use client'

import { useEffect, useState } from 'react'
import { NavThemeSunIcon, NavThemeMoonIcon } from './NavIcons'

/**
 * Toggles the `dark` class on <html>, persisting the choice to
 * localStorage('theme'). The initial class is already set before paint by
 * the inline script in app/layout.tsx (avoids a flash of the wrong theme);
 * this component only needs to read that same state back into React so the
 * icon matches what's on screen, then flip it on click.
 *
 * Melhoria "Menu lateral" §6: vira uma linha (ícone + rótulo do modo ATUAL +
 * switch visual), não mais um botão-ícone isolado sem indicação do que ele
 * faz -- único uso deste componente é o rodapé fixo do menu
 * (AppLayoutClient.tsx), então dá pra mudar o formato aqui sem afetar mais
 * nada.
 */
export function ThemeToggle() {
  const [isDark, setIsDark] = useState<boolean | null>(null)

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains('dark'))
  }, [])

  function toggle() {
    const next = !document.documentElement.classList.contains('dark')
    document.documentElement.classList.toggle('dark', next)
    try {
      window.localStorage.setItem('theme', next ? 'dark' : 'light')
    } catch {
      // localStorage can throw in private-browsing/blocked-storage contexts;
      // the class toggle above already updated the visible theme for this
      // session, so silently skipping persistence is an acceptable fallback.
    }
    setIsDark(next)
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
      className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
    >
      <span className="flex items-center gap-2.5">
        {isDark === null ? <span className="h-4 w-4 shrink-0" /> : isDark ? <NavThemeMoonIcon className="h-4 w-4 shrink-0" /> : <NavThemeSunIcon className="h-4 w-4 shrink-0" />}
        {isDark === null ? 'Tema' : isDark ? 'Tema escuro' : 'Tema claro'}
      </span>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${isDark ? 'bg-violet-500' : 'bg-slate-300 dark:bg-slate-700'}`}
        aria-hidden
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${isDark ? 'translate-x-4' : 'translate-x-0.5'}`}
        />
      </span>
    </button>
  )
}
