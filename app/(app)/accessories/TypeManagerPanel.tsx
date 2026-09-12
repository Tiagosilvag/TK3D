'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createAccessoryType, renameAccessoryType, deleteAccessoryType } from '@/actions/accessoryTypes'

export interface AccessoryTypeOption {
  id: string
  name: string
  count: number
}

// Melhoria "Acessórios" §6: gestão de tipo deixa de ser uma tela própria em
// Configurações -- vira um painel dentro do próprio modal de cadastro,
// acessado por "Gerenciar tipos..." no fim do dropdown de Tipo (ver
// TypeSelect.tsx). router.refresh() depois de cada ação busca a lista
// atualizada (com contagem por tipo) do servidor -- o modal continua
// aberto e no MESMO painel (estado do componente não é perdido por um
// refresh, só remonta se a key do AccessoryForm mudar).
export function TypeManagerPanel({ types, onBack }: { types: AccessoryTypeOption[]; onBack: () => void }) {
  const router = useRouter()
  const [newName, setNewName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim() || busy) return
    setBusy(true)
    const fd = new FormData()
    fd.set('name', newName)
    const result = await createAccessoryType(fd)
    setBusy(false)
    if (!result.success) {
      alert(result.error)
      return
    }
    setNewName('')
    router.refresh()
  }

  function startRename(t: AccessoryTypeOption) {
    setRenamingId(t.id)
    setRenameValue(t.name)
  }

  async function confirmRename(id: string) {
    if (!renameValue.trim() || busy) return
    setBusy(true)
    const fd = new FormData()
    fd.set('name', renameValue)
    const result = await renameAccessoryType(id, fd)
    setBusy(false)
    if (!result.success) {
      alert(result.error)
      return
    }
    setRenamingId(null)
    router.refresh()
  }

  async function handleDelete(t: AccessoryTypeOption) {
    if (t.count > 0 || busy) return
    if (!window.confirm(`Remover o tipo "${t.name}"?`)) return
    setBusy(true)
    const result = await deleteAccessoryType(t.id)
    setBusy(false)
    if (!result.success) {
      alert(result.error)
      return
    }
    router.refresh()
  }

  return (
    <div className="col-span-2 grid grid-cols-1 gap-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onBack} aria-label="Voltar" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
          ←
        </button>
        <h4 className="font-display text-sm font-semibold">Gerenciar tipos</h4>
      </div>

      <form onSubmit={handleAdd} className="flex gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Novo tipo"
          className="tk-input-full"
          disabled={busy}
        />
        <button type="submit" className="tk-btn-primary shrink-0 px-4" disabled={busy || !newName.trim()}>
          Adicionar
        </button>
      </form>

      <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
        {types.length === 0 && (
          <p className="p-3 text-sm text-slate-400 dark:text-slate-500">Nenhum tipo cadastrado.</p>
        )}
        {types.map((t) => (
          <div key={t.id} className="flex items-center justify-between gap-2 border-b border-slate-100 p-2 last:border-0 dark:border-slate-800">
            {renamingId === t.id ? (
              <input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                className="tk-input flex-1"
                autoFocus
                disabled={busy}
              />
            ) : (
              <span className="flex-1 text-sm">{t.name}</span>
            )}
            <span className="text-xs text-slate-400 dark:text-slate-500">{t.count} {t.count === 1 ? 'item' : 'items'}</span>
            {renamingId === t.id ? (
              <>
                <button type="button" onClick={() => confirmRename(t.id)} disabled={busy} className="text-xs text-violet-600 hover:underline dark:text-violet-400">
                  Salvar
                </button>
                <button type="button" onClick={() => setRenamingId(null)} disabled={busy} className="text-xs text-slate-500 hover:underline dark:text-slate-400">
                  Cancelar
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => startRename(t)} disabled={busy} className="text-xs text-violet-600 hover:underline dark:text-violet-400">
                  Renomear
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(t)}
                  disabled={busy || t.count > 0}
                  title={t.count > 0 ? 'Tipos em uso não podem ser removidos' : undefined}
                  className="text-xs text-red-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-300 disabled:no-underline dark:text-red-400 dark:disabled:text-slate-600"
                >
                  Remover
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
