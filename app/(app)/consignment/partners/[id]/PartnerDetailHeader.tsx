'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { deleteConsignmentPartner } from '@/actions/consignmentPartners'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'
import { PartnerForm, type EditingPartner } from '../PartnerForm'

function initials(name: string): string {
  const words = name.trim().split(/\s+/).slice(0, 2)
  return words.map((w) => w[0]).join('').toUpperCase()
}

// Melhoria "Parceiros de consignação" §4: cabeçalho da página dedicada --
// avatar+nome+comissão e as ações diretas Editar (reabre o mesmo modal de
// cadastro, em modo edição) e Remover parceiro (soft-delete, redireciona
// pra lista já que este parceiro deixa de existir "ativo" aqui).
export function PartnerDetailHeader({ partner }: { partner: EditingPartner }) {
  const router = useRouter()
  const [editOpen, setEditOpen] = useState(false)

  async function handleDelete() {
    const result = await deleteConsignmentPartner(partner.id)
    if (result.success) router.push('/consignment/partners')
    return result
  }

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-200 text-base font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {initials(partner.name)}
        </span>
        <div>
          <h1 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">{partner.name}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Comissão padrão: {(partner.defaultCommissionPercent * 100).toFixed(0)}%</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setEditOpen(true)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
          Editar
        </button>
        <ConfirmDeleteForm
          action={handleDelete}
          confirmMessage="Remover este parceiro? Entregas e histórico já registrados continuam preservados."
          className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
        />
      </div>

      <PartnerForm open={editOpen} onOpenChange={setEditOpen} editingPartner={partner} />
    </div>
  )
}
