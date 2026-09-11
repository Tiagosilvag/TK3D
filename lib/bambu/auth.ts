// Cliente mínimo do login da Bambu Cloud (engenharia reversa da comunidade,
// não documentado oficialmente -- ver spec §4). Só usado uma vez, na tela
// de Configurações, pra obter o token que o listener usa depois.
const BAMBU_LOGIN_URL = 'https://api.bambulab.com/v1/user-service/user/login'

export async function requestLoginCode(email: string, password: string): Promise<{ ticket: string }> {
  const res = await fetch(BAMBU_LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: email, password }),
  })
  if (!res.ok) throw new Error('Falha ao solicitar código de login da Bambu')
  const data = (await res.json()) as { tmpToken?: string }
  if (!data.tmpToken) throw new Error('Bambu não retornou um ticket de verificação')
  return { ticket: data.tmpToken }
}

export async function confirmLoginCode(ticket: string, code: string): Promise<{ accessToken: string }> {
  const res = await fetch(BAMBU_LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tmpToken: ticket, code }),
  })
  if (!res.ok) throw new Error('Falha ao confirmar código de login da Bambu')
  const data = (await res.json()) as { accessToken?: string }
  if (!data.accessToken) throw new Error('Código inválido ou expirado')
  return { accessToken: data.accessToken }
}
