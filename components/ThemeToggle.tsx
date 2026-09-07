'use client'

import { useEffect, useState } from 'react'

/**
 * Toggles the `dark` class on <html>, persisting the choice to
 * localStorage('theme'). The initial class is already set before paint by
 * the inline script in app/layout.tsx (avoids a flash of the wrong theme);
 * this component only needs to read that same state back into React so the
 * icon matches what's on screen, then flip it on click.
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
      title={isDark ? 'Tema claro' : 'Tema escuro'}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
    >
      {isDark === null ? null : isDark ? (
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
          <path d="M10 2.5a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 2.5zm0 12.25a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5a.75.75 0 01.75-.75zM17.5 10a.75.75 0 01-.75.75h-1.5a.75.75 0 010-1.5h1.5a.75.75 0 01.75.75zM4.75 10a.75.75 0 01-.75.75H2.5a.75.75 0 010-1.5H4a.75.75 0 01.75.75zM15.66 4.34a.75.75 0 010 1.06l-1.06 1.06a.75.75 0 11-1.06-1.06l1.06-1.06a.75.75 0 011.06 0zM6.46 13.54a.75.75 0 010 1.06l-1.06 1.06a.75.75 0 11-1.06-1.06l1.06-1.06a.75.75 0 011.06 0zM15.66 15.66a.75.75 0 01-1.06 0l-1.06-1.06a.75.75 0 111.06-1.06l1.06 1.06a.75.75 0 010 1.06zM6.46 6.46a.75.75 0 01-1.06 0L4.34 5.4a.75.75 0 111.06-1.06l1.06 1.06a.75.75 0 010 1.06zM10 6a4 4 0 100 8 4 4 0 000-8z" />
        </svg>
      ) : (
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
          <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
        </svg>
      )}
    </button>
  )
}
