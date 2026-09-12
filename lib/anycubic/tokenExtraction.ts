// Extração client-side do token do Slicer Next a partir do conteúdo de um
// arquivo escolhido pelo usuário (botão "Selecionar arquivo de log" em
// AnycubicConnectionForm.tsx) -- mesma regex do passo manual em PowerShell
// documentado no card de Configurações, só que rodando no navegador em vez
// do usuário copiar/colar o resultado do terminal. Cobre os dois formatos
// possíveis (log novo do Slicer Next 1.4.1.2+, .conf antigo em JSON).
const LOG_TOKEN_PATTERN = /accessToken\s*=\s*([^,\s]+)/g
const CONF_TOKEN_PATTERN = /"access_token"\s*:\s*"([^"]+)"/g

function lastMatch(text: string, pattern: RegExp): string | null {
  let match: RegExpExecArray | null
  let last: string | null = null
  while ((match = pattern.exec(text)) !== null) {
    last = match[1]
  }
  return last
}

export function extractSlicerTokenFromText(text: string): string | null {
  return lastMatch(text, LOG_TOKEN_PATTERN) ?? lastMatch(text, CONF_TOKEN_PATTERN)
}
