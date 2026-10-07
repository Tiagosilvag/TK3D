// Mesmo padrão visual do Stepper privado de QuickCostCalculatorDrawer.tsx
// (botões −/+ com .tk-input h-7 w-7), adaptado pro redesign de Pedidos:
// o valor é um <input> editável por digitação direta (não um <span> só
// de leitura) -- Pedidos precisa das duas formas de ajustar quantidade/
// valor, QuickCostCalculatorDrawer.tsx só precisava dos botões.
export function Stepper({
  value,
  onChange,
  step,
  min = 0,
}: {
  value: number
  onChange: (v: number) => void
  step: number
  min?: number
}) {
  return (
    <div className="inline-flex items-center gap-1.5">
      <button type="button" onClick={() => onChange(Math.max(min, Math.round((value - step) * 100) / 100))} className="tk-input h-7 w-7 shrink-0 text-center leading-none">−</button>
      <input
        type="number"
        step={step}
        min={min}
        value={value}
        onChange={(e) => onChange(Math.max(min, parseFloat(e.target.value) || 0))}
        className="tk-input h-7 w-16 shrink-0 text-center text-sm font-medium tabular-nums"
      />
      <button type="button" onClick={() => onChange(Math.round((value + step) * 100) / 100)} className="tk-input h-7 w-7 shrink-0 text-center leading-none">+</button>
    </div>
  )
}
