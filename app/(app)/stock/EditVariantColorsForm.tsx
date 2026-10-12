'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getAssemblyStatus, updateAssemblyColorChoices, type AssemblyPartColorOption } from '@/actions/assembly'

interface EditableChoice {
  key: string
  currentValue: string
  label: string
  options: AssemblyPartColorOption[]
  // Bug "n deixa eu editar a q esta disponivel": só chave de ACESSÓRIO tem
  // estoque físico separado por cor de verdade (updateAssemblyColorChoices,
  // actions/assembly.ts, só move estoque pra essas) -- peça/componente-
  // produto é reescrita de rótulo pura, sem checagem de estoque nenhuma do
  // lado do servidor. `available` de uma opção de peça/componente aqui
  // reflete "produzido ainda não montado" (igual Montagem), que normalmente
  // já é 0 pra toda cor assim que a produção vira estoque -- desabilitar
  // essas opções por "0 disponível" deixava o <select> sem NENHUMA
  // alternativa escolhível além da já selecionada, impossível de corrigir
  // uma cor errada já montada. Só acessório mantém a trava de estoque.
  kind: 'part' | 'component' | 'accessory'
}

// Bug/pedido "n tem como corrigir a cor gravada errada": ProductAssembly.
// colorChoices é só um rótulo de qual combo foi consumido numa leva de
// montagem -- não tinha nenhuma tela pra corrigir um erro de digitação
// (ex.: MOSQUETÃO marrom gravado no lugar de roxo). Reconstrói as opções
// de cada peça/componente/acessório desta variante a partir de
// getAssemblyStatus (mesma fonte que ConfirmAssemblyForm usa pra montar
// de verdade, com o mesmo "disp." por opção) e deixa trocar cada uma pra
// outra cor já cadastrada. Peça/componente-produto: só reescreve o
// rótulo (a cor errada volta a aparecer disponível, a certa passa a
// contar como consumida, tudo derivado -- ver comentário em
// actions/assembly.ts#updateAssemblyColorChoices). Acessório com cor
// variável: ALÉM do rótulo, a action move o estoque físico de verdade
// entre as duas linhas de Accessory (devolve a quantidade na cor antiga,
// decrementa da cor nova) -- por isso as opções aqui mostram "disp."
// reais e cor sem estoque fica desabilitada (mesma trava do formulário
// de Montagem), exceto a que já está selecionada.
export function EditVariantColorsForm({
  productId,
  comboKey,
  // Pedido "só pode editar todas as unidades que estão disponíveis, no
  // caso quero editar somente 1": antes a correção sempre movia TODAS as
  // unidades montadas desta cor de uma vez -- quantidade virou um campo
  // obrigatório (padrão 1, o caso mais comum: corrigir só a(s) peça(s)
  // que saiu(íram) errada(s), sem mexer no resto). `maxUnits` (Disponível +
  // Consignado + Vendido desta linha, vindo de VariantsModal -- a mesma
  // soma que corresponde ao total já montado) é só um teto pro campo; a
  // action recalcula e valida o total de verdade no servidor de qualquer
  // jeito, então um `maxUnits` desatualizado nunca deixa passar mais do
  // que existe.
  maxUnits,
  onCancel,
  onSaved,
}: {
  productId: string
  comboKey: string
  maxUnits: number
  onCancel: () => void
  onSaved: () => void
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [editable, setEditable] = useState<EditableChoice[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [quantity, setQuantity] = useState('1')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const status = await getAssemblyStatus(productId)
        const pairs = comboKey.split('|').map((entry) => {
          const separatorIndex = entry.indexOf(':')
          return [entry.slice(0, separatorIndex), entry.slice(separatorIndex + 1)] as [string, string]
        })
        const rows: EditableChoice[] = []
        for (const [key, rawKey] of pairs) {
          const part = status.parts.find((p) => p.partId === key)
          const component = part ? undefined : status.components.find((c) => c.componentProductId === key)
          const accessory = part || component ? undefined : status.accessoryRequirements.find((a) => a.id === key)
          const source = part ?? component ?? accessory
          if (!source || !source.colorOptions || source.colorOptions.length === 0) continue
          const kind: EditableChoice['kind'] = part ? 'part' : component ? 'component' : 'accessory'
          rows.push({ key, currentValue: rawKey, label: source.name, options: source.colorOptions, kind })
        }
        if (cancelled) return
        setEditable(rows)
        setValues(Object.fromEntries(rows.map((r) => [r.key, r.currentValue])))
        if (rows.length === 0) setError('Essa variação não tem nenhuma cor com alternativa cadastrada pra trocar.')
      } catch {
        if (!cancelled) setError('Não deu pra carregar as opções de cor.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [productId, comboKey])

  async function save() {
    const qty = parseInt(quantity, 10)
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('Quantidade inválida')
      return
    }
    setSaving(true)
    setError('')
    const fd = new FormData()
    fd.set('productId', productId)
    fd.set('oldComboKey', comboKey)
    fd.set('colorChoicesJson', JSON.stringify(values))
    fd.set('quantity', String(qty))
    const result = await updateAssemblyColorChoices(fd)
    setSaving(false)
    if (!result.success) {
      setError(result.error ?? 'Erro ao salvar')
      return
    }
    router.refresh()
    onSaved()
  }

  if (loading) {
    return <p className="py-2 text-xs text-slate-400 dark:text-slate-500">Carregando opções de cor…</p>
  }

  return (
    <div className="grid gap-2 py-2">
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <label className="text-xs">
        Quantidade a corrigir{maxUnits > 0 && ` (máx. ${maxUnits})`}
        <input
          type="number"
          step="1"
          min={1}
          max={maxUnits > 0 ? maxUnits : undefined}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          className="tk-input-full mt-1"
        />
      </label>
      {editable.map((row) => (
        <label key={row.key} className="text-xs">
          {row.label}
          <select
            value={values[row.key] ?? ''}
            onChange={(e) => setValues((prev) => ({ ...prev, [row.key]: e.target.value }))}
            className="tk-input-full mt-1"
          >
            {row.options.map((o) => (
              <option
                key={o.key}
                value={o.key}
                disabled={row.kind === 'accessory' && o.available <= 0 && o.key !== row.currentValue}
              >
                {o.label}
                {row.kind === 'accessory' && ` (${o.available} ${o.available === 1 ? 'disponível' : 'disponíveis'})`}
              </option>
            ))}
          </select>
        </label>
      ))}
      <div className="flex justify-end gap-3">
        <button type="button" onClick={onCancel} className="text-xs text-slate-500 hover:underline dark:text-slate-400">Cancelar</button>
        {editable.length > 0 && (
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="tk-btn-primary px-3 py-1 text-xs disabled:opacity-60"
          >
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        )}
      </div>
    </div>
  )
}
