// Cliente HTTP da Anycubic Cloud (engenharia reversa comunitária, sem doc
// oficial -- ver spec 2026-09-12 §2). Sem login programático: o usuário
// cola o token extraído manualmente do Anycubic Slicer Next (Windows).
import { buildSignedHeadersNow } from './signing'

const BASE_URL = 'https://cloud-universe.anycubic.com/p/p/workbench/api'

async function signedFetch(path: string, opts: { method?: 'GET' | 'POST'; body?: unknown; authToken?: string } = {}) {
  const headers = buildSignedHeadersNow(opts.authToken)
  return fetch(`${BASE_URL}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
}

// Copiar a saída do PowerShell (Task de extração do token) pode trazer
// quebras de linha/espaços NO MEIO do JWT, quando o console quebra a linha
// visualmente e isso vira newline literal ao colar -- trim() só limpa as
// pontas. Removendo todo espaço em branco (o token nunca contém espaço de
// verdade) resolve; bug real encontrado testando contra a conta do usuário
// (login retornava "inválido" mesmo com o token certo).
function sanitizeSlicerToken(raw: string): string {
  return raw.replace(/\s+/g, '')
}

export async function exchangeSlicerToken(pastedToken: string): Promise<{ authToken: string }> {
  const res = await signedFetch('/v3/public/loginWithAccessToken', {
    method: 'POST',
    body: { device_type: 'pcf', access_token: sanitizeSlicerToken(pastedToken) },
  })
  if (!res.ok) throw new Error('Falha ao trocar o token do Slicer Next — tente novamente')
  const data = (await res.json()) as { data?: { token?: string } }
  if (!data.data?.token) throw new Error('Token do Slicer Next inválido ou expirado — extraia um novo e cole de novo')
  return { authToken: data.data.token }
}

export async function fetchUserInfo(authToken: string): Promise<{ id: string; email: string }> {
  const res = await signedFetch('/user/profile/userInfo', { authToken })
  if (!res.ok) throw new Error('Falha ao obter dados da conta Anycubic')
  const data = (await res.json()) as { data?: { id?: number | string; user_email?: string } }
  if (data.data?.id === undefined || !data.data.user_email) throw new Error('Anycubic não retornou id/e-mail da conta')
  return { id: String(data.data.id), email: data.data.user_email }
}

export type AnycubicPrinterRef = { key: string; name: string }

// Lista as impressoras vinculadas à conta -- mesmo papel do
// fetchBoundDevices da Bambu, pra escolher a "key" numa lista em vez de
// caçar ela manualmente.
export async function fetchMyPrinters(authToken: string): Promise<AnycubicPrinterRef[]> {
  const res = await signedFetch('/work/printer/getPrinters', { authToken })
  if (!res.ok) throw new Error('Falha ao buscar impressoras da conta Anycubic')
  const data = (await res.json()) as { data?: { key?: string; name?: string }[] }
  return (data.data ?? [])
    .filter((p): p is { key: string; name?: string } => Boolean(p.key))
    .map((p) => ({ key: p.key, name: p.name ?? p.key }))
}
