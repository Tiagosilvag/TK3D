'use client'
import { useEffect, useState } from 'react'
import { decimalHoursToHHMM, hhmmToDecimalHours } from '@/lib/hours'

// 3.8: entrada de duração em HH:MM (ex.: "01:30") em vez de fração decimal
// (ex.: "1.5") -- o campo visível não carrega `name` (edita só o texto
// HH:MM local), um <input type="hidden"> com o `name` real submete o
// decimal já convertido, então nada no resto do formulário/validação/ação
// precisa saber que a entrada mudou de formato.
export function HoursInput({
  name,
  value,
  onChange,
  required = false,
  className = 'tk-input-full',
}: {
  // Omitido quando o valor decimal já é lido de outro lugar no submit (ex.:
  // ProductForm serializa as peças pra um único campo partsJson, em vez de
  // cada linha ter seu próprio input nomeado) -- nesse caso não há hidden
  // input a renderizar.
  name?: string
  value: number
  onChange: (hours: number) => void
  required?: boolean
  className?: string
}) {
  const [text, setText] = useState(() => decimalHoursToHHMM(value))

  useEffect(() => {
    setText(decimalHoursToHHMM(value))
  }, [value])

  return (
    <>
      <input
        type="text"
        inputMode="numeric"
        placeholder="00:00"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => onChange(hhmmToDecimalHours(e.target.value))}
        required={required}
        className={className}
      />
      {name && <input type="hidden" name={name} value={value} />}
    </>
  )
}
