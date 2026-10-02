const AUTH_BASE_URL = 'https://auth.mercadolivre.com.br/authorization'
const TOKEN_URL = 'https://api.mercadolibre.com/oauth/token'
const TOKEN_EXPIRING_SOON_MS = 5 * 60 * 1000

export interface MLTokenResponse {
  accessToken: string
  refreshToken: string
  expiresIn: number
  userId: string
}

function getClientId(): string {
  const id = process.env.MERCADOLIVRE_CLIENT_ID
  if (!id) throw new Error('MERCADOLIVRE_CLIENT_ID não configurada')
  return id
}

function getClientSecret(): string {
  const secret = process.env.MERCADOLIVRE_CLIENT_SECRET
  if (!secret) throw new Error('MERCADOLIVRE_CLIENT_SECRET não configurada')
  return secret
}

function getRedirectUri(): string {
  const uri = process.env.MERCADOLIVRE_REDIRECT_URI
  if (!uri) throw new Error('MERCADOLIVRE_REDIRECT_URI não configurada')
  return uri
}

export function buildAuthorizationUrl(): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: getClientId(),
    redirect_uri: getRedirectUri(),
  })
  return `${AUTH_BASE_URL}?${params.toString()}`
}

interface RawTokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  user_id: number
}

function parseTokenResponse(raw: RawTokenResponse): MLTokenResponse {
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token,
    expiresIn: raw.expires_in,
    userId: String(raw.user_id),
  }
}

export async function exchangeCodeForTokens(code: string): Promise<MLTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: getClientId(),
    client_secret: getClientSecret(),
    code,
    redirect_uri: getRedirectUri(),
  })
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  })
  if (!response.ok) throw new Error('Falha ao trocar código pelo token do Mercado Livre')
  const raw = (await response.json()) as RawTokenResponse
  return parseTokenResponse(raw)
}

// Finding 3a (revisão final da integração Mercado Livre): getValidAccessToken
// (lib/mercadoLivre/connection.ts) precisa distinguir um refresh token
// REALMENTE revogado/expirado (ML responde 400/401 -- invalid_grant/
// invalid_token) de uma falha transitória (5xx, 429, erro de rede) -- só o
// primeiro caso deve forçar DESCONECTADA. Carrega o status HTTP (quando
// existe) no próprio erro lançado, pra quem chama decidir sem precisar
// reconstruir a lógica de "o response não tava ok".
export class MLRefreshError extends Error {
  status: number | null
  constructor(message: string, status: number | null) {
    super(message)
    this.name = 'MLRefreshError'
    this.status = status
  }
}

export async function refreshAccessToken(refreshToken: string): Promise<MLTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: getClientId(),
    client_secret: getClientSecret(),
    refresh_token: refreshToken,
  })
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  })
  if (!response.ok) throw new MLRefreshError('Falha ao renovar token do Mercado Livre', response.status)
  const raw = (await response.json()) as RawTokenResponse
  return parseTokenResponse(raw)
}

export function isTokenExpiringSoon(expiresAt: Date): boolean {
  return expiresAt.getTime() - Date.now() < TOKEN_EXPIRING_SOON_MS
}
