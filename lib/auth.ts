import crypto from 'crypto'

function getSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET não configurado')
  return secret
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
  const a = Buffer.from(hmac)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export function checkPassword(password: string): boolean {
  const appPassword = process.env.APP_PASSWORD
  if (!appPassword) throw new Error('APP_PASSWORD não configurado')
  const a = Buffer.from(password)
  const b = Buffer.from(appPassword)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
