'use client'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// Bug "menu de ações preso dentro da tabela + não fecha ao clicar fora":
// isto era um <details>/<summary> nativo com o dropdown em position:absolute
// -- funcionava bem em telas sem scroll, mas dentro de um container com
// overflow (as tabelas de Estoque/Produção/etc. rolam horizontalmente em
// telas estreitas) um ancestral com overflow!=visible CORTA qualquer
// descendente absolutamente posicionado que ultrapasse suas bordas, então o
// menu aparecia cortado pela própria tabela. E <details> nunca teve
// fechamento nativo ao clicar fora -- só o clique no <summary> alterna o
// estado, então o menu ficava aberto até um clique EM CIMA dele.
// Fix: vira Client Component, portado pra document.body (mesma técnica já
// usada em FilamentSelect/ComponentCategoryCard pra escapar de ancestrais
// problemáticos) com position:fixed calculado a partir do botão -- escapa
// de qualquer overflow: hidden/auto no caminho -- mais um listener de
// clique fora pra fechar. Continua zero dependências novas.
export function ActionsMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null)
  const [mounted, setMounted] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!open) return

    function updatePosition() {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      setPosition({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    }
    updatePosition()

    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    // Capture phase: a tabela rola dentro do próprio container (não da
    // window), então só um listener de scroll em CAPTURE (que também pega
    // scroll de qualquer ancestral, não só window) mantém o menu grudado
    // no botão em vez de descolar visualmente enquanto a tabela rola.
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Ações"
        aria-expanded={open}
        className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
      >
        ⋯
      </button>
      {mounted && open && position && createPortal(
        <div
          ref={menuRef}
          onClick={() => setOpen(false)}
          style={{ position: 'fixed', top: position.top, right: position.right }}
          className="z-50 flex min-w-max flex-col items-start gap-2 rounded-lg border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          {children}
        </div>,
        document.body,
      )}
    </>
  )
}
