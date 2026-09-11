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

  // Melhoria "Montagem" §6, "Produto-como-componente": alertas separados --
  // falta de PEÇA ou de COMPONENTE-PRODUTO bloqueia (vermelho, mesma
  // severidade -- é uma peça física necessária), falta de insumo/acessório
  // só avisa (neutro).
  const insufficient = status ? [...status.parts.filter((p) => p.maxUnitsFromThisPart <= 0), ...status.components.filter((c) => c.maxUnitsFromThisComponent <= 0)] : []
  const lowStockComponents = status
    ? [...status.accessoryRequirements, ...status.supplyRequirements, ...status.packagingRequirements].filter((r) => r.available < r.quantityPerUnit)
    : []

  return (
    <dialog
      ref={dialogRef}
      onClose={close}
      onClick={(e) => { if (e.target === dialogRef.current) close() }}
      className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-950/60 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
    >
      {status && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">{status.productName}</h2>
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
            <div className="grid grid-cols-2 gap-3">
              <div className="tk-panel p-4">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Já montado</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{status.alreadyAssembled} unidade{status.alreadyAssembled === 1 ? '' : 's'}</p>
              </div>
              <div className="tk-panel p-4">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Disponível para montagem</p>
                <p className={`mt-1 text-lg font-semibold tabular-nums ${status.maxAssemblableUnits > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                  {status.maxAssemblableUnits} unidade{status.maxAssemblableUnits === 1 ? '' : 's'}
                </p>
              </div>
            </div>

            <div className="tk-panel p-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="tk-table-head-row">
                    <th className="py-2">{status.isComposite ? 'Peça' : 'Impressão'}</th>
                    <th>Qtd/unidade</th>
                    <th>Produzido</th>
                    <th>Disponível</th>
                  </tr>
                </thead>
                <tbody>
                  {status.parts.map((part) => {
                    const repColor = part.colorOptions && part.colorOptions.length > 0
                      ? part.colorOptions.reduce((a, b) => (b.available > a.available ? b : a))
                      : null
                    return (
                      <tr key={part.partId} className={`tk-row align-top ${part.maxUnitsFromThisPart <= 0 ? 'text-red-600 dark:text-red-400' : ''}`}>
                        <td className="py-2">
                          {part.name}
                          {repColor && (
                            <span className="mt-0.5 flex items-center gap-1.5 text-xs font-normal text-slate-500 dark:text-slate-400">
                              {repColor.colorHex && <span style={{ background: repColor.colorHex }} className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" />}
                              {repColor.label}
                            </span>
                          )}
                        </td>
                        <td>{part.quantityPerUnit}</td>
                        <td>{part.produced}</td>
                        <td>{part.available}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {status.components.length > 0 && (
              <div className="tk-panel p-4">
                <h3 className="mb-2 font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Componentes</h3>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="tk-table-head-row">
                      <th className="py-2">Produto</th>
                      <th>Qtd/unidade</th>
                      <th>Produzido</th>
                      <th>Disponível</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.components.map((component) => {
                      const repColor = component.colorOptions && component.colorOptions.length > 0
                        ? component.colorOptions.reduce((a, b) => (b.available > a.available ? b : a))
                        : null
                      return (
                        <tr key={component.componentProductId} className={`tk-row align-top ${component.maxUnitsFromThisComponent <= 0 ? 'text-red-600 dark:text-red-400' : ''}`}>
                          <td className="py-2">
                            {component.name}
                            {repColor && (
                              <span className="mt-0.5 flex items-center gap-1.5 text-xs font-normal text-slate-500 dark:text-slate-400">
                                {repColor.colorHex && <span style={{ background: repColor.colorHex }} className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" />}
                                {repColor.label}
                              </span>
                            )}
                          </td>
                          <td>{component.quantityPerUnit}</td>
                          <td>{component.produced}</td>
                          <td>{component.available}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {insufficient.length > 0 && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:bg-red-500/10 dark:text-red-400">
                ⚠ Peça/componente insuficiente: {insufficient.map((p) => p.name).join(', ')}
              </p>
            )}

            <ConfirmAssemblyForm
              productId={status.productId}
              parts={status.parts}
              components={status.components}
              accessoryRequirements={status.accessoryRequirements}
              supplyRequirements={status.supplyRequirements}
              packagingRequirements={status.packagingRequirements}
              allAccessories={allAccessories}
              allSupplies={allSupplies}
              allPackaging={allPackaging}
            />

            {lowStockComponents.length > 0 && (
              <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                ⓘ Estoque baixo de: {lowStockComponents.map((r) => r.name).join(', ')}
              </p>
            )}

            <Link href="/stock" className="inline-block text-sm text-amber-600 hover:underline dark:text-amber-400">
              Ver Meu Estoque &rarr;
            </Link>
          </div>
        </div>
      )}
    </dialog>
  )
}
