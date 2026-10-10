import type { VariantAttr, VariantAttrTier } from '@/lib/reports'

// Melhoria "Modal de variações -- chips por hierarquia" (originalmente em
// app/(app)/stock/VariantsModal.tsx, extraído pra cá pra reuso em Vendas):
// cada atributo da variante (Base, Tampa, Cor = peça do próprio produto;
// Mosquetão = componente; Corrente = acessório) vira um chip com peso
// visual diferente conforme `attr.tier` (ver VariantAttrTier em
// lib/reports.ts) -- produto tem destaque forte (fundo tingido na própria
// cor, valor em negrito), complemento é neutro (cinza, um degrau abaixo),
// acessório é o mais discreto (quase apagado). `attrs` já chega reordenado
// por hierarquia (Produto → Complemento → Acessório) de
// getProductVariantBreakdown -- nunca reordena aqui de novo.
export function ChipDots({ hexes, size }: { hexes: string[]; size: string }) {
  const [first, second] = hexes
  return (
    <span className="flex shrink-0">
      <span
        className={`inline-block rounded-full border border-black/10 dark:border-white/10 ${size}`}
        style={{ background: first ?? '#9CA3AF' }}
      />
      {second && (
        <span
          className={`-ml-1 inline-block rounded-full border border-black/10 dark:border-white/10 ${size}`}
          style={{ background: second }}
        />
      )}
    </span>
  )
}

const TIER_WRAP_CLASS: Record<VariantAttrTier, string> = {
  produto: 'border px-2.5 py-1',
  complemento: 'border border-slate-200 bg-slate-100 px-2.5 py-1 dark:border-slate-600 dark:bg-slate-700/50',
  acessorio: 'border border-slate-100 bg-slate-50 px-2 py-0.5 dark:border-slate-700/60 dark:bg-slate-800/40',
}
const TIER_NAME_CLASS: Record<VariantAttrTier, string> = {
  produto: 'text-[11px] text-slate-500 dark:text-slate-300',
  complemento: 'text-[10.5px] text-slate-500 dark:text-slate-400',
  acessorio: 'text-[10px] text-slate-400 dark:text-slate-500',
}
const TIER_VALUE_CLASS: Record<VariantAttrTier, string> = {
  produto: 'text-[13px] font-bold text-slate-900 dark:text-white',
  complemento: 'text-[12px] font-semibold text-slate-700 dark:text-slate-200',
  acessorio: 'text-[11px] text-slate-500 dark:text-slate-400',
}
const TIER_DOT_SIZE: Record<VariantAttrTier, string> = {
  produto: 'h-2.5 w-2.5',
  complemento: 'h-2 w-2',
  acessorio: 'h-1.5 w-1.5',
}

// Redesign "Vendas" §3: modo compacto reaproveita o MESMO componente
// (nunca duplica ChipDots/classes de tier) -- só troca o texto exibido
// (attr.shortValue em vez do attr.value completo, + attr.material
// apagado quando a peça usa 1 filamento só) e o nome da peça vira
// tooltip-friendly (maiúsculas pequenas, mesma convenção do protótipo),
// com o texto completo (attr.value, "Marca Cor (Material)") indo pro
// `title` do chip em vez de aparecer na tela. `variant` default 'full'
// preserva 100% o visual já usado em VariantsModal.tsx (/stock) -- zero
// mudança pra quem não passa a prop.
export function VariantChip({ attr, variant = 'full' }: { attr: VariantAttr; variant?: 'full' | 'compact' }) {
  // Produto: fundo/borda tingidos na própria cor do chip (a peça É o
  // produto) -- únicos que precisam de estilo inline, já que a cor é
  // dinâmica; complemento/acessório usam classes neutras fixas.
  const tintStyle = attr.tier === 'produto' && attr.colorHexes[0]
    ? { background: `${attr.colorHexes[0]}26`, borderColor: `${attr.colorHexes[0]}55` }
    : undefined

  if (variant === 'compact') {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full ${TIER_WRAP_CLASS[attr.tier]}`}
        style={tintStyle}
        title={attr.value || undefined}
      >
        <ChipDots hexes={attr.colorHexes} size={TIER_DOT_SIZE[attr.tier]} />
        {attr.name && <span className={`uppercase tracking-wide ${TIER_NAME_CLASS[attr.tier]}`} style={{ fontSize: '9px' }}>{attr.name}</span>}
        {attr.shortValue && <span className={TIER_VALUE_CLASS[attr.tier]}>{attr.shortValue}</span>}
        {attr.material && <span className="text-slate-400 dark:text-slate-500" style={{ fontSize: '9px' }}>{attr.material}</span>}
      </span>
    )
  }

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full ${TIER_WRAP_CLASS[attr.tier]}`} style={tintStyle}>
      <ChipDots hexes={attr.colorHexes} size={TIER_DOT_SIZE[attr.tier]} />
      {attr.name && <span className={TIER_NAME_CLASS[attr.tier]}>{attr.name}</span>}
      {attr.value && <span className={TIER_VALUE_CLASS[attr.tier]}>{attr.value}</span>}
    </span>
  )
}
