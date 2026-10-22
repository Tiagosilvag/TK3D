'use client'
import { useRouter, useSearchParams } from 'next/navigation'

// Seletor que grava o valor escolhido na querystring (mantendo todos os
// outros parâmetros -- período global, aba, demais filtros) e recarrega a
// página: o filtro vale no servidor, sem estado de cliente paralelo.
export function UrlSelect({
  name,
  value,
  allLabel,
  options,
  label,
}: {
  name: string
  value: string
  allLabel: string
  options: { value: string; label: string }[]
  label: string
}) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function onChange(next: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (next) params.set(name, next)
    else params.delete(name)
    const qs = params.toString()
    router.push(qs ? `/dashboard?${qs}` : '/dashboard')
  }

  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="tk-input-full min-w-0 max-w-full sm:w-auto"
    >
      <option value="">{allLabel}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}
