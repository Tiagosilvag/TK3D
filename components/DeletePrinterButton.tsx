'use client'
import { useRef } from 'react'
import { useRouter } from 'next/navigation'
import { SubmitButton } from '@/components/SubmitButton'

type ActionResult = { success: boolean; error?: string }

// 3.4: exclusão permanente de impressora precisa nomear a impressora e
// avisar sobre perda de histórico -- window.confirm() genérico não cobria
// isso, então usa o mesmo padrão de <dialog> nativo do AdjustStockButton.
export function DeletePrinterButton({
  printerName,
  onDelete,
}: {
  printerName: string
  onDelete: () => Promise<ActionResult>
}) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)

  async function action() {
    const result = await onDelete()
    if (result.success) {
      dialogRef.current?.close()
      router.refresh()
    } else {
      alert(result.error)
    }
  }

  return (
    <>
      <button type="button" onClick={() => dialogRef.current?.showModal()} className="tk-menu-item-danger">
        Excluir permanentemente
      </button>
      <dialog
        ref={dialogRef}
        className="w-96 rounded-xl border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        <form action={action} className="grid gap-3 p-4">
          <h3 className="font-display text-sm font-semibold">Excluir &ldquo;{printerName}&rdquo; permanentemente?</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Essa ação não pode ser desfeita. Se esta impressora já tiver produtos ou produções vinculadas, todo o histórico associado a ela será perdido.
          </p>
          <div className="mt-2 flex items-center justify-end gap-3">
            <button type="button" onClick={() => dialogRef.current?.close()} className="text-sm text-slate-500 hover:underline dark:text-slate-400">
              Cancelar
            </button>
            <SubmitButton pendingLabel="Excluindo…" className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-700 dark:bg-red-500 dark:text-slate-950 dark:hover:bg-red-400">
              Excluir permanentemente
            </SubmitButton>
          </div>
        </form>
      </dialog>
    </>
  )
}
