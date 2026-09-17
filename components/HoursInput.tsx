'use client'
import { useEffect, useRef, useState } from 'react'
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
//
// Bug "definir a hora vai pra 59 minutos": esse esquema só funciona
// digitando do zero -- ele relê TODOS os dígitos do texto atual a cada
// tecla e trata os 2 últimos como minutos, não sabe distinguir "dígito
// novo" de "dígito que já estava lá". Como o campo quase sempre chega
// PRÉ-PREENCHIDO (valor padrão da ficha técnica), clicar e digitar sem
// apagar antes misturava dígitos antigos+novos e os minutos calculados
// batiam no teto de 59 sem relação com o que foi digitado. Corrigido
// selecionando todo o texto ao focar (`onFocus` abaixo) -- toda digitação
// vira uma reescrita do zero, do jeito que esta máscara já esperava.
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
  // Bug "definir a hora vai pra 59 minutos" (causa raiz real, não só a
  // seleção de mouse acima): "1"/"2" dígitos ainda não têm ":" (ver
  // maskHoursText), então hhmmToDecimalHours devolve 0 pra esse estado
  // INTERMEDIÁRIO de digitação -- esse 0 sobe pro componente pai via
  // onChange, o pai re-renderiza passando `value=0` de volta, e o
  // useEffect abaixo reescrevia `text` pra "00:00" NO MEIO da digitação,
  // apagando o dígito que a pessoa acabou de teclar antes do próximo
  // tecla chegar. Só resincroniza `text` quando `value` muda por um
  // motivo EXTERNO a este componente (ex.: trocar de produto muda o
  // padrão) -- nunca como eco do nosso próprio onChange.
  const lastEmitted = useRef(value)

  useEffect(() => {
    if (value !== lastEmitted.current) {
      setText(decimalHoursToHHMM(value))
      lastEmitted.current = value
    }
  }, [value])

  return (
    <>
      <input
        type="text"
        inputMode="numeric"
        placeholder="00:00"
        value={text}
        onFocus={(e) => e.currentTarget.select()}
        // Clicar de novo num campo que JÁ está focado não dispara `focus`
        // outra vez (o evento só ocorre na transição de fora pra dentro) --
        // sem isso, reabrir a seleção só funcionava no primeiro clique.
        // Intercepta esse caso aqui: bloqueia o posicionamento de cursor
        // padrão do mousedown e seleciona tudo na mão.
        onMouseDown={(e) => {
          if (document.activeElement === e.currentTarget) {
            e.preventDefault()
            e.currentTarget.select()
          }
        }}
        // Clique de mouse no primeiro foco (diferente de foco por Tab)
        // reposiciona o cursor no `mouseup` DEPOIS do `onFocus` já ter
        // selecionado tudo, desfazendo a seleção -- `preventDefault` no
        // mouseup impede esse reposicionamento nos dois casos acima.
        onMouseUp={(e) => e.preventDefault()}
        onChange={(e) => {
          const masked = maskHoursText(e.target.value)
          setText(masked)
          const decimal = hhmmToDecimalHours(masked)
          lastEmitted.current = decimal
          onChange(decimal)
        }}
        required={required}
        className={className}
      />
      {name && <input type="hidden" name={name} value={value} />}
    </>
  )
}
