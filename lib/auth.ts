import crypto from 'crypto'

// Must match the cookie's maxAge (in seconds) set in app/api/login/route.ts,
// converted to milliseconds: a session token older than this is rejected
// server-side even if its HMAC is still valid.
const SESSION_MAX_AGE_MS = 60 * 60 * 24 * 30 * 1000

function getSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET não configurado')
  return secret
}

// Constant-time comparison that doesn't leak input length: hashing both
// sides to a fixed digest size before timingSafeEqual means the comparison
// takes the same time regardless of how long `a` or `b` are, unlike an
// `a.length !== b.length` short-circuit (a length oracle) before it.
function safeEqual(a: string, b: string): boolean {
  const hashA = crypto.createHash('sha256').update(a).digest()
  const hashB = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(hashA, hashB)
}

export function signSession(): string {
  const payload = String(Date.now())
  const hmac = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex')
  return `${payload}.${hmac}`
}

export function verifySession(token: string): boolean {
  if (!token || !token.includes('.')) return false
  const [payload, hmac] = token.split('.')
  const expected = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex')
  if (!safeEqual(hmac, expected)) return false

  const issuedAt = Number(payload)
  if (!Number.isFinite(issuedAt)) return false
  if (Date.now() - issuedAt > SESSION_MAX_AGE_MS) return false

  return true
}

export function checkPassword(password: string): boolean {
  const appPassword = process.env.APP_PASSWORD
  if (!appPassword) throw new Error('APP_PASSWORD não configurado')
  return safeEqual(password, appPassword)
}
