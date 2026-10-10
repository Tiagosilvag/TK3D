'use client'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

// Redesign "Pedidos" -- drawer de detalhe: mesmo shell de overlay+painel
// de QuickCostCalculatorDrawer.tsx (fixed inset-0 flex justify-end +
// painel h-full border-l shadow-xl via createPortal), generalizado pra
// qualquer conteúdo e com a transição de slide-in que o shell original
// não tinha (translate-x-full -> translate-x-0, mesma convenção de
// transition-transform do nav principal em AppLayoutClient.tsx).
export function Drawer({
  open,
  onClose,
  children,
  widthClassName = 'max-w-md',
}: {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  widthClassName?: string
}) {
  const [mounted, setMounted] = useState(false)
  // `rendered` fica true um pouco depois de `open` virar false, só pra
  // dar tempo da transição de saída rodar antes de desmontar -- sem
  // isso o painel sumiria instantaneamente em vez de deslizar pra fora.
  const [rendered, setRendered] = useState(open)
  const [entered, setEntered] = useState(false)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (open) {
      setRendered(true)
      const id = requestAnimationFrame(() => setEntered(true))
      return () => cancelAnimationFrame(id)
    }
    setEntered(false)
    const timeout = setTimeout(() => setRendered(false), 200)
    return () => clearTimeout(timeout)
  }, [open])

  useEffect(() => {
    if (!rendered) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [rendered, onClose])

  if (!mounted || !rendered) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/50" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={`flex h-full w-full ${widthClassName} flex-col overflow-y-auto border-l border-slate-200 bg-white text-slate-900 shadow-xl transition-transform duration-200 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 ${entered ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}
