import type { VariantAttr } from '@/lib/reports'

function ColorDot({ hex, className = 'h-3 w-3' }: { hex: string | null; className?: string }) {
  return hex ? (
    <span style={{ background: hex }} className={`inline-block shrink-0 rounded-full border border-black/10 dark:border-white/10 ${className}`} />
  ) : (
    <span className={`inline-block shrink-0 rounded-full border border-dashed border-slate-300 dark:border-slate-600 ${className}`} />
  )
}

// Redesign "Variação de peças em Pedidos" §1: regra única de exibição de
// variação -- uma peça por linha, nome à esquerda, cores à direita (1
// bolinha + nome por cor, lado a lado na ordem do cadastro). Usado em TODO
// lugar que mostra ou escolhe variação (painel do pedido, seleção de
// variação em cards, prévia ao vivo de "+ Criar nova variação") -- nenhuma
// tela volta a formatar esse texto à mão.
//
// Marca/material nunca aparecem na linha (só no tooltip, `title={attr.value}`
// -- já vem pronto como "Marca Cor (Material)" ou o combo com "+"): pedido
// explícito do usuário ("marca e material se repetem... e escondem a cor,
// que é a informação útil"). Simplificação documentada: a marca só
// apareceria em destaque quando 2+ filamentos da MESMA cor, dentro do MESMO
// combo, tivessem marcas diferentes -- caso raro o bastante pra não valer a
// complexidade extra (zip por cor-exata entre vários filamentos do mesmo
// attr); sempre omitida da linha, disponível no tooltip de qualquer jeito.
export function VariacaoPecas({ attrs, pendingPartNames }: { attrs: VariantAttr[]; pendingPartNames?: Set<string> }) {
  return (
    <div className="grid grid-cols-1 gap-1.5">
      {attrs.map((attr, i) => (
        <div key={`${attr.name}-${i}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{attr.name}</span>
          <span className="flex flex-wrap items-center justify-end gap-x-2.5 gap-y-1" title={attr.value || undefined}>
            {attr.colors.map((color, j) => (
              <span key={`${color.name}-${j}`} className="flex items-center gap-1">
                <ColorDot hex={color.hex} />
                <span className="text-xs text-slate-700 dark:text-slate-300">{color.name}</span>
              </span>
            ))}
            {pendingPartNames?.has(attr.name) && (
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                falta produzir
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  )
}
