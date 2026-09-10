'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PrinterForm, type EditingPrinter } from './PrinterForm'

// Melhoria "Impressoras": único pedaço client desta tela -- só o botão
// "Nova impressora" + o modal em si precisam de estado (abrir/fechar,
// reagir a ?editId=). Os cards da lista continuam Server Component puro.
export function NewPrinterButton({ editingPrinter }: { editingPrinter?: EditingPrinter }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<EditingPrinter | undefined>(undefined)

  useEffect(() => {
    if (editingPrinter) {
      setTarget(editingPrinter)
      setOpen(true)
    }
  }, [editingPrinter])

  function close() {
    setOpen(false)
    if (editingPrinter) router.push('/printers')
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setTarget(undefined); setOpen(true) }}
        className="tk-btn-primary px-4"
      >
        + Nova impressora
      </button>
      <PrinterForm
        key={target?.id ?? 'new'}
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
        editingPrinter={target}
      />
    </>
  )
}
