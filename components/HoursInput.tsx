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
// números"): cada dígito digitado entra pela direita nos minutos,
// empurrando o excedente pros minutos->horas (mesmo padrão de campo de
// duração tipo Toggl/apps de ponto): "1","3","0" vira "1", "13", "1:30".
// Minutos sempre grudam em 2 dígitos e nunca passam de 59; horas ficam
// limitadas a 4 dígitos (mesmo teto de lib/hours.ts#hhmmToDecimalHours).
//
// Recebe a sequência de dígitos JÁ PURA (só 0-9, no máximo 6) -- nunca o
// texto exibido. Isso é o que resolve o bug "definir a hora vira 59
// minutos" (2ª causa raiz, mais funda que a seleção de mouse abaixo):
// uma versão anterior extraía os dígitos do TEXTO JÁ FORMATADO (ex.:
// "0:59"), que já tinha o "80" de minutos travado em "59" -- ao digitar o
// próximo dígito, a máscara reconstruía a partir de "059" (os dígitos do
// texto já travado), não da sequência real "080" que a pessoa digitou,
// perdendo informação de forma irreversível. Mantendo o buffer de dígitos
// crus à parte (ver `digits` em HoursInput abaixo) e SÓ aplicando o
// travamento de 59 na hora de EXIBIR, nunca gravando o valor travado de
// volta no buffer, o dígito seguinte sempre constrói em cima da sequência
// real -- "0","8","0","9" agora dá "08:09", não "05:59".
function maskDigits(digits: string): string {
  if (digits.length <= 2) return digits
  const hoursPart = digits.slice(0, -2)
  const minutesPart = Math.min(59, parseInt(digits.slice(-2), 10)).toString().padStart(2, '0')
  return `${hoursPart}:${minutesPart}`
}

function digitsFromHHMM(hhmm: string): string {
  return hhmm.replace(/\D/g, '')
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
  // Buffer dos dígitos REALMENTE digitados até agora (nunca derivado do
  // texto exibido/travado -- ver comentário de maskDigits acima). Reseta
  // pra vazio a cada novo foco/clique (campo sempre reescrito do zero).
  const digits = useRef(digitsFromHHMM(text))

  // Bug "definir a hora vai pra 59 minutos" (1ª causa raiz): "1"/"2"
  // dígitos ainda não têm ":", então hhmmToDecimalHours devolve 0 pra
  // esse estado INTERMEDIÁRIO de digitação -- esse 0 sobe pro componente
  // pai via onChange, o pai re-renderiza passando `value=0` de volta, e o
  // useEffect abaixo reescrevia `text` pra "00:00" NO MEIO da digitação,
  // apagando o dígito que a pessoa acabou de teclar antes do próximo
  // tecla chegar. Só resincroniza `text`/`digits` quando `value` muda por
  // um motivo EXTERNO a este componente (ex.: trocar de produto muda o
  // padrão) -- nunca como eco do nosso próprio onChange.
  const lastEmitted = useRef(value)

  useEffect(() => {
    if (value !== lastEmitted.current) {
      const newText = decimalHoursToHHMM(value)
      setText(newText)
      digits.current = digitsFromHHMM(newText)
      lastEmitted.current = value
    }
  }, [value])

  function applyDigits(newDigits: string) {
    digits.current = newDigits
    const masked = maskDigits(newDigits)
    setText(masked)
    const decimal = hhmmToDecimalHours(masked)
    lastEmitted.current = decimal
    onChange(decimal)
  }

  // "Reescrever do zero": zera o buffer de dígitos ao ganhar foco -- o
  // próximo dígito digitado começa uma sequência nova, nunca se mistura
  // com o valor pré-preenchido (padrão da ficha técnica, quase sempre
  // presente). `.select()` só destaca visualmente o texto atual pra deixar
  // claro que ele será todo substituído.
  function resetAndSelect(el: HTMLInputElement) {
    digits.current = ''
    el.select()
  }

  return (
    <>
      <input
        type="text"
        inputMode="numeric"
        placeholder="00:00"
        value={text}
        onFocus={(e) => resetAndSelect(e.currentTarget)}
        // Clicar de novo num campo que JÁ está focado não dispara `focus`
        // outra vez (o evento só ocorre na transição de fora pra dentro) --
        // sem isso, o reset acima só acontecia no primeiro clique.
        // Intercepta esse caso aqui: bloqueia o posicionamento de cursor
        // padrão do mousedown e reseta na mão.
        onMouseDown={(e) => {
          if (document.activeElement === e.currentTarget) {
            e.preventDefault()
            resetAndSelect(e.currentTarget)
          }
        }}
        // Clique de mouse no primeiro foco (diferente de foco por Tab)
        // reposiciona o cursor no `mouseup` DEPOIS do `onFocus` já ter
        // selecionado tudo -- sem efeito na digitação (que agora é
        // controlada só pelo buffer `digits`, não pela seleção nativa),
        // mas ainda evita a seleção visual "piscar" e desaparecer.
        onMouseUp={(e) => e.preventDefault()}
        // Dígitos e Backspace são tratados na mão via `digits` (buffer
        // cru, nunca via o texto já mascarado -- ver comentário de
        // maskDigits) -- qualquer outra tecla que produziria um caractere
        // (letras, símbolos) é bloqueada, já que o campo só existe pra
        // guardar HH:MM. Teclas de navegação/acessibilidade (Tab, setas,
        // Shift/Ctrl sozinhas) continuam funcionando normalmente.
        onKeyDown={(e) => {
          if (/^[0-9]$/.test(e.key)) {
            e.preventDefault()
            if (digits.current.length < 6) applyDigits(digits.current + e.key)
            return
          }
          if (e.key === 'Backspace' || e.key === 'Delete') {
            e.preventDefault()
            applyDigits(digits.current.slice(0, -1))
            return
          }
          const allowedKeys = ['Tab', 'Shift', 'Control', 'Alt', 'Meta', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape', 'Enter']
          if (!allowedKeys.includes(e.key) && !e.ctrlKey && !e.metaKey) {
            e.preventDefault()
          }
        }}
        // Colar (Ctrl+V) não passa pelo onKeyDown -- extrai só os dígitos
        // do texto colado e alimenta o mesmo buffer/caminho dos outros.
        onPaste={(e) => {
          e.preventDefault()
          const pasted = e.clipboardData.getData('text').replace(/\D/g, '')
          applyDigits((digits.current + pasted).slice(0, 6))
        }}
        // O valor exibido não muda mais por digitação nativa (todo dígito
        // passa por onKeyDown/onPaste acima, sempre com preventDefault) --
        // este onChange nunca dispara de verdade, só evita o aviso do
        // React de "input controlado sem onChange".
        onChange={() => {}}
        required={required}
        className={className}
      />
      {name && <input type="hidden" name={name} value={value} />}
    </>
  )
}
