'use client'
import { useEffect, useState } from 'react'
import { decimalHoursToHHMM, hhmmToDecimalHours } from '@/lib/hours'

// 3.8: entrada de duração em HH:MM (ex.: "01:30") em vez de fração decimal
// (ex.: "1.5") -- o campo visível não carrega `name` (edita só o texto
// HH:MM local), um <input type="hidden"> com o `name` real submete o
// decimal já convertido, então nada no resto do formulário/validação/ação
// precisa saber que a entrada mudou de formato.
//
// Máscara "digite da direita pra esquerda" (bug "deixa escrever muitos
// números"): sem isso o campo aceitava qualquer sequência de dígitos (ex.
// "00:00222"), que silenciosamente virava 0 no blur porque não batia com
// hhmmToDecimalHours -- sem nenhum aviso. Agora cada dígito digitado entra
// pela direita nos minutos, empurrando o excedente pros minutos->horas
// (mesmo padrão de campo de duração tipo Toggl/apps de ponto): "1","3","0"
// vira "1", "13", "1:30". Minutos sempre grudam em 2 dígitos e nunca
// passam de 59; horas ficam limitadas a 4 dígitos (mesmo teto de
// lib/hours.ts#hhmmToDecimalHours), então o texto exibido SEMPRE é um
// HH:MM válido -- nunca precisa descartar silenciosamente no blur.
function maskHoursText(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 6)
  if (digits.length <= 2) return digits
  const hoursPart = digits.slice(0, -2)
  const minutesPart = Math.min(59, parseInt(digits.slice(-2), 10)).toString().padStart(2, '0')
  return `${hoursPart}:${minutesPart}`
}

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
        onChange={(e) => {
          const masked = maskHoursText(e.target.value)
          setText(masked)
          onChange(hhmmToDecimalHours(masked))
        }}
        required={required}
        className={className}
      />
      {name && <input type="hidden" name={name} value={value} />}
    </>
  )
}
