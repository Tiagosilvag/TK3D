'use client'
import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { AssemblyStatus } from '@/actions/assembly'
import { ConfirmAssemblyForm } from './ConfirmAssemblyForm'
import type { ComponentOption } from './ComponentCategoryCard'

// Bug "clicar num produto não faz nada visível": o detalhe de Montagem
// (status?.productId via ?productId=) renderizava embaixo da lista geral
// -- a navegação acontecia, mas sem nada visível até o usuário rolar a
// página manualmente. Vira modal (<dialog> nativo, mesmo padrão de
// app/(app)/stock/VariantsModal.tsx): abre sozinha assim que `status`
// chega não-nulo (useEffect), fecha voltando pra /assembly (sem
// ?productId=) pelo X, clique fora ou ESC -- nunca deixa a URL com um
// productId órfão de modal fechada.
export function AssemblyDetailModal({
  status,
  allAccessories,
  allSupplies,
  allPackaging,
}: {
  status: AssemblyStatus | null
  allAccessories: ComponentOption[]
  allSupplies: ComponentOption[]
  allPackaging: ComponentOption[]
}) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (status) {
      if (!dialog.open) dialog.showModal()
    } else if (dialog.open) {
      dialog.close()
    }
  }, [status])

  function close() {
    router.push('/assembly')
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={close}
      onClick={(e) => { if (e.target === dialogRef.current) close() }}
      className="w-full max-w-4xl rounded-xl border border-slate-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-950/60 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
    >
      {status && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">{status.productName}</h2>
              <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
                {status.alreadyAssembled} unidade{status.alreadyAssembled === 1 ? '' : 's'} já montada{status.alreadyAssembled === 1 ? '' : 's'}
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Fechar"
              className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            >
              ✕
            </button>
          </div>

          <div className="space-y-4 overflow-y-auto px-5 py-4">
            <ConfirmAssemblyForm
              productId={status.productId}
              isComposite={status.isComposite}
              parts={status.parts}
              components={status.components}
              accessoryRequirements={status.accessoryRequirements}
              supplyRequirements={status.supplyRequirements}
              packagingRequirements={status.packagingRequirements}
              allAccessories={allAccessories}
              allSupplies={allSupplies}
              allPackaging={allPackaging}
            />

            <Link href="/stock" className="inline-block text-sm text-violet-600 hover:underline dark:text-violet-400">
              Ver Meu Estoque &rarr;
            </Link>
          </div>
        </div>
      )}
    </dialog>
  )
}
